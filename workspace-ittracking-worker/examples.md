# EXAMPLES

> Hội thoại mẫu để agent học pattern. Tham chiếu cuối cùng.

---

## Ví dụ 1 — Flow cơ bản (skip elicit)

**User:** Tra mã F1050159 giúp

**Agent:** *(chạy ngay với default: kho Hà Nội, output cơ bản)*

```
→ tool_search("browser")
→ tabs_context_mcp()
→ navigate("/kho-hang/quan-ly-kien-f")
→ screenshot → URL = /login
→ login (<KINKIN_USERNAME> / ***)
→ navigate lại
→ verify kho = Hà Nội
→ read_page → ref của "Nhập từ cần tìm" và "Tìm kiếm"
→ type "F1050159"
→ click "Tìm kiếm"
→ đọc kết quả
```

**Output (Template A):**
```markdown
## 📋 Kết quả tra cứu **F1050159** – Kho: **Hà Nội**

| Trường | Giá trị |
|---|---|
| Mã F | F1050159 |
| Ngày | 21/04/2026 18:05:37 |
| Mã tracking | F1050159 |
| Cân nặng | 12.9 |
| Mã KH | S04-051HN |
| Trạng thái | ✅ Đã đóng K |
| Nguồn tạo | APP |
| ... |

> Cần link ảnh / chi tiết kiện không?
```

---

## Ví dụ 2 — Cần elicit

**User:** giúp tôi tìm đơn hàng

**Agent:** *(dùng `ask_user_input_v0` — 3 câu hỏi trong 1 lần)*

```
Q1: Tiêu chí tìm kiếm? [mã tracking / mã KH / thời gian / kết hợp]
Q2: Kho? [Hà Nội / khác / tất cả]
Q3: Chi tiết? [cơ bản / danh sách hàng / + lịch sử]
```

**User chọn:** Mã tracking / Hà Nội / cơ bản

**Agent:** "Vui lòng cung cấp mã tracking cần tra."

**User:** F1050159

→ *(chạy như ví dụ 1)*

---

## Ví dụ 3 — Không có kết quả, thử kho khác

**User:** Tra ABC999XYZ, không rõ kho nào

**Agent flow:**
1. Tìm ở Hà Nội → 0 kết quả
2. Click dropdown → chọn "Kho: HCM" → 0 kết quả
3. Chọn "Kho: Đà Nẵng" → 0 kết quả

**Output (Template C):**
```markdown
## ⚠️ Không tìm thấy dữ liệu

Filter: Mã tracking = `ABC999XYZ`

**Kho đã thử:** Hà Nội, HCM, Đà Nẵng

Không có bản ghi nào khớp. Vui lòng kiểm tra lại mã.
```

---

## Ví dụ 4 — Tìm theo KH + thời gian

**User:** Xem kiện F của KH S04-051HN từ 01/04 đến 21/04

**Agent flow:**
1. Login (nếu cần)
2. Click date range → chọn 01/04/2026 - 21/04/2026 → Ok
3. Read_page → lấy ref combobox "Nhập mã hoặc tên khách hàng"
4. Type "S04-051HN"
5. Click "Tìm kiếm"

**Output (Template B — nếu > 1 bản ghi):**
```markdown
## 📋 Kết quả – Kho: **Hà Nội**

Tìm thấy **5 bản ghi** của KH `S04-051HN`:

| STT | Mã F | Ngày | Mã tracking | Cân nặng | Trạng thái |
|---|---|---|---|---|---|
| 1 | F1050159 | 21/04 18:05 | F1050159 | 12.9 | Đã đóng K |
| 2 | F1050088 | 21/04 17:21 | F1050088 | 8.6  | Đã đóng K |
| ... |

> Cần chi tiết mã nào cụ thể?
```

---

## Ví dụ 5 — Yêu cầu chi tiết + ảnh

**User (tiếp nối VD 1):** cho tôi xem chi tiết F1050159 và link ảnh

**Agent flow:**
1. Click button xem ảnh → popup hiện
2. `read_network_requests(urlPattern="image.vanchuyenkinkin.com")` → lấy URL
3. Close popup
4. Click link "F1050159" → chuyển `/sua-kien-f?id=...`
5. Read_page → trích bảng "Danh sách hàng" + "Danh sách SP đã kiểm duyệt"
6. *(Không đọc "Lịch sử" vì user không yêu cầu)*

**Output (Template D):**
```markdown
## 📦 Chi tiết kiện F — **F1050159**

### 1. Thông tin cơ bản
(table như VD 1)

### 2. Link ảnh
- https://image.vanchuyenkinkin.com/.../F1050159_1_5AE582FD.jpg

### 3. Danh sách hàng
| Mã hàng | Số lượng | Tên gợi nhớ | Tên hàng |
|---|---|---|---|
| ... | ... | ... | ... |

### 4. Danh sách SP đã kiểm duyệt
| Mã hàng | Số lượng | Tên gợi nhớ | Tên hàng |
|---|---|---|---|
| ... | ... | ... | ... |
```

---

## Ví dụ 6 — Extension chưa kết nối

**User:** Tra F1050159

**Agent:**
```
tabs_context_mcp → "not connected"
```

**Output (Template F):**
```markdown
⚠️ **Chrome extension chưa kết nối**

Tôi không thể mở trình duyệt để tra cứu.

Bạn có thể:
1. Kiểm tra Chrome đang mở
2. Xác nhận extension "Claude for Chrome" đã đăng nhập
3. Cho phép domain `khodi.vanchuyenkinkin.com`

Nhắn "thử lại" khi sẵn sàng.
```

**User:** thử lại

**Agent:** *(retry → thành công → tiếp tục flow VD 1)*

---

## Ví dụ 7 — User hủy giữa chừng

**User:** Tra mã F1050159

**Agent:** *(đang đăng nhập...)*

**User:** Thôi dừng lại

**Agent:**
```markdown
Đã dừng. Nhắn khi cần tra cứu tiếp.
```

*(không hỏi "bạn có chắc không?", không thao tác thêm)*

---

## Ví dụ 8 — User yêu cầu xóa (ngoài scope)

**User:** Xóa kiện F1050159 đi

**Agent:**
```markdown
Xin lỗi, chức năng xóa nằm ngoài phạm vi của tôi. Agent này chỉ hỗ trợ **tra cứu** thông tin kiện F, không thực hiện các thao tác thay đổi dữ liệu (xóa/sửa/tạo).

Bạn vui lòng đăng nhập trực tiếp vào hệ thống để thực hiện thao tác xóa.
```

---

## Ví dụ 9 — Session hết hạn giữa chừng

**User:** Tra F1050148 tiếp

**Agent:**
```
→ click "Tìm kiếm" → URL redirect /login
→ Nhận diện session expired
→ Tự động login lại
→ Navigate về trang danh sách
→ Nhập lại filter "F1050148"
→ Tìm kiếm tiếp
```

**Output:**
```markdown
> Session đã hết hạn, tôi đã đăng nhập lại.

## 📋 Kết quả tra cứu **F1050148** – Kho: **Hà Nội**
(Template A)
```
