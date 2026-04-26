# 📋 Merge Criteria — Tiêu chí chấp nhận khi merge code

> Paste block này vào mô tả PR hoặc commit message khi merge feature/fix vào `main`. Mọi thay đổi phải thoả mãn **3 tiêu chí** dưới đây.

---

## 📜 Lịch sử nâng cấp (changelog)

### 2026-04-26 — Mã K + Danh sách hàng

**Thêm:**
- Field `maK` trong schema (`lookup-core.mjs`) — extract `<DDMMYY>-<seq>` từ `packageKBillCode` bằng regex `/^(\d{6}-\d+)/`. Mã K = mã Hawb.
- Field `packageFId` trong schema — uuid kiện F, dùng cho endpoint detail
- Function exported `getPackageDetail(packageFId)` — gọi `GET /packageF/get-package-f-information-by-id?id=<uuid>` (auto JWT refresh, retry 401)
- Mode `product-list` — input regex `/danh sách hàng|ds hàng|sản phẩm|list hàng|hàng hoá/`
- Button "📦 Danh sách hàng" — hàng 3 dưới layout 6 nút cũ (callback_data `product-list:<code>`)
- Output dạng bảng monospace 4 cột: `Mã hàng | SL | Gợi nhớ | Tên hàng`
  - Cột flex auto-width theo content dài nhất (`Math.max`)
  - Đường kẻ `│` giữa các cột, `┼` ở intersection của separator row
  - Filter `isApprovalProduct === false` — loại sản phẩm đã approve
- Cache `detailCache` (5 min TTL, 100 entries max) — bấm lại instant <200ms
- Display `🏷 Mã K: <maK>` trong mode `full` (sau Mã tracking) và `default` (sau Mã F)

**Tối ưu tốc độ (giữ output 100%):**
- `RESULT_TTL`: 60s → 300s (5 phút) — button taps reuse cache instant
- `pageSize` API search: 50 → 10 — payload nhỏ hơn
- Pre-warm undici connection pool tới Telegram + KinKin khi bot start (tiết kiệm 200-300ms TCP+TLS)
- Giữ `searchWithFallback` sequential HN-first (parallel test thấy chậm hơn vì KinKin server slow down khi đa request đồng thời)

**SLA mới:**
- Button cache hit: <200ms
- Query lần đầu (HN nhanh): 500-900ms
- Query mode `product-list` lần đầu: 1.2-1.8s (search + detail call)
- Query `product-list` lần 2 cùng kiện: <300ms

**Test cases bổ sung trong checklist:**
- [ ] Bấm "📦 Danh sách hàng" → bảng 4 cột với đường kẻ phân cột
- [ ] Tên dài (>20 chars) hiển thị đầy đủ, không truncate `...`
- [ ] Cell không tràn sang cột khác — cột flex theo content
- [ ] Sản phẩm `isApprovalProduct: true` không xuất hiện trong list
- [ ] Mã K hiển thị đúng format `DDMMYY-N` trong default + full mode
- [ ] Bấm lại nút sản phẩm cùng kiện trong 5 phút → reply <300ms (cache hit)

---

## ✅ Tiêu chí user acceptance (không thương lượng)

### 1. Input templates — User gõ được theo các pattern này

Bot phải nhận diện đúng `mode` từ natural-language input của user (có/không @mention bot trong nhóm), **không phân biệt dấu tiếng Việt**:

| Input pattern (user gõ) | Mode | Regex match |
|---|---|---|
| `trạng thái <mã>`, `status <mã>`, `tình trạng <mã>` | `status` | `/trạng thái|status|tình trạng|tinh trang/` |
| `cân nặng <mã>`, `nặng bao nhiêu`, `<mã> kg` | `weight` | `/cân nặng|nặng bao nhiêu|nang kg|trọng lượng/` |
| `nhập kho đi <mã>`, `ngày nhập kho`, `đã nhập kho` | `nhap-kho` | `/nhập kho đi|ngày nhập|đã nhập kho/` |
| `kiểm hoá <mã>`, `ai kiểm`, `ngày kiểm` | `kiem-hoa` | `/kiểm hoá|kiểm hóa|người kiểm|ai kiểm/` |
| `invoice <mã>`, `mã hoá đơn`, `hoá đơn` | `invoice` | `/invoice|mã hoá đơn|hoá đơn|ma invoice/` |
| `ghi chú <mã>`, `note <mã>`, `lưu ý` | `note` | `/ghi chú|note|remarks|lưu ý/` |
| `cod <mã>`, `tiền thu hộ` | `cod` | `/\bcod\b|tiền thu hộ/` |
| `ảnh <mã>`, `hình ảnh`, `xem ảnh`, `picture` | `image` | `/hình ảnh|xem ảnh|\bảnh\b|picture/` |
| `chi tiết <mã>`, `đầy đủ <mã>`, `full <mã>`, `thông tin` | `full` | `/thông tin|chi tiết|đầy đủ|full|tất cả/` |
| `danh sách hàng <mã>`, `ds hàng`, `sản phẩm`, `list hàng` | `product-list` | `/danh sách hàng|ds hàng|sản phẩm|list hàng|hàng hoá/` |
| `<mã>` (không keyword) | `default` | (chỉ mã F/tracking/KH) |

Mã chấp nhận: `F1049185` (packageF), `829192371556` (trackingCode), `S04-051HN` (customerCode).

Reply từ 1 trong 3 kho theo thứ tự fallback: **Hà Nội → HCM + Shiki (parallel)**.

### 2. Output templates — Bot phải trả về đúng format

Mọi reply bắt đầu bằng tag `@<username>` xuống dòng + `Mã tracking: <code>` + nội dung.

| Mode | Template output |
|---|---|
| `status` | `✅ Trạng thái: *<trangThai>*` |
| `weight` | `⚖️ Cân nặng: *<canNang> kg*` |
| `nhap-kho` | `🚚 Ngày nhập kho đi: *<DD/MM/YYYY HH:mm:ss>*` |
| `kiem-hoa` | `👷 Người kiểm hoá: *<SĐT>*` + `📅 Ngày kiểm hoá: <DD/MM/YYYY HH:mm:ss>` |
| `invoice` | `🧾 Mã Invoice: *<maInvoice>*` |
| `cod` | `💰 COD: *<amount> ₫*` (format VND, vd `1.750.000 ₫`) |
| `note` | `📝 Ghi chú: *<note>*` |
| `image` | Ảnh inline (sendPhoto) + caption `🖼 (ảnh kèm theo)`. Fallback text nếu Telegram không tải được. |
| `full` | Table đầy đủ: Mã F, Mã tracking, **Mã K**, Ngày nhập kho, Người kiểm + ngày kiểm, Cân nặng, Mã KH, COD, Trạng thái, Chuyến hàng, Nguồn tạo, Invoice, Ghi chú + ảnh inline |
| `product-list` | Bảng monospace 4 cột (`Mã hàng \| SL \| Gợi nhớ \| Tên hàng`) trong code block — cột flex auto-width, đường kẻ `│`/`┼` phân cách, filter `isApprovalProduct=false` |
| Không tìm thấy | `❌ Không tìm thấy mã tracking \`<input>\`, vui lòng nhập lại.` |

**Mỗi reply kèm 7 nút gợi ý (3-3-1):**
```
[✅ Trạng thái]      [🖼 Cần ảnh]    [🚚 Nhập kho đi]
[👷 Kiểm hoá]        [🧾 Invoice]    [📋 Chi tiết]
[📦 Danh sách hàng]
```

### 3. Tốc độ phản hồi — ≤ 1 giây cho query cached

| Case | SLA |
|---|---|
| Query text (JWT cached + result cache hit trong 60s) | **≤ 0.7s** |
| Query text (JWT cached, cache miss) | **≤ 1.5s** |
| Button tap cùng code (context cache hit 30m) | **≤ 0.5s** |
| Button `Cần ảnh` lần 2+ cùng ảnh (file_id cache 7d) | **≤ 0.3s** |
| Button `Cần ảnh` lần đầu (download + upload multipart) | **≤ 3s** |
| JWT expired → Playwright re-login + query | ≤ 35s (một lần duy nhất/ngày) |

**Target chung: 95% query ≤ 1s** sau khi bot đã warm (JWT + file_id cache nạp).

---

## 🧪 Checklist merge — dev phải tự test trước khi push

- [ ] Bot nhận đúng `mode` với ít nhất 2 variant keyword/pattern cho từng mode
- [ ] Output template khớp bảng trên (emoji + format số/ngày đúng)
- [ ] 6 nút gợi ý hiển thị đúng layout 3×2
- [ ] Không duplicate reply (check: chỉ 1 process bot chạy, không có zombie)
- [ ] Response time < 1s khi query lần 2 cùng mã (đo bằng `btn replied in Xms` trong log)
- [ ] `file_id cache` hoạt động: lần 2 ảnh cùng kiện log `cached file_id, sent msgId=...`
- [ ] `.auth-state.json` hợp lệ (không 401 khi call KinKin API)
- [ ] Log file không có `poll err: fetch failed` liên tục (IPv4 dispatcher OK)
- [ ] Mọi group trong `.allowed-chats.json` reply được, group ngoài bị reject đúng
- [ ] Log Google Sheet xuất hiện dòng mới cho mỗi message/callback (nếu group có mapping)

## 🚫 Dấu hiệu merge KHÔNG đạt — phải rollback

- Response time > 2s cho query đã cached
- Bot reply 2 lần cho 1 tin (duplicate)
- Ảnh không gửi được (chỉ text fallback) cho kiện đã có `file_id` cache
- 401 liên tục khi call KinKin (JWT stale, Playwright không refresh được)
- Bot im lặng trong group đã whitelist (poll err hoặc Rejected chat sai)
