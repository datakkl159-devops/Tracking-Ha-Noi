#!/usr/bin/env node
/**
 * Standalone Telegram bot — bypass LLM entirely
 * - Polls Telegram (message + callback_query)
 * - Regex intent parse → call KinKin API → reply with inline buttons
 * - Handles @mention + reply-to-bot + button callback
 * Target: 2-3s per query
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Agent, setGlobalDispatcher } from 'undici';
import { lookup, getPackageDetail } from './lookup-core.mjs';
import { appendRow, ensureHeader } from './sheet-logger.mjs';

// Force IPv4 for all fetch calls — Telegram API hangs on IPv6 in VM network.
// --dns-result-order=ipv4first alone không đủ, phải ép family:4 ở undici layer.
setGlobalDispatcher(new Agent({
  connect: { family: 4 },
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 60_000,
  connections: 10,
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKDIR = path.dirname(__dirname);
const OFFSET_FILE = path.join(WORKDIR, '.tg-offset');

const TOKEN = '8640692193:AAGhKc4Xa-rIB3njfg8w3WEZxp2mM_Qkd7E';
const TG = `https://api.telegram.org/bot${TOKEN}`;
const BOT_USERNAME = 'Bottrackin_bot';
const BOT_ID = 8640692193;

// Allowed chats persistence (có thể thêm group mới runtime qua file)
const ALLOWED_CHATS_FILE = path.join(WORKDIR, '.allowed-chats.json');
const DEFAULT_ALLOWED = [-5251554601]; // Test tracking
function loadAllowedChats() {
  try {
    if (fs.existsSync(ALLOWED_CHATS_FILE)) {
      const arr = JSON.parse(fs.readFileSync(ALLOWED_CHATS_FILE, 'utf8'));
      if (Array.isArray(arr)) return arr;
    }
  } catch {}
  return DEFAULT_ALLOWED;
}
function saveAllowedChats(list) {
  try { fs.writeFileSync(ALLOWED_CHATS_FILE, JSON.stringify(list)); } catch {}
}
let ALLOWED_CHATS = loadAllowedChats();
// Reload periodically (để có thể edit file mà không restart)
setInterval(() => { ALLOWED_CHATS = loadAllowedChats(); }, 30_000);

// Group → Sheet mapping (log ALL messages to per-group Google Sheet)
const GROUP_SHEETS_FILE = path.join(WORKDIR, '.group-sheets.json');
function loadGroupSheets() {
  try {
    if (fs.existsSync(GROUP_SHEETS_FILE)) {
      return JSON.parse(fs.readFileSync(GROUP_SHEETS_FILE, 'utf8'));
    }
  } catch {}
  return {};
}
let GROUP_SHEETS = loadGroupSheets();
setInterval(() => { GROUP_SHEETS = loadGroupSheets(); }, 30_000);

// Track which sheets đã có header — avoid redundant read calls
const headerEnsured = new Set();
async function ensureHeaderOnce(sheetId) {
  if (headerEnsured.has(sheetId)) return;
  headerEnsured.add(sheetId);
  try {
    await ensureHeader(sheetId, 'Log', [
      'timestamp', 'chat_id', 'chat_title', 'type', 'account_type',
      'sender_id', 'sender_username', 'sender_name',
      'message_id', 'reply_to_msg_id', 'replied_to_user', 'text', 'mentioned_bot',
    ]);
  } catch (e) {
    logInfo('sheet header err:', e.message);
    headerEnsured.delete(sheetId); // retry later
  }
}

// Timestamp dạng DD/MM/YYYY HH:MM:SS theo giờ Việt Nam (UTC+7).
// Không dùng toLocaleString vì phụ thuộc server locale — tự tính offset để đảm bảo đúng dù server khác TZ.
function tsVN() {
  const vn = new Date(Date.now() + 7 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(vn.getUTCDate())}/${pad(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()} ${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}:${pad(vn.getUTCSeconds())}`;
}

function logToSheet(chatId, type, data) {
  const sheetId = GROUP_SHEETS[String(chatId)];
  if (!sheetId) return;
  // account_type derived from type: bot_* = bot, everything else = user
  const accountType = type.startsWith('bot_') ? 'bot' : 'user';
  // Fire-and-forget — never block reply
  (async () => {
    try {
      await ensureHeaderOnce(sheetId);
      await appendRow(sheetId, 'Log', [
        tsVN(),
        String(chatId),
        data.chat_title || '',
        type,
        accountType,
        String(data.sender_id || ''),
        data.sender_username || '',
        data.sender_name || '',
        String(data.message_id || ''),
        String(data.reply_to_msg_id || ''),
        data.replied_to_user || '',
        (data.text || '').slice(0, 2000),
        data.mentioned_bot ? 'true' : 'false',
      ]);
    } catch (e) {
      logInfo(`sheet log err [chat=${chatId}]:`, e.message);
    }
  })();
}

// ═══════════════════════════════════════════════════════════
// Photo optimization: file_id cache + upload concurrency
// ═══════════════════════════════════════════════════════════
// Sau lần upload đầu, Telegram trả file_id reusable vĩnh viễn (với cùng bot).
// Cache → lần sau gửi cùng URL: chỉ cần gửi file_id, không download/upload.
// → Với 10k ảnh: chỉ 1 upload/ảnh unique, các lần sau instant.
const FILE_ID_CACHE_FILE = path.join(WORKDIR, '.file-id-cache.json');
const FILE_ID_TTL = 7 * 24 * 3600 * 1000; // 7 days
const fileIdCache = new Map(); // imageUrl → { file_id, ts }

function loadFileIdCache() {
  try {
    if (!fs.existsSync(FILE_ID_CACHE_FILE)) return;
    const obj = JSON.parse(fs.readFileSync(FILE_ID_CACHE_FILE, 'utf8'));
    const now = Date.now();
    for (const [url, v] of Object.entries(obj)) {
      if (v?.file_id && v?.ts && now - v.ts < FILE_ID_TTL) {
        fileIdCache.set(url, v);
      }
    }
    logInfo(`file_id cache loaded: ${fileIdCache.size} entries`);
  } catch (e) { logInfo('file_id cache load err:', e.message); }
}
let fileIdSaveTimer = null;
function persistFileIdCache() {
  if (fileIdSaveTimer) return;
  fileIdSaveTimer = setTimeout(() => {
    fileIdSaveTimer = null;
    try {
      const obj = {};
      for (const [k, v] of fileIdCache) obj[k] = v;
      fs.writeFileSync(FILE_ID_CACHE_FILE, JSON.stringify(obj));
    } catch (e) { logInfo('file_id cache save err:', e.message); }
  }, 3000);
}

// Upload concurrency limit — max 5 parallel downloads+uploads
// Telegram rate limit: ~30 msg/sec global, 1/sec/chat cho text; sendPhoto nặng hơn.
// 5 concurrent = an toàn + đủ throughput cho burst 10k ảnh (spread qua queue).
const MAX_CONCURRENT_UPLOADS = 5;
let activeUploads = 0;
const uploadWaitQueue = [];
async function withUploadSlot(fn) {
  if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
    await new Promise(r => uploadWaitQueue.push(r));
  }
  activeUploads++;
  try { return await fn(); }
  finally {
    activeUploads--;
    const next = uploadWaitQueue.shift();
    if (next) next();
  }
}

// Track the code per (chat, user) so user can tap button without re-typing
// Keyed by `${chatId}:${userId}`, value: { code, warehouse, timestamp }
const contextCache = new Map();
const CONTEXT_TTL = 30 * 60 * 1000; // 30 min

// Result cache — same code → same data. Button taps reuse this.
// Keyed by `${code}`, value: { result, timestamp }
const resultCache = new Map();
const RESULT_TTL = 5 * 60 * 1000; // 5 min — cùng mã trong 5 phút reuse cache (bấm button liên tục instant)

// Cache danh sách sản phẩm theo packageFId (cùng TTL 5min với search cache)
const detailCache = new Map(); // packageFId → { products, ts }
async function getProductsCached(packageFId) {
  if (!packageFId) return null;
  const c = detailCache.get(packageFId);
  if (c && Date.now() - c.ts < RESULT_TTL) return c.products;
  const r = await getPackageDetail(packageFId);
  if (!r.success) return null;
  const products = r.packageFProduct || [];
  detailCache.set(packageFId, { products, ts: Date.now() });
  if (detailCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of detailCache.entries()) if (now - v.ts > RESULT_TTL) detailCache.delete(k);
  }
  return products;
}

// Format danh sách sản phẩm thành bảng monospace (Telegram code block)
// Cột tự co dãn theo nội dung dài nhất — KHÔNG truncate, hiển thị đầy đủ text
function formatProductTable(products) {
  if (!products || products.length === 0) return '⚠️ Kiện này chưa có danh sách hàng';
  const clean = s => String(s ?? '').replace(/\n/g, ' ').trim();
  const cleaned = products.map(p => ({
    code: clean(p.productCode),
    qty: clean(p.quantity),
    remi: clean(p.reminiscentName) || '-',
    name: clean(p.productName),
  }));
  const W = {
    code: Math.max('Mã hàng'.length, ...cleaned.map(p => p.code.length)),
    qty: Math.max('SL'.length, ...cleaned.map(p => p.qty.length)),
    remi: Math.max('Gợi nhớ'.length, ...cleaned.map(p => p.remi.length)),
    name: Math.max('Tên hàng'.length, ...cleaned.map(p => p.name.length)),
  };
  const pad = (s, n, right) => right ? String(s).padStart(n) : String(s).padEnd(n);
  const COL = ' │ ';   // vertical separator giữa các cột
  const SEP_X = '─┼─'; // intersection ở separator row
  const header = `${pad('Mã hàng', W.code)}${COL}${pad('SL', W.qty, true)}${COL}${pad('Gợi nhớ', W.remi)}${COL}${pad('Tên hàng', W.name)}`;
  const sep = `${'─'.repeat(W.code)}${SEP_X}${'─'.repeat(W.qty)}${SEP_X}${'─'.repeat(W.remi)}${SEP_X}${'─'.repeat(W.name)}`;
  const rows = cleaned.map(p =>
    `${pad(p.code, W.code)}${COL}${pad(p.qty, W.qty, true)}${COL}${pad(p.remi, W.remi)}${COL}${pad(p.name, W.name)}`
  );
  return '```\n' + [header, sep, ...rows].join('\n') + '\n```';
}

// Load offset từ file (persist qua restart → tránh re-process updates cũ)
let offset = 0;
try {
  if (fs.existsSync(OFFSET_FILE)) {
    const saved = parseInt(fs.readFileSync(OFFSET_FILE, 'utf8'), 10);
    if (Number.isFinite(saved) && saved > 0) offset = saved;
  }
} catch {}

function saveOffset() {
  try { fs.writeFileSync(OFFSET_FILE, String(offset)); } catch {}
}

// Idempotency: track processed update IDs to guard against duplicate delivery
const processedUpdates = new Set();
const MAX_PROCESSED = 500;
function markProcessed(updateId) {
  processedUpdates.add(updateId);
  if (processedUpdates.size > MAX_PROCESSED) {
    // Remove oldest entries (Set preserves insertion order)
    const excess = processedUpdates.size - MAX_PROCESSED;
    let i = 0;
    for (const id of processedUpdates) {
      if (i >= excess) break;
      processedUpdates.delete(id);
      i++;
    }
  }
}

function logInfo(...args) { console.log(`[${new Date().toISOString()}]`, ...args); }

function getCtx(chatId, userId) {
  const k = `${chatId}:${userId}`;
  const v = contextCache.get(k);
  if (!v || Date.now() - v.timestamp > CONTEXT_TTL) { contextCache.delete(k); return null; }
  return v;
}
function setCtx(chatId, userId, code, warehouse, start, end) {
  contextCache.set(`${chatId}:${userId}`, { code, warehouse, start, end, timestamp: Date.now() });
}

function parseDateRange(text) {
  // Output: { start: "DD/MM/YYYY", end: "DD/MM/YYYY" } hoặc {}
  const lower = text.toLowerCase();
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;

  // "từ DD/MM[/YYYY] đến DD/MM[/YYYY]"
  const m1 = text.match(/từ\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(?:đến|tới|-)\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);
  if (m1) {
    const normDate = s => {
      const parts = s.split('/');
      if (parts.length === 2) parts.push(String(now.getFullYear()));
      let y = parts[2]; if (y.length === 2) y = '20' + y;
      return `${pad(parts[0])}/${pad(parts[1])}/${y}`;
    };
    return { start: normDate(m1[1]), end: normDate(m1[2]) };
  }

  // "hôm nay" / "today"
  if (/hôm nay|today/i.test(lower)) return { start: fmt(now), end: fmt(now) };

  // "hôm qua" / "yesterday"
  if (/hôm qua|yesterday/i.test(lower)) {
    const y = new Date(now.getTime() - 24*3600*1000);
    return { start: fmt(y), end: fmt(y) };
  }

  // "tuần này" (7 ngày gần nhất)
  if (/tuần này|tuần nay|this week/i.test(lower)) {
    const a = new Date(now.getTime() - 6*24*3600*1000);
    return { start: fmt(a), end: fmt(now) };
  }

  // "tuần trước" (7-14 ngày trước)
  if (/tuần trước|tuan truoc|last week/i.test(lower)) {
    const a = new Date(now.getTime() - 13*24*3600*1000);
    const b = new Date(now.getTime() - 7*24*3600*1000);
    return { start: fmt(a), end: fmt(b) };
  }

  // "tháng N" (tháng N của năm hiện tại)
  const mMonth = lower.match(/tháng\s+(\d{1,2})/);
  if (mMonth) {
    const M = parseInt(mMonth[1], 10);
    if (M >= 1 && M <= 12) {
      return { start: `01/${pad(M)}/${now.getFullYear()}`, end: `${pad(new Date(now.getFullYear(), M, 0).getDate())}/${pad(M)}/${now.getFullYear()}` };
    }
  }

  // "tháng này" (tháng hiện tại)
  if (/tháng này|tháng nay|this month/i.test(lower)) {
    return { start: `01/${pad(now.getMonth()+1)}/${now.getFullYear()}`, end: fmt(now) };
  }

  return {};
}

function parseIntent(text) {
  const cleaned = text.replace(new RegExp(`@${BOT_USERNAME}`, 'gi'), '').trim();
  const codeRe = /\b([Ff]\d{6,8}|[A-Z0-9]{6,15}|[A-Z0-9]+-[A-Z0-9]+)\b/g;
  const codes = [...cleaned.matchAll(codeRe)].map(m => m[1]);
  const code = codes[0];

  const lower = cleaned.toLowerCase();
  let mode = 'default';
  // Priority order: more specific → more generic
  if (/trạng thái|status|tình trạng|tinh trang|trang thai/.test(lower)) mode = 'status';
  else if (/cân nặng|nang bao nhieu|nặng bao nhiêu|nang kg|trọng lượng|trong luong|\bkg\b/.test(lower)) mode = 'weight';
  else if (/nhập kho đi|ngày nhập|nhap kho di|ngay nhap|đã nhập kho|da nhap kho/.test(lower)) mode = 'nhap-kho';
  else if (/kiểm hoá|kiểm hóa|kiem hoa|người kiểm|nguoi kiem|ngày kiểm|ngay kiem|ai kiểm|ai kiem/.test(lower)) mode = 'kiem-hoa';
  else if (/invoice|mã hoá đơn|hoá đơn|hóa đơn|hoa don|ma hoa don|mã invoice|ma invoice/.test(lower)) mode = 'invoice';
  else if (/ghi chú|ghi chu|note|remarks|lưu ý/.test(lower)) mode = 'note';
  else if (/\bcod\b|tiền thu hộ|tien thu ho/.test(lower)) mode = 'cod';
  else if (/hình ảnh|hinh anh|xem ảnh|xem anh|link ảnh|link anh|picture|\bảnh\b|\banh\b|photo/.test(lower)) mode = 'image';
  else if (/thông tin|thong tin|chi tiết|chi tiet|đầy đủ|day du|full|tất cả|tat ca|xem hết|xem het/.test(lower)) mode = 'full';
  else if (/danh sách hàng|danh sach hang|ds hàng|ds hang|sản phẩm|san pham|product list|list hàng|list hang|hàng hoá|hang hoa/.test(lower)) mode = 'product-list';

  const isCustomer = code && (/^[A-Z]\d+-[A-Z0-9]+$/i.test(code) || /-[A-Z]+$/.test(code));

  let warehouse = 'Hà nội';
  if (/hồ chí minh|hcm|tphcm/i.test(lower)) warehouse = 'Hồ chí minh';
  else if (/shiki|nhật|saitama/i.test(lower)) warehouse = 'Shiki';

  const { start, end } = parseDateRange(cleaned);

  return { mode, code, isCustomer, warehouse, start, end };
}

async function callLookup({ code, isCustomer, warehouse, start, end }) {
  const cacheKey = `${code}:${isCustomer ? 'c' : 't'}:${start || ''}:${end || ''}`;
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < RESULT_TTL) {
    logInfo(`cache hit: ${code}`);
    return cached.result;
  }

  // Gọi inline — không spawn child process (tiết kiệm ~300-500ms)
  const opts = { [isCustomer ? 'customer' : 'tracking']: code, warehouse, start, end };
  const result = await lookup(opts);

  if (result.success) {
    resultCache.set(cacheKey, { result, timestamp: Date.now() });
    if (resultCache.size > 100) {
      const now = Date.now();
      for (const [k, v] of resultCache.entries()) {
        if (now - v.timestamp > RESULT_TTL) resultCache.delete(k);
      }
    }
  }

  return result;
}

function tagUser(user) {
  return user?.username ? `@${user.username}` : user?.first_name || 'bạn';
}

function extractDate(s) {
  const m = (s || '').match(/(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}:\d{2})?)/);
  return m ? m[1] : s;
}

function formatIsoDate(iso) {
  if (!iso) return '(chưa có)';
  try {
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch { return iso; }
}

// Format số tiền VND: 12345.00 → "12.345 ₫"
function formatMoney(v) {
  if (!v || v === '0' || v === 0) return '0 ₫';
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return String(v);
  // Thousand separator: 12345.67 → 12,345.67 (US), dùng "." cho VN
  const formatted = Math.round(n).toLocaleString('vi-VN');
  return `${formatted} ₫`;
}

// Format cân nặng: 12.9 → "12,9 kg" (dấu phẩy thập phân theo VN)
function formatWeight(v) {
  if (!v) return '(chưa có)';
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return `${v} kg`;
  // Replace "." by "," for VN decimal style
  return `${String(n).replace('.', ',')} kg`;
}

// Format số điện thoại: 0982339934 → "0982 339 934"
function formatPhone(p) {
  if (!p) return '(chưa có)';
  const digits = p.replace(/\D/g, '');
  if (digits.length === 10) return `${digits.slice(0,4)} ${digits.slice(4,7)} ${digits.slice(7)}`;
  if (digits.length === 11) return `${digits.slice(0,4)} ${digits.slice(4,7)} ${digits.slice(7)}`;
  return p;
}

// Value rỗng/dash → "(chưa có)" để rõ ràng
function formatOrEmpty(v, suffix = '') {
  if (!v || v === '-' || v === '0') return '(chưa có)';
  return `${v}${suffix}`;
}

function formatReply(intent, result, user) {
  const tag = tagUser(user);

  if (intent.mode === 'no-code') {
    return { text: `${tag}\nVui lòng cho mình biết Mã F (vd \`F1050159\`) hoặc Mã KH.`, buttons: null };
  }
  if (!result?.success) {
    return { text: `${tag}\n📦 Mã tracking: \`${intent.code}\`\n⚠️ Hệ thống chậm, vui lòng thử lại.`, buttons: null };
  }
  if (!result.rows || result.rows.length === 0) {
    return {
      text: `${tag}\n📦 Mã tracking: \`${intent.code}\`\n❌ Không tìm thấy dữ liệu.`,
      buttons: null,
    };
  }

  const r = result.rows[0];
  const wh = result.warehouse;
  const HR = '━━━━━━━━━━━━━━━━━━';
  // Tiêu đề chung — áp dụng MỌI mode
  const title = `📦 Mã tracking: \`${intent.code}\``;
  let answer;

  switch (intent.mode) {
    case 'status':
      answer = `✅ Trạng thái: *${r.trangThai || '(chưa có)'}*`;
      break;

    case 'weight':
      answer = `⚖️ Cân nặng: *${formatWeight(r.canNang)}*`;
      break;

    case 'nhap-kho':
      answer = `🚚 Ngày nhập kho đi: *${formatIsoDate(r.nhapKhoDi)}*`;
      break;

    case 'kiem-hoa':
      answer = [
        `👷 Người kiểm hoá: *${formatPhone(r.nguoiKiemHoa)}*`,
        `📅 Ngày kiểm hoá: *${r.ngayKiemHoa || '(chưa có)'}*`,
      ].join('\n');
      break;

    case 'cod':
      answer = `💰 COD: *${formatMoney(r.cod)}*`;
      break;

    case 'note':
      answer = `📝 Ghi chú: *${r.note || '(chưa có)'}*`;
      break;

    case 'invoice':
      answer = `🧾 Mã Invoice: *${r.maInvoice || '(chưa có)'}*`;
      break;

    case 'image':
      answer = r.imageUrl ? '🖼 (ảnh kèm theo)' : '⚠️ Kiện này chưa có ảnh trong hệ thống.';
      break;

    case 'product-list': {
      // Products được pre-fetch trong handleMessage/handleCallback và gắn vào intent.__products
      // Chỉ hiện những sản phẩm có isApprovalProduct === false (loại bỏ approval products)
      const all = intent.__products || [];
      const products = all.filter(p => p.isApprovalProduct === false);
      answer = `📦 Danh sách hàng (${products.length} mã):\n${formatProductTable(products)}`;
      break;
    }

    case 'full': {
      const rows = [HR];
      rows.push(`📋 *${r.maF}* — Kho ${wh}`);
      if (r.maTracking && r.maTracking !== r.maF) rows.push(`🔗 Mã tracking: \`${r.maTracking}\``);
      if (r.maK) rows.push(`🏷 Mã K: \`${r.maK}\``);
      if (r.nhapKhoDi) rows.push(`🚚 Nhập kho đi: *${formatIsoDate(r.nhapKhoDi)}*`);
      if (r.nguoiKiemHoa || r.ngayKiemHoa) rows.push(`👷 Kiểm hoá: ${formatPhone(r.nguoiKiemHoa)} • ${r.ngayKiemHoa || '(chưa có)'}`);
      if (r.canNang) rows.push(`⚖️ Cân nặng: *${formatWeight(r.canNang)}*`);
      if (r.maKH) rows.push(`👤 Mã KH: \`${r.maKH}\``);
      if (r.cod && r.cod !== '0') rows.push(`💰 COD: *${formatMoney(r.cod)}*`);
      if (r.trangThai) rows.push(`✅ Trạng thái: *${r.trangThai}*`);
      if (r.kChuyenHang) rows.push(`📦 Chuyến hàng: ${r.kChuyenHang}`);
      if (r.nguonTao) rows.push(`📲 Nguồn tạo: ${r.nguonTao}`);
      if (r.maInvoice) rows.push(`🧾 Mã Invoice: *${r.maInvoice}*`);
      if (r.note) rows.push(`📝 Ghi chú: ${r.note}`);
      rows.push(HR);
      answer = rows.join('\n');
      break;
    }

    default:
      answer = [
        HR,
        `📋 *${r.maF}* — Kho ${wh}`,
        `🏷 Mã K: \`${r.maK || '(chưa có)'}\``,
        `👤 Mã KH: \`${r.maKH || '(chưa có)'}\``,
        `⚖️ Cân nặng: *${formatWeight(r.canNang)}*`,
        `✅ Trạng thái: *${r.trangThai || '(chưa có)'}*`,
        HR,
      ].join('\n');
  }

  // Format: tag → tiêu đề Mã tracking → xuống dòng → câu trả lời
  const text = `${tag}\n${title}\n${answer}`;
  const buttons = buildButtons(r.maF);

  // Send as inline photo cho modes có nhu cầu hiển thị ảnh: image + full
  const photoUrl = ((intent.mode === 'image' || intent.mode === 'full') && r.imageUrl) ? r.imageUrl : null;

  return { text, buttons, code: r.maF, warehouse: wh, photoUrl };
}

function buildButtons(code) {
  // Suggestion buttons — 3 cột × 2 hàng (6 nút)
  return {
    inline_keyboard: [
      [
        { text: '✅ Trạng thái', callback_data: `status:${code}` },
        { text: '🖼 Cần ảnh', callback_data: `image:${code}` },
        { text: '🚚 Nhập kho đi', callback_data: `nhap-kho:${code}` },
      ],
      [
        { text: '👷 Kiểm hoá', callback_data: `kiem-hoa:${code}` },
        { text: '🧾 Invoice', callback_data: `invoice:${code}` },
        { text: '📋 Chi tiết', callback_data: `full:${code}` },
      ],
      [
        { text: '📦 Danh sách hàng', callback_data: `product-list:${code}` },
      ],
    ],
  };
}

async function sendReply(chatId, text, replyTo, buttons, triggerUser, chatTitle) {
  const nonce = Math.random().toString(36).slice(2, 7);
  logInfo(`→ sendMessage [nonce=${nonce}] to chat ${chatId}, replyTo=${replyTo}`);
  try {
    const body = {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      allow_sending_without_reply: true,
    };
    if (replyTo) body.reply_to_message_id = replyTo;
    if (buttons) body.reply_markup = buttons;
    const res = await fetch(`${TG}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const j = await res.json();
    if (!j.ok) {
      logInfo(`✗ sendMessage [${nonce}] failed:`, j.description);
    } else {
      logInfo(`✓ sendMessage [${nonce}] sent msgId=${j.result?.message_id}`);
      logToSheet(chatId, 'bot_reply', {
        chat_title: chatTitle || '',
        sender_id: BOT_ID,
        sender_username: BOT_USERNAME,
        sender_name: 'Bot Tracking',
        message_id: j.result?.message_id,
        reply_to_msg_id: replyTo,
        replied_to_user: triggerUser?.username || [triggerUser?.first_name, triggerUser?.last_name].filter(Boolean).join(' '),
        text,
        mentioned_bot: false,
      });
    }
    return j;
  } catch (e) { logInfo(`✗ sendMessage [${nonce}] error:`, e.message); }
}

async function editMessageText(chatId, messageId, text, buttons) {
  try {
    const res = await fetch(`${TG}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId, message_id: messageId, text,
        parse_mode: 'Markdown',
        reply_markup: buttons || undefined,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json();
    return j.ok ? j : null;
  } catch { return null; }
}

async function editMessageCaption(chatId, messageId, caption, buttons) {
  try {
    const res = await fetch(`${TG}/editMessageCaption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId, message_id: messageId, caption,
        parse_mode: 'Markdown',
        reply_markup: buttons || undefined,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json();
    return j.ok ? j : null;
  } catch { return null; }
}

async function sendPhotoJsonBody(body, timeoutMs = 15000) {
  const res = await fetch(`${TG}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

async function sendPhoto(chatId, photoUrl, caption, replyTo, buttons, triggerUser, chatTitle) {
  const nonce = Math.random().toString(36).slice(2, 7);
  logInfo(`→ sendPhoto [nonce=${nonce}] to chat ${chatId}`);
  try {
    const baseBody = {
      chat_id: chatId, caption: caption || '', parse_mode: 'Markdown', allow_sending_without_reply: true,
      ...(replyTo ? { reply_to_message_id: replyTo } : {}),
      ...(buttons ? { reply_markup: buttons } : {}),
    };

    // ──────── 1. Fast path: file_id cache hit ────────
    const cached = fileIdCache.get(photoUrl);
    if (cached && Date.now() - cached.ts < FILE_ID_TTL) {
      const j = await sendPhotoJsonBody({ ...baseBody, photo: cached.file_id });
      if (j.ok) {
        logInfo(`✓ sendPhoto [${nonce}] cached file_id, sent msgId=${j.result?.message_id}`);
        logToSheet(chatId, 'bot_reply', {
          chat_title: chatTitle || '', sender_id: BOT_ID, sender_username: BOT_USERNAME, sender_name: 'Bot Tracking',
          message_id: j.result?.message_id, reply_to_msg_id: replyTo,
          replied_to_user: triggerUser?.username || [triggerUser?.first_name, triggerUser?.last_name].filter(Boolean).join(' '),
          text: `[photo:${photoUrl}] ${caption || ''}`, mentioned_bot: false,
        });
        return j;
      }
      // file_id stale/invalid → invalidate and fall through to upload
      logInfo(`! file_id stale for ${photoUrl} — re-uploading`);
      fileIdCache.delete(photoUrl);
    }

    // ──────── 2. Slow path: download + upload via multipart (với concurrency limit) ────────
    const j = await withUploadSlot(async () => {
      let photoBuffer = null;
      try {
        const imgRes = await fetch(photoUrl, { signal: AbortSignal.timeout(10000) });
        if (imgRes.ok && (imgRes.headers.get('content-type') || '').startsWith('image/')) {
          photoBuffer = Buffer.from(await imgRes.arrayBuffer());
        }
      } catch (e) { logInfo(`download err [${nonce}]:`, e.message); }

      if (!photoBuffer) {
        // Fall back to URL method (Telegram tự fetch — thường fail với KinKin nhưng vẫn thử)
        return await sendPhotoJsonBody({ ...baseBody, photo: photoUrl });
      }

      // Retry loop for 429 Too Many Requests
      for (let attempt = 0; attempt < 3; attempt++) {
        const form = new FormData();
        for (const [k, v] of Object.entries(baseBody)) form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
        const fname = (photoUrl.split('/').pop() || 'photo.jpg').split('?')[0];
        form.append('photo', new Blob([photoBuffer], { type: 'image/jpeg' }), fname);
        const res = await fetch(`${TG}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
        const result = await res.json();
        if (result.ok) return result;
        if (result.error_code === 429 && result.parameters?.retry_after) {
          const wait = (result.parameters.retry_after + 1) * 1000;
          logInfo(`! 429 rate limit, waiting ${wait}ms (attempt ${attempt + 1})`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        return result;
      }
      return { ok: false, description: '429 retry exhausted' };
    });

    if (!j.ok) {
      logInfo(`✗ sendPhoto [${nonce}] failed:`, j.description);
      const fallbackText = (photoUrl ? `🖼 [Xem ảnh](${photoUrl})\n` : '') + (caption || '');
      await sendReply(chatId, fallbackText, replyTo, buttons, triggerUser, chatTitle);
      return j;
    }

    // Cache file_id từ response (largest photo size = last element in array)
    const photos = j.result?.photo || [];
    const bestFileId = photos[photos.length - 1]?.file_id;
    if (bestFileId) {
      fileIdCache.set(photoUrl, { file_id: bestFileId, ts: Date.now() });
      persistFileIdCache();
    }
    logInfo(`✓ sendPhoto [${nonce}] sent msgId=${j.result?.message_id}`);
    logToSheet(chatId, 'bot_reply', {
      chat_title: chatTitle || '',
      sender_id: BOT_ID,
      sender_username: BOT_USERNAME,
      sender_name: 'Bot Tracking',
      message_id: j.result?.message_id,
      reply_to_msg_id: replyTo,
      replied_to_user: triggerUser?.username || [triggerUser?.first_name, triggerUser?.last_name].filter(Boolean).join(' '),
      text: `[photo:${photoUrl}] ${caption || ''}`,
      mentioned_bot: false,
    });
    return j;
  } catch (e) {
    logInfo(`✗ sendPhoto [${nonce}] error:`, e.message);
    return null;
  }
}

async function answerCallback(callbackId, text) {
  try {
    await fetch(`${TG}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, text: text || '', cache_time: 1 }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {}
}

function shouldHandleMessage(msg) {
  const text = msg.text || msg.caption || '';
  // Accept if @mention bot
  if (text.toLowerCase().includes(`@${BOT_USERNAME.toLowerCase()}`)) return true;
  // Accept if reply to bot's message
  if (msg.reply_to_message && msg.reply_to_message.from?.id === BOT_ID) return true;
  return false;
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  if (!ALLOWED_CHATS.includes(chatId)) {
    logInfo(`⚠️ Rejected chat id=${chatId} title="${msg.chat.title || msg.chat.username || 'DM'}" from=${msg.from?.username || msg.from?.first_name}`);
    return;
  }
  if (!shouldHandleMessage(msg)) {
    const text = (msg.text || msg.caption || '').slice(0, 60);
    logInfo(`⏭ Skip (no @mention) from=${msg.from?.username || msg.from?.first_name} text="${text}"`);
    return;
  }

  const text = msg.text || msg.caption || '';
  const t0 = Date.now();
  let intent = parseIntent(text);

  // If no code but has context (reply continuation) → reuse last code + date range
  if (!intent.code) {
    const ctx = getCtx(chatId, msg.from?.id);
    if (ctx) {
      intent = { ...intent, code: ctx.code, warehouse: ctx.warehouse, start: intent.start || ctx.start, end: intent.end || ctx.end, isCustomer: false };
      logInfo('Reply continuation: reusing code', ctx.code);
    } else {
      intent.mode = 'no-code';
    }
  }

  logInfo(`msg from ${msg.from?.username || msg.from?.first_name} | mode=${intent.mode} | code=${intent.code || '-'}`);

  const chatTitle = msg.chat.title || msg.chat.username || 'DM';

  if (intent.mode === 'no-code') {
    await sendReply(chatId, formatReply(intent, null, msg.from).text, msg.message_id, null, msg.from, chatTitle);
    return;
  }

  const result = await callLookup(intent);
  // Pre-fetch danh sách hàng nếu mode product-list (lookup detail API riêng, có cache)
  if (intent.mode === 'product-list' && result?.success && result.rows?.[0]?.packageFId) {
    intent.__products = await getProductsCached(result.rows[0].packageFId);
  }
  const fmt = formatReply(intent, result, msg.from);

  if (fmt.photoUrl) {
    await sendPhoto(chatId, fmt.photoUrl, fmt.text, msg.message_id, fmt.buttons, msg.from, chatTitle);
  } else {
    await sendReply(chatId, fmt.text, msg.message_id, fmt.buttons, msg.from, chatTitle);
  }

  // Cache successful code lookup for button/reply continuation
  if (fmt.code) setCtx(chatId, msg.from?.id, fmt.code, fmt.warehouse, intent.start, intent.end);

  logInfo(`replied in ${Date.now() - t0}ms`);
}

async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  if (!ALLOWED_CHATS.includes(chatId)) { await answerCallback(cb.id, 'Không được phép.'); return; }

  const data = cb.data || '';
  const [mode, code] = data.split(':');
  if (!mode || !code) { await answerCallback(cb.id, 'Dữ liệu lỗi'); return; }

  const t0 = Date.now();
  await answerCallback(cb.id, '⏳ Đang tra...');
  logInfo(`btn from ${cb.from?.username || cb.from?.first_name} | mode=${mode} | code=${code}`);

  const ctx = getCtx(chatId, cb.from?.id);
  const warehouse = ctx?.warehouse || 'Hà nội';
  const isCustomer = /^[A-Z]\d+-[A-Z0-9]+$/i.test(code);

  const intent = { mode, code, isCustomer, warehouse, start: ctx?.start, end: ctx?.end };
  const result = await callLookup(intent);
  // Pre-fetch danh sách hàng nếu mode product-list
  if (intent.mode === 'product-list' && result?.success && result.rows?.[0]?.packageFId) {
    intent.__products = await getProductsCached(result.rows[0].packageFId);
  }
  const fmt = formatReply(intent, result, cb.from);

  const chatTitle = cb.message?.chat?.title || cb.message?.chat?.username || '';

  // LUÔN gửi tin nhắn MỚI (reply đến tin bấm button để context rõ ràng)
  if (fmt.photoUrl) {
    await sendPhoto(chatId, fmt.photoUrl, fmt.text, cb.message.message_id, fmt.buttons, cb.from, chatTitle);
  } else {
    await sendReply(chatId, fmt.text, cb.message.message_id, fmt.buttons, cb.from, chatTitle);
  }

  if (fmt.code) setCtx(chatId, cb.from?.id, fmt.code, fmt.warehouse, intent.start, intent.end);
  logInfo(`btn replied in ${Date.now() - t0}ms`);
}

async function poll() {
  while (true) {
    try {
      const res = await fetch(`${TG}/getUpdates?offset=${offset}&timeout=25&allowed_updates=%5B%22message%22%2C%22callback_query%22%5D`, {
        signal: AbortSignal.timeout(30000),
      });
      const j = await res.json();
      if (j.ok && j.result.length > 0) {
        for (const upd of j.result) {
          offset = upd.update_id + 1;
          saveOffset();
          if (processedUpdates.has(upd.update_id)) {
            logInfo(`SKIP duplicate update_id=${upd.update_id}`);
            continue;
          }
          markProcessed(upd.update_id);
          // Log to per-group sheet (fire-and-forget, never blocks reply)
          if (upd.message) {
            const m = upd.message;
            const chatTitle = m.chat.title || m.chat.username || 'DM';
            const senderName = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ');

            // ── System events: add/remove member ──
            if (m.new_chat_members?.length) {
              const names = m.new_chat_members.map(u => u.username ? `@${u.username}` : [u.first_name, u.last_name].filter(Boolean).join(' ')).filter(Boolean).join(', ');
              logToSheet(m.chat.id, 'member_added', {
                chat_title: chatTitle,
                sender_id: m.from?.id, sender_username: m.from?.username, sender_name: senderName,
                message_id: m.message_id,
                text: `➕ Thêm ${m.new_chat_members.length} thành viên: ${names}`,
                mentioned_bot: false,
              });
              continue; // Không chạy handleMessage — đây là system event
            }
            if (m.left_chat_member) {
              const lm = m.left_chat_member;
              const leaverName = lm.username ? `@${lm.username}` : [lm.first_name, lm.last_name].filter(Boolean).join(' ');
              const selfLeave = m.from?.id === lm.id;
              logToSheet(m.chat.id, 'member_left', {
                chat_title: chatTitle,
                sender_id: m.from?.id, sender_username: m.from?.username, sender_name: senderName,
                message_id: m.message_id,
                text: selfLeave ? `⬅️ ${leaverName} tự rời nhóm` : `❌ ${senderName || m.from?.username || 'Ai đó'} xoá ${leaverName} khỏi nhóm`,
                mentioned_bot: false,
              });
              continue;
            }

            // ── Normal user message ──
            const text = m.text || m.caption || (m.sticker ? `[sticker:${m.sticker.emoji||''}]` : '') || (m.photo ? '[photo]' : '') || (m.document ? `[doc:${m.document.file_name||''}]` : '') || (m.voice ? '[voice]' : '') || (m.video ? '[video]' : '') || '[other]';
            const mentioned = (m.text || m.caption || '').toLowerCase().includes(`@${BOT_USERNAME.toLowerCase()}`);
            logToSheet(m.chat.id, 'user_message', {
              chat_title: chatTitle,
              sender_id: m.from?.id,
              sender_username: m.from?.username,
              sender_name: senderName,
              message_id: m.message_id,
              reply_to_msg_id: m.reply_to_message?.message_id,
              replied_to_user: m.reply_to_message?.from?.username || [m.reply_to_message?.from?.first_name, m.reply_to_message?.from?.last_name].filter(Boolean).join(' '),
              text,
              mentioned_bot: mentioned,
            });
            handleMessage(m).catch(e => logInfo('msg err:', e.message));
          }
          else if (upd.callback_query) {
            const cb = upd.callback_query;
            logToSheet(cb.message?.chat?.id, 'user_callback', {
              chat_title: cb.message?.chat?.title || '',
              sender_id: cb.from?.id,
              sender_username: cb.from?.username,
              sender_name: [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(' '),
              message_id: cb.message?.message_id,
              reply_to_msg_id: cb.message?.message_id,
              replied_to_user: '',
              text: cb.data || '',
              mentioned_bot: false,
            });
            handleCallback(cb).catch(e => logInfo('cb err:', e.message));
          }
        }
      }
    } catch (e) {
      logInfo('poll err:', e.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

loadFileIdCache();
logInfo(`KinKin TG bot starting (chat=${ALLOWED_CHATS.join(',')}, bot=@${BOT_USERNAME}) | offset=${offset}`);

// Nếu chưa có offset (first start ever) → drop tất cả pending để không re-process lịch sử
if (offset === 0) {
  try {
    const res = await fetch(`${TG}/getUpdates?offset=-1&limit=1`, { signal: AbortSignal.timeout(10000) });
    const j = await res.json();
    if (j.ok && j.result.length > 0) {
      offset = j.result[j.result.length - 1].update_id + 1;
      saveOffset();
      logInfo(`First start: drained to offset=${offset}`);
    }
  } catch (e) { logInfo('drain err:', e.message); }
}

// Pre-warm undici connection pool tới Telegram + KinKin (tránh TCP+TLS handshake ~200-300ms cho query đầu)
(async () => {
  try {
    await Promise.all([
      fetch(`${TG}/getMe`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => null),
      fetch('https://warehousedepartureapi.vanchuyenkinkin.com/warehousedeparture/api/health', { signal: AbortSignal.timeout(5000) }).catch(() => null),
    ]);
    logInfo('connection pool warmed (Telegram + KinKin)');
  } catch {}
})();

poll().catch(e => { logInfo('FATAL:', e.message); process.exit(1); });
