/**
 * KinKin Tracking lookup — Core module (inlined, no spawn overhead)
 * Export: lookup({ tracking, customer, start, end, warehouse }) → { success, rows, warehouse, ... }
 */
import fs from 'node:fs';
import path from 'node:path';

// Try to enable keep-alive via undici (built-in to Node 18+). Best-effort.
try {
  const { Agent, setGlobalDispatcher } = await import('undici').catch(() => ({}));
  if (Agent && setGlobalDispatcher) {
    setGlobalDispatcher(new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 60_000, connections: 10 }));
  }
} catch {}

const STATE_FILE = path.resolve(process.env.WORKSPACE_DIR || process.cwd(), '.auth-state.json');
const USERNAME = process.env.KINKIN_USERNAME;
const PASSWORD = process.env.KINKIN_PASSWORD;
if (!USERNAME || !PASSWORD) {
  throw new Error('Missing env: KINKIN_USERNAME / KINKIN_PASSWORD');
}

const WAREHOUSE_MAP = {
  'hà nội': 5, 'ha noi': 5, 'hn': 5,
  'hồ chí minh': 6, 'ho chi minh': 6, 'hcm': 6, 'tphcm': 6,
  'shiki': 7, 'sk': 7,
};

const API_SEARCH = 'https://warehousedepartureapi.vanchuyenkinkin.com/warehousedeparture/api/packageF/get-paginated-list';

function parseVnDate(s) {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return new Date(`${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00Z`).toISOString();
}

function getWarehouseId(name) {
  return WAREHOUSE_MAP[(name || '').toLowerCase().trim()] || 5;
}

function loadToken() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const o of d.origins || []) {
      if (o.origin?.includes('kinkin')) {
        for (const ls of o.localStorage || []) {
          if (ls.name === 'access_token') return ls.value;
        }
      }
    }
  } catch {}
  return null;
}

// Cache JWT in memory — avoid re-reading file each call
let cachedToken = null;
function getToken() {
  if (cachedToken) return cachedToken;
  cachedToken = loadToken();
  return cachedToken;
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
  cachedToken = null;
  return getToken();
}

async function callSearchApi(token, wareHouseId, opts) {
  const defaultEnd = new Date();
  const defaultStart = new Date(defaultEnd.getTime() - 365 * 24 * 3600 * 1000);

  const body = {
    page: 1,
    pageSize: 50,
    sortField: '',
    sortOrder: 'ASC',
    textSerach: opts.tracking || opts.customer || '',
    stockInStatusId: 0,
    packageFStatusId: 0,
    toDate: parseVnDate(opts.end) || defaultEnd.toISOString(),
    fromDate: parseVnDate(opts.start) || defaultStart.toISOString(),
    createDate: null,
    wareHouseId,
  };

  const res = await fetch(API_SEARCH, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return {
    status: res.status,
    json: res.ok ? await res.json() : null,
    text: !res.ok ? (await res.text()).slice(0, 200) : null,
    wareHouseId,
  };
}

async function searchWithFallback(token, opts) {
  // Step 1: HN trước
  const hn = await callSearchApi(token, 5, opts);
  if (hn.json?.data?.length > 0) return hn;
  // Step 2: parallel HCM + Shiki
  const [hcm, shiki] = await Promise.all([
    callSearchApi(token, 6, opts).catch(e => ({ error: e, wareHouseId: 6 })),
    callSearchApi(token, 7, opts).catch(e => ({ error: e, wareHouseId: 7 })),
  ]);
  if (hcm.json?.data?.length > 0) return hcm;
  if (shiki.json?.data?.length > 0) return shiki;
  return hn;
}

function mapApiRowToSchema(r) {
  // inspector format: "<SĐT> DD/MM/YYYY HH:mm:ss" → split thành Người kiểm + Ngày kiểm
  const insp = (r.inspector || '').trim();
  const inspMatch = insp.match(/^(\S+)\s+(.+)$/);
  const nguoiKiemHoa = inspMatch ? inspMatch[1] : '';
  const ngayKiemHoa = inspMatch ? inspMatch[2] : insp;

  return {
    stt: '1',
    maF: r.packageFName || r.packageFCode || '',
    fCha: r.packageParentCode || '',
    kChuyenHang: r.packageKBillCode || '',
    maTracking: r.trackingCode || '',
    canNang: String(r.weight ?? ''),
    maKH: r.customerCode || '',
    cod: String(r.amountCOD ?? '0'),
    note: r.note || '',
    trangThai: r.statusProperty?.statusName || '',
    nguonTao: r.packageSourceProperty?.statusName || '',
    imageUrl: r.pictureUrl || '',
    // Mapping chuẩn theo yêu cầu user:
    nhapKhoDi: r.creationTime || '',         // creationTime → Ngày nhập kho đi (ISO)
    nguoiKiemHoa,                             // inspector (phần SĐT)
    ngayKiemHoa,                              // inspector (phần date)
    maInvoice: r.invoiceNumber || r.vatBillCode || '',  // Mã Invoice
  };
}

export async function lookup(opts = {}) {
  // opts: { tracking, customer, start, end, warehouse }
  const { tracking, customer, warehouse } = opts;
  if (!tracking && !customer) {
    return { success: false, error: 'need tracking or customer' };
  }

  let token = getToken();
  if (!token) {
    token = await refreshTokenViaBrowser();
    if (!token) return { success: false, error: 'cannot obtain auth token' };
  }

  const userSpecifiedWarehouse = warehouse && warehouse !== 'Hà nội';

  let result;
  try {
    if (userSpecifiedWarehouse) {
      result = await callSearchApi(token, getWarehouseId(warehouse), opts);
    } else {
      result = await searchWithFallback(token, opts);
    }

    if (result.status === 401) {
      token = await refreshTokenViaBrowser();
      if (!token) return { success: false, error: 'auth refresh failed' };
      result = userSpecifiedWarehouse
        ? await callSearchApi(token, getWarehouseId(warehouse), opts)
        : await searchWithFallback(token, opts);
    }
  } catch (e) {
    return { success: false, error: String(e.message || e).slice(0, 200) };
  }

  if (!result.json || !result.json.responseStatus) {
    return { success: false, error: result.json?.responseMess || result.text || `HTTP ${result.status}` };
  }

  const rows = (result.json.data || []).map(mapApiRowToSchema);
  const warehouseName = { 5: 'Hà nội', 6: 'Hồ chí minh', 7: 'Shiki' }[result.wareHouseId] || warehouse;

  if (rows.length === 0) {
    return {
      success: true, template: 'no-data', warehouse: warehouseName,
      warehousesSearched: userSpecifiedWarehouse ? [warehouseName] : ['Hà nội', 'Hồ chí minh', 'Shiki'],
      rows: [], query: { tracking: tracking || '', customer: customer || '' },
    };
  }

  return {
    success: true,
    template: rows[0].imageUrl ? 'B' : 'A',
    warehouse: warehouseName,
    rows,
    query: { tracking: tracking || '', customer: customer || '' },
  };
}
