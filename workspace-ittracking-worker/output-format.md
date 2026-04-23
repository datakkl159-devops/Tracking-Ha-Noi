# OUTPUT FORMAT

> Template chuẩn trả kết quả về user. Tham chiếu cho `workflow.md` Bước 8.

---

## Template A — 1 bản ghi (output cơ bản)

```markdown
## 📋 Kết quả tra cứu **{MA_TRACKING}** – Kho: **{TEN_KHO}**

| Trường | Giá trị |
|---|---|
| STT | {stt} |
| Mã F | {maF} |
| F Cha | {fCha hoặc "(trống)"} |
| K – Chuyến hàng | {chuyenHang} |
| Ngày | {ngay} |
| Mã tracking | {maTracking} |
| Cân nặng | {canNang} |
| Mã KH | {maKH} |
| COD | {cod} |
| Note | {note} |
| Trạng thái | {trangThai} |
| Nguồn tạo | {nguonTao} |
| Mã hóa đơn | {maHoaDon hoặc "(trống)"} |

> Cần link ảnh / chi tiết kiện không?
```

---

## Template B — Nhiều bản ghi

```markdown
## 📋 Kết quả tra cứu – Kho: **{TEN_KHO}**

Tìm thấy **{N} bản ghi**:

| STT | Mã F | Ngày | Mã tracking | Cân nặng | Mã KH | Trạng thái | Nguồn tạo |
|---|---|---|---|---|---|---|---|
| 1 | F1050159 | 21/04/2026 18:05 | F1050159 | 12.9 | S04-051HN | Đã đóng K | APP |
| 2 | ... | ... | ... | ... | ... | ... | ... |

> Cần chi tiết mã cụ thể nào, bạn cho tôi biết.
```

---

## Template C — Không có dữ liệu

```markdown
## ⚠️ Không tìm thấy dữ liệu

Filter đã áp dụng:
- Mã tracking: `{value}` (nếu có)
- Mã KH: `{value}` (nếu có)
- Khoảng thời gian: `{start} - {end}`

**Kho đã thử:** {kho1}, {kho2}, {kho3}

Không có bản ghi nào khớp. Vui lòng kiểm tra lại mã / thử khoảng thời gian khác.
```

---

## Template D — Chi tiết kiện F

```markdown
## 📦 Chi tiết kiện F — **{MA_F}**

### 1. Thông tin cơ bản
(áp dụng Template A)

### 2. Link ảnh
- https://image.vanchuyenkinkin.com/.../F1050159_1_5AE582FD.jpg

### 3. Danh sách hàng

| Mã hàng | Số lượng | Tên gợi nhớ | Tên hàng |
|---|---|---|---|
| ... | ... | ... | ... |

### 4. Danh sách sản phẩm đã kiểm duyệt

| Mã hàng | Số lượng | Tên gợi nhớ | Tên hàng |
|---|---|---|---|
| ... | ... | ... | ... |

### 5. Lịch sử *(chỉ khi user yêu cầu)*

| Hành động | Nhân viên | Ghi chú |
|---|---|---|
| ... | ... | ... |
```

---

## Template E — Chỉ link ảnh

```markdown
**Link ảnh của {MA_F}:**
- https://image.vanchuyenkinkin.com/ContainerFile/ImageContainer/21042026/F1050159_1_5AE582FD.jpg
- https://image.vanchuyenkinkin.com/ContainerFile/ImageContainer/21042026/F1050159_2_A12B3CD4.jpg (nếu có)
```

---

## Template F — Báo lỗi

```markdown
⚠️ **{LOẠI LỖI NGẮN GỌN}**

{Nguyên nhân 1 câu}

**Bạn có thể:**
1. {hướng dẫn 1}
2. {hướng dẫn 2}

Nhắn "thử lại" khi sẵn sàng.
```

Ví dụ:
```markdown
⚠️ **Chrome extension chưa kết nối**

Tôi không thể mở trình duyệt để tra cứu.

Bạn có thể:
1. Kiểm tra Chrome đang mở
2. Xác nhận extension "Claude for Chrome" đã đăng nhập
3. Cho phép domain `khodi.vanchuyenkinkin.com`

Nhắn "thử lại" khi sẵn sàng.
```

---

## Quy tắc chung

1. **Tiếng Việt, giữ thuật ngữ nội bộ** — không dịch "Mã F" thành "F Code"
2. **Dùng bảng markdown** cho data có cấu trúc
3. **Giá trị rỗng** → `(trống)` hoặc `—`, không `null`
4. **Không in credentials** vào output
5. **Emoji tiết chế**: 📋 kết quả, ⚠️ warning, ✅ success, 📦 chi tiết
6. **Cuối output thường có 1 câu gợi ý** next step
7. **Không giải thích thao tác** đã làm — user chỉ cần kết quả
