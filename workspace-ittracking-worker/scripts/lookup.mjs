#!/usr/bin/env node
/**
 * KinKin Tracking lookup — Fast API-direct with browser fallback for auth refresh
 * Usage: node lookup.mjs --tracking=<X> [--customer=<Y>] [--start=DD/MM/YYYY] [--end=DD/MM/YYYY] [--warehouse=<name>] [--images]
 *
 * Strategy:
 *  1. Load JWT from .auth-state.json (cached from browser login)
 *  2. POST to warehousedepartureapi → 1-2s response
 *  3. If 401 → refresh JWT via Playwright login → retry
 *
 * Response time: ~1-2s (cached JWT) or ~35s (fresh login needed)
 */
import fs from 'node:fs';
import path from 'node:path';

const STATE_FILE = path.resolve(process.cwd(), '.auth-state.json');
const USERNAME = process.env.KINKIN_USERNAME;
const PASSWORD = process.env.KINKIN_PASSWORD;
const USER_ID = process.env.KINKIN_USER_ID || '';
if (!USERNAME || !PASSWORD) {
  console.error(JSON.stringify({ success: false, error: 'Missing env: KINKIN_USERNAME / KINKIN_PASSWORD' }));
  process.exit(1);
}

const WAREHOUSE_MAP = {
  'hà nội': 5, 'ha noi': 5, 'hn': 5,
  'hồ chí minh': 6, 'ho chi minh': 6, 'hcm': 6, 'tphcm': 6,
  'shiki': 7, 'sk': 7,
};

const API_SEARCH = 'https://warehousedepartureapi.vanchuyenkinkin.com/warehousedeparture/api/packageF/get-paginated-list';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  })
);

const TRACKING = args.tracking || '';
const CUSTOMER = args.customer || '';
const START = args.start || '';
const END = args.end || '';
const WAREHOUSE_NAME = (args.warehouse || 'Hà nội').toLowerCase().trim();

if (!TRACKING && !CUSTOMER) {
  console.log(JSON.stringify({ success: false, error: 'need --tracking or --customer' }));
  process.exit(1);
}

function parseVnDate(s) {
  // "DD/MM/YYYY" → ISO string
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return new Date(`${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00Z`).toISOString();
}

function getWarehouseId(name) {
  return WAREHOUSE_MAP[name] || 5; // default Hà nội
}

function loadToken() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const o of d.origins || []) {
      if (o.origin && o.origin.includes('kinkin')) {
        for (const ls of o.localStorage || []) {
          if (ls.name === 'access_token') return ls.value;
        }
      }
    }
  } catch {}
  return null;
}

async function refreshTokenViaBrowser() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1568, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto('https://khodi.vanchuyenkinkin.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('input[placeholder="Tên đăng nhập"]', { timeout: 10000 });
    await page.fill('input[placeholder="Tên đăng nhập"]', USERNAME);
    await page.fill('input[placeholder="Mật khẩu"]', PASSWORD);
    await page.click('button:has-text("Đăng nhập"), a:has-text("Đăng nhập")');
    await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => null);
    await ctx.storageState({ path: STATE_FILE });
  } finally {
    await browser.close();
  }
  return loadToken();
}

async function callSearchApi(token, wareHouseId) {
  // Default range: 1 năm gần đây → hiện tại
  const defaultEnd = new Date();
  const defaultStart = new Date(defaultEnd.getTime() - 365 * 24 * 3600 * 1000);

  const body = {
    page: 1,
    pageSize: 50,
    sortField: '',
    sortOrder: 'ASC',
    textSerach: TRACKING || CUSTOMER || '',
    stockInStatusId: 0,
    packageFStatusId: 0,
    toDate: parseVnDate(END) || defaultEnd.toISOString(),
    fromDate: parseVnDate(START) || defaultStart.toISOString(),
    createDate: null,
    wareHouseId,
  };

  const res = await fetch(API_SEARCH, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return { status: res.status, json: res.ok ? await res.json() : null, text: !res.ok ? (await res.text()).slice(0, 200) : null, wareHouseId };
}

async function searchWithFallback(token) {
  // Step 1: thử HN trước (case phổ biến) — ~1.5s
  const hn = await callSearchApi(token, 5);
  if (hn.json?.data?.length > 0) return hn;

  // Step 2: HN trống → parallel HCM + Shiki (song song để nhanh) — thêm ~1.5s
  const [hcm, shiki] = await Promise.all([
    callSearchApi(token, 6).catch(e => ({ error: e, wareHouseId: 6 })),
    callSearchApi(token, 7).catch(e => ({ error: e, wareHouseId: 7 })),
  ]);
  if (hcm.json?.data?.length > 0) return hcm;
  if (shiki.json?.data?.length > 0) return shiki;

  // Không kho nào có → return HN (cho thông báo "không tìm thấy")
  return hn;
}

function mapApiRowToSchema(r) {
  const dateParts = (r.inspector || '').trim();
  // Field mapping:
  //   Mã F          = packageFName
  //   Mã tracking   = trackingCode
  //   Ngày chốt     = creationTime (ISO)
  //   Nhập kho đi   = inspector ("<SĐT> DD/MM/YYYY HH:mm:ss")
  return {
    stt: '1',
    maF: r.packageFName || r.packageFCode || '',
    fCha: r.packageParentCode || '',
    kChuyenHang: r.packageKBillCode || '',
    ngay: dateParts || (r.creationTime || ''),
    ngayTaoF: r.creationTime || '',
    maTracking: r.trackingCode || '',
    canNang: String(r.weight ?? ''),
    maKH: r.customerCode || '',
    cod: String(r.amountCOD ?? '0'),
    note: r.note || '',
    trangThai: r.statusProperty?.statusName || '',
    nguonTao: r.packageSourceProperty?.statusName || '',
    maHoaDon: r.vatBillCode || r.invoiceNumber || '',
    imageUrl: r.pictureUrl || '',
  };
}

async function main() {
  let token = loadToken();
  if (!token) {
    token = await refreshTokenViaBrowser();
    if (!token) throw new Error('cannot obtain auth token');
  }

  // Nếu user chỉ định warehouse rõ ràng (không phải default "Hà nội") → chỉ tra kho đó
  // Nếu default → search parallel cả 3 kho, ưu tiên kho đầu tiên có kết quả
  const userSpecifiedWarehouse = args.warehouse && args.warehouse !== 'Hà nội';

  let result;
  if (userSpecifiedWarehouse) {
    result = await callSearchApi(token, getWarehouseId(WAREHOUSE_NAME));
  } else {
    result = await searchWithFallback(token);
  }

  // Token expired retry
  if (result.status === 401) {
    token = await refreshTokenViaBrowser();
    if (!token) throw new Error('auth refresh failed');
    result = userSpecifiedWarehouse
      ? await callSearchApi(token, getWarehouseId(WAREHOUSE_NAME))
      : await searchWithFallback(token);
  }

  if (!result.json || !result.json.responseStatus) {
    const err = result.json?.responseMess || result.text || `HTTP ${result.status}`;
    console.log(JSON.stringify({ success: false, error: err }));
    process.exit(1);
  }

  const rows = (result.json.data || []).map(mapApiRowToSchema);
  const warehouseName = {5:'Hà nội', 6:'Hồ chí minh', 7:'Shiki'}[result.wareHouseId] || WAREHOUSE_NAME;

  if (rows.length === 0) {
    const searched = userSpecifiedWarehouse ? [warehouseName] : ['Hà nội', 'Hồ chí minh', 'Shiki'];
    console.log(JSON.stringify({
      success: true, template: 'no-data', warehouse: warehouseName,
      warehousesSearched: searched,
      rows: [], query: { tracking: TRACKING, customer: CUSTOMER },
    }));
    return;
  }

  console.log(JSON.stringify({
    success: true,
    template: rows[0].imageUrl ? 'B' : 'A',
    warehouse: warehouseName,
    rows,
    query: { tracking: TRACKING, customer: CUSTOMER },
  }));
}

main().catch(e => {
  console.log(JSON.stringify({ success: false, error: String(e.message || e).slice(0, 200) }));
  process.exit(1);
});
