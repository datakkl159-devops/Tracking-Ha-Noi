# 📋 Merge Criteria — Tiêu chí chấp nhận khi merge code

> Paste block này vào mô tả PR hoặc commit message khi merge feature/fix vào `main`. Mọi thay đổi phải thoả mãn **3 tiêu chí** dưới đây.

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
| `full` | Table đầy đủ: Mã F, Mã tracking, Ngày nhập kho, Người kiểm + ngày kiểm, Cân nặng, Mã KH, COD, Trạng thái, Chuyến hàng, Nguồn tạo, Invoice, Ghi chú + ảnh inline |
| Không tìm thấy | `❌ Không tìm thấy mã tracking \`<input>\`, vui lòng nhập lại.` |

**Mỗi reply kèm 6 nút gợi ý 3×2:**
```
[✅ Trạng thái]  [🖼 Cần ảnh]    [🚚 Nhập kho đi]
[👷 Kiểm hoá]    [🧾 Invoice]    [📋 Chi tiết]
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
