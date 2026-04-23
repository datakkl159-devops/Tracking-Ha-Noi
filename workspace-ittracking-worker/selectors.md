# SELECTORS

> HTML selector, ref pattern, coordinate mẫu. Tham chiếu cho `workflow.md`.

---

## 1. Trang đăng nhập (`/login`)

| Element | Nhận diện | Coord mẫu (1568x693) |
|---|---|---|
| Username input | `placeholder="Tên đăng nhập"` | (784, 325) |
| Password input | `placeholder="Mật khẩu"` (type=password) | (784, 400) |
| Nút đăng nhập | text "Đăng nhập →" | (784, 474) |

---

## 2. Header trang danh sách kiện F

| Element | Nhận diện |
|---|---|
| Menu toggle | Button icon hamburger, bên trái logo |
| Top search | `textbox "Tìm kiếm"` |
| User name | `link "Nhân viên AI"` — verify đã login |
| **Dropdown Kho** | `button "Kho: <tên kho>"` — class `btn btn-primary btn-right-menu dropdown-toggle` |

HTML reference của dropdown kho:
```html
<button id="button-animated" dropdowntoggle type="button"
        class="btn btn-primary btn-right-menu dropdown-toggle"
        aria-controls="dropdown-animated">
  Kho: Hà nội <span class="caret"></span>
</button>
```

---

## 3. Sidebar menu

| Link | href |
|---|---|
| Trang chủ | `/trangchu` |
| Quản lý kiện K | `/kho-hang/quan-ly-kien-k` |
| **Quản lý kiện F** | `/kho-hang/quan-ly-kien-f` |
| Danh sách đặc thù | `/hang-dac-thu/danh-sach-thung` |
| Danh sách phụ thu | `/hang-dac-thu/danh-sach-phu-thu` |
| Thông báo KD | `/cai-dat/thong-bao-kd` |

---

## 4. Thanh filter

### 4.1. Date range
```html
<input type="text" matinput ngxdaterangepickermd
       formcontrolname="rangeDate" name="daterange"
       placeholder="Ngày/tháng/năm - Ngày/tháng/năm"
       readonly="true" style="max-width: 300px;">
```
- **readonly** → phải click để mở popup
- Popup có 2 table tháng + nút "Xóa" và "Ok"

### 4.2. Mã tracking
```html
<input formcontrolname="keywordSearch"
       placeholder="Nhập từ cần tìm"
       matinput type="text" maxlength="20"
       class="mat-mdc-input-element form-control">
```
- **maxlength="20"** — từ chối input > 20 ký tự

### 4.3. Trạng thái nhập kho (đóng K) — ⚠ KHÔNG ĐỔI
- `combobox "Trạng thái nhập kho"` — default "Tất cả"

### 4.4. Mã/tên khách hàng
- `combobox "Nhập mã hoặc tên khách hàng"` — type=text

### 4.5. Trạng thái kiện F — ⚠ KHÔNG ĐỔI
- `combobox "Trạng thái kiện F"` — default "Tất cả"

### 4.6. Nút Tìm kiếm
- `link "Tìm kiếm"` — **là link chứ không phải button**, màu đỏ
- Ref điển hình: `ref_22` (không cố định)

### 4.7. Nút Xuất dữ liệu
- `button "Xuất dữ liệu"` — dropdown, không dùng trong flow tra cứu

---

## 5. Bảng kết quả

### Column headers (thứ tự)
```
STT | Mã F | F Cha | K – Chuyến hàng | Ngày | Mã tracking | Cân nặng
  | Mã KH | COD | Note | Trạng thái | Nguồn tạo | Mã hóa đơn | (actions)
```

### Row data — 14 cell

| # | Cell content | Note |
|---|---|---|
| 0 | STT | number |
| 1 | `<a>` link "Chi tiết kiện F" → href `/kho-hang/quan-ly-kien-f/sua-kien-f?id={uuid}` | Click để xem chi tiết |
| 2 | F Cha | thường trống |
| 3 | K – Chuyến hàng | VD "260421-129-TẠO KIỆN- LINE EMS-HN E01" |
| 4 | Ngày | VD "0818822296 21/04/2026 18:05:37" |
| 5 | Mã tracking | |
| 6 | Cân nặng | số |
| 7 | Mã KH | |
| 8 | COD | số |
| 9 | Note | |
| 10 | Trạng thái | `<span>` trong cell, VD "Đã đóng K" |
| 11 | Nguồn tạo | VD "APP" |
| 12 | Mã hóa đơn | |
| 13 | Cell actions | 3 icon: ảnh, video, xóa |

### Cell actions (column cuối)

```html
<!-- Xem ảnh -->
<button type="button" class="p-image-preview-indicator">
  <a mattooltip="Xem ảnh">
    <img src="../../assets/images/image-icon.png">
  </a>
</button>

<!-- Xem video, Xóa (tương tự nhưng tooltip khác) -->
```

**Tooltip mapping** (hiện trong read_page):
- `tooltip "Xem ảnh"` — button camera icon
- `tooltip "Xem video"` — button video icon
- `tooltip "Xóa"` — button red circle ⚠ KHÔNG CLICK

### Selector "Xem ảnh" (tham khảo — đã verify trong `scripts/lookup.mjs`)

| Mục đích | Selector |
|---|---|
| Button "Xem ảnh" (row đầu) | `tbody tr:first-child button:has(img[src*="image-icon"])` |
| Button qua tooltip | `[mattooltip="Xem ảnh"]` |
| Preview image trong popup | `img.p-image-preview` |
| Network pattern URL ảnh | `image.vanchuyenkinkin.com/.../{MaF}_{index}_{hash}.jpg` |
| Close popup | `key "Escape"` hoặc `[aria-label="Close"]` |

Worker **KHÔNG cần viết code Playwright inline** — chỉ cần gọi `scripts/lookup.mjs --images` (xem AGENTS.md). Các selector trên đã có sẵn trong script.

---

## 6. URL pattern ảnh

```
https://image.vanchuyenkinkin.com/ContainerFile/ImageContainer/{DDMMYYYY}/{MaF}_{index}_{hash}.jpg
```

- `DDMMYYYY` = ngày tạo kiện (8 chữ số, không dấu)
- `MaF` = mã F, VD `F1050159`
- `index` = 1, 2, 3... (nếu có nhiều ảnh)
- `hash` = 8 ký tự hex random

---

## 7. Trang chi tiết kiện F

URL: `/kho-hang/quan-ly-kien-f/sua-kien-f?id={uuid}`

Các section (dùng `read_page` tìm heading tương ứng):
1. **Thông tin kiện** — header
2. **Danh sách hàng** — table 4 cột
3. **Lịch sử** — table 3 cột (chỉ lấy nếu user yêu cầu)
4. **Danh sách sản phẩm đã kiểm duyệt** — table 4 cột

---

## 8. Pattern ref điển hình

> ⚠ Ref KHÔNG cố định — luôn đọc lại bằng `read_page` trước khi dùng.

| ref (mẫu) | Element |
|---|---|
| ref_4 | Button "Kho: ..." |
| ref_15 | Textbox date range |
| ref_18 | Textbox "Nhập từ cần tìm" |
| ref_19 | Combobox "Trạng thái nhập kho" |
| ref_20 | Combobox "Nhập mã hoặc tên KH" |
| ref_21 | Combobox "Trạng thái kiện F" |
| ref_22 | Link "Tìm kiếm" |
| ref_24 | Link Mã F (đầu tiên trong bảng) |
| ref_25 | Button xem ảnh (đầu tiên trong bảng) |
