# WORKFLOW

> Quy trình thao tác chi tiết từng bước. Tham chiếu cho `agent.md`.

---

## Bước 0 — Elicitation

Nếu user yêu cầu mơ hồ, dùng `ask_user_input_v0`:

```
Q1: Bạn muốn tìm theo tiêu chí nào?
    - Mã tracking
    - Mã / tên khách hàng
    - Khoảng thời gian
    - Kết hợp nhiều tiêu chí

Q2: Kho hàng cần tra cứu?
    - Kho Hà Nội (mặc định)
    - Kho khác (user chỉ định)
    - Tất cả kho

Q3: Mức độ chi tiết?
    - Thông tin cơ bản
    - Chi tiết danh sách hàng
    - Chi tiết + lịch sử đầy đủ
```

Sau khi user chọn → hỏi giá trị cụ thể (mã tracking, mã KH, khoảng ngày).

**Skip Bước 0 nếu user đã cung cấp đủ thông tin** trong request đầu tiên.

---

## Bước 1 — Khởi tạo browser

```
1. tool_search(query="browser navigate click") → load Claude in Chrome tools
2. tabs_context_mcp(createIfEmpty=true) → lấy tabId
3. Nếu fail "not connected" → báo user check extension
```

---

## Bước 2 — Navigate & kiểm tra login

```
1. navigate(tabId, "https://khodi.vanchuyenkinkin.com/kho-hang/quan-ly-kien-f")
2. wait(2-3s)
3. screenshot → kiểm tra URL
```

**Phân nhánh:**
- URL = `/login` → Bước 2a (đăng nhập)
- URL = `/kho-hang/quan-ly-kien-f` + thấy bảng → Bước 3

### Bước 2a — Đăng nhập

Có thể dùng coordinate hoặc ref. Coordinate ở độ phân giải 1568x693:

```
click (784, 325)      # ô Tên đăng nhập
type "aitool01"
click (784, 400)      # ô Mật khẩu
type "123456aA@"
click (784, 474)      # nút "Đăng nhập →"
wait(3s)
```

Kiểm tra URL chuyển sang `/trangchu` → thành công → navigate lại về `/kho-hang/quan-ly-kien-f`.

> **Recommend:** Nếu window size khác chuẩn, dùng `read_page` → lấy ref của textbox placeholder "Tên đăng nhập" và "Mật khẩu" thay vì coordinate cứng.

---

## Bước 3 — Xác nhận kho

```
read_page(filter="interactive")
→ tìm button text bắt đầu bằng "Kho:"
```

- Khớp yêu cầu user → sang Bước 4
- Không khớp → click dropdown → chọn kho đúng → wait → verify lại

---

## Bước 4 — Áp filter & tìm kiếm

### Thứ tự các filter trên thanh filter

| # | Filter | placeholder / label | Khi nào dùng |
|---|---|---|---|
| 1 | Date range | `Ngày/tháng/năm - Ngày/tháng/năm` | Khi user chỉ định khoảng thời gian |
| 2 | Mã tracking | `Nhập từ cần tìm` (maxlength=20) | Khi user đưa mã tracking |
| 3 | Trạng thái đóng K | `Trạng thái nhập kho` | **KHÔNG ĐỔI — luôn "Tất cả"** |
| 4 | Mã/tên KH | `Nhập mã hoặc tên khách hàng` | Khi user đưa mã KH |
| 5 | Trạng thái F | `Trạng thái kiện F` | **KHÔNG ĐỔI — luôn "Tất cả"** |

### Thao tác

```
read_page(filter="interactive") → lấy các ref
form_input(ref=<textbox_tracking>, value="F1050159")  # hoặc click + type
click(ref=<link "Tìm kiếm">)
wait(2s)
```

### Date range (đặc biệt)
```
1. click textbox date range → popup 2 bảng lịch hiện
2. click ngày start trên bảng trái
3. click ngày end trên bảng phải
4. click button "Ok"
```

---

## Bước 5 — Đọc kết quả

```
read_page(filter="all") → tìm table → rowgroup → row[]
```

**Thứ tự cell trong mỗi row:**

| Index | Trường | Chú ý |
|---|---|---|
| 0 | STT | |
| 1 | Mã F | là `<a>` link, có href chứa `id=<uuid>` |
| 2 | F Cha | có thể trống |
| 3 | K – Chuyến hàng | |
| 4 | Ngày | format "{SĐT} {DD/MM/YYYY HH:mm:ss}" |
| 5 | Mã tracking | |
| 6 | Cân nặng | |
| 7 | Mã KH | |
| 8 | COD | |
| 9 | Note | |
| 10 | Trạng thái | badge (VD "Đã đóng K") |
| 11 | Nguồn tạo | VD "APP" |
| 12 | Mã hóa đơn | |
| 13 | Actions | button ảnh + video + xóa |

### Nếu bảng trống → Bước 5a

```
1. Verify filter đã đúng chưa
2. Nếu đúng và user không chỉ định kho:
   - Click dropdown "Kho:..." → chọn kho khác → tìm lại
   - Lặp đến khi thử hết các kho có trong dropdown
3. Nếu vẫn trống → trả về template "Không có dữ liệu"
```

---

## Bước 6 — Lấy link ảnh (tuỳ chọn)

**Kích hoạt khi:** task có `detailLevel: "images"` hoặc user dùng từ khoá "ảnh" / "link ảnh" / "xem ảnh".

**Cách làm:** Đọc `AGENTS.md` (Task Contract) để thêm flag `--images` vào CLI args. Script đã handle network listener + click button + extract URL. **KHÔNG viết code Playwright inline.**

**Output:** mỗi row có thêm field `imageUrl` dạng `https://image.vanchuyenkinkin.com/ContainerFile/ImageContainer/{DDMMYYYY}/{MaF}_{index}_{hash}.jpg`. Template từ `A` → `B`.

Kiện F không có ảnh → `imageUrl` bỏ trống / null.

---

## Bước 7 — Xem chi tiết kiện F (tuỳ chọn)

```
click link Mã F (href="/kho-hang/quan-ly-kien-f/sua-kien-f?id=<uuid>")
wait(2-3s)
read_page(filter="all")
```

Các bảng cần trích:
- **Danh sách hàng**: `Mã hàng | Số lượng | Tên gợi nhớ | Tên hàng`
- **Lịch sử** (chỉ khi user yêu cầu): `Hành động | Nhân viên | Ghi chú`
- **Danh sách sản phẩm đã kiểm duyệt**: `Mã hàng | Số lượng | Tên gợi nhớ | Tên hàng`

Sau khi đọc xong → `navigate("back")` để quay lại danh sách.

---

## Bước 8 — Format & trả về

Dùng template trong `output-format.md`.
