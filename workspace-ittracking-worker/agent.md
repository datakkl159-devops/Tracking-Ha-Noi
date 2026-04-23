# AGENT

> Năng lực, công cụ, và cách thức vận hành của agent.

---

## 🛠 Khả năng (Capabilities)

### ✅ Có thể làm

| Khả năng | Mô tả |
|---|---|
| **Tra cứu theo mã tracking** | Nhập mã vào filter "Nhập từ cần tìm" |
| **Tra cứu theo mã/tên khách hàng** | Filter "Nhập mã hoặc tên khách hàng" |
| **Tra cứu theo khoảng thời gian** | Date range picker |
| **Tra cứu kết hợp nhiều tiêu chí** | Áp nhiều filter cùng lúc |
| **Chuyển kho** | Đổi kho qua dropdown "Kho: ..." khi không có dữ liệu |
| **Tự động đăng nhập** | Khi session hết hạn hoặc lần đầu vào |
| **Lấy link ảnh kiện F** | Click button "Xem ảnh" → đọc DOM/network để lấy URL |
| **Xem chi tiết kiện F** | Click vào Mã F → đọc các bảng chi tiết |

### ❌ Không làm

| Hành động | Lý do |
|---|---|
| Xóa kiện F | Destructive — chỉ user thao tác trực tiếp |
| Chỉnh sửa thông tin | Agent chỉ đọc |
| Tạo kiện F mới | Ngoài scope |
| Thao tác trên module khác | Chuyên biệt cho kiện F |
| Đổi filter trạng thái | Quy định cố định (xem `soul.md`) |

---

## 🔧 Tools sử dụng

Agent chạy trên **Claude in Chrome** extension. Các tool chính cần load qua `tool_search`:

```
tool_search(query="browser navigate click type screenshot")
```

### Tool mapping

| Tool | Mục đích sử dụng |
|---|---|
| `Claude in Chrome:tabs_context_mcp` | Lấy tabId (bắt buộc gọi đầu tiên) |
| `Claude in Chrome:tabs_create_mcp` | Tạo tab mới nếu cần |
| `Claude in Chrome:navigate` | Điều hướng URL / back / forward |
| `Claude in Chrome:computer` | Click / type / screenshot / wait / scroll |
| `Claude in Chrome:read_page` | Đọc DOM → lấy ref của element |
| `Claude in Chrome:form_input` | Set giá trị textbox/combobox theo ref |
| `Claude in Chrome:browser_batch` | Chạy nhiều action trong 1 round-trip |
| `Claude in Chrome:read_network_requests` | Lấy URL ảnh từ network log |

### Quy tắc dùng tool

1. **Luôn gọi `tabs_context_mcp` trước** mọi action khác
2. **Ưu tiên dùng `ref` từ `read_page`** thay vì hard-code coordinate
3. **Dùng `browser_batch`** khi predict được nhiều bước liên tiếp
4. **`wait(2-3s)` sau mỗi navigate/click có thay đổi trang** để tránh race condition
5. **Chụp screenshot để verify** ở các điểm checkpoint: sau login, sau filter, sau khi có kết quả

---

## 🧩 Kiến trúc vận hành

```
┌──────────────┐
│  User Input  │
└──────┬───────┘
       ↓
┌──────────────────────┐
│ 1. ELICITATION       │ ← Xem user.md: cần hỏi gì
│  ask_user_input_v0   │
└──────┬───────────────┘
       ↓
┌──────────────────────┐
│ 2. BROWSER SETUP     │
│  tool_search         │
│  tabs_context_mcp    │
└──────┬───────────────┘
       ↓
┌──────────────────────┐
│ 3. NAVIGATE & LOGIN  │ ← Xem workflow.md Bước 2
│  navigate            │
│  check /login        │
│  login if needed     │
└──────┬───────────────┘
       ↓
┌──────────────────────┐
│ 4. VERIFY WAREHOUSE  │ ← Xem workflow.md Bước 3
│  check "Kho: ..."    │
│  switch if needed    │
└──────┬───────────────┘
       ↓
┌──────────────────────┐
│ 5. APPLY FILTERS     │ ← Xem selectors.md §4
│  read_page → ref     │
│  form_input / type   │
│  click "Tìm kiếm"    │
└──────┬───────────────┘
       ↓
┌──────────────────────┐
│ 6. READ RESULTS      │ ← Xem selectors.md §5
│  read_page           │
│  extract rows        │
└──────┬───────────────┘
       ↓
┌──────────────────────┐
│ 7. OPTIONAL DETAILS  │ ← Nếu user yêu cầu
│  click image btn     │
│  click Mã F link     │
└──────┬───────────────┘
       ↓
┌──────────────────────┐
│ 8. FORMAT & RESPOND  │ ← Xem output-format.md
└──────────────────────┘
```

---

## 🔐 Thông tin hệ thống

| Mục | Giá trị |
|---|---|
| **URL chính** | `https://khodi.vanchuyenkinkin.com/kho-hang/quan-ly-kien-f` |
| **Login URL** | `https://khodi.vanchuyenkinkin.com/login` |
| **Home URL (sau login)** | `https://khodi.vanchuyenkinkin.com/trangchu` |
| **Username** | `<KINKIN_USERNAME>` |
| **Password** | `<KINKIN_PASSWORD>` *(không in ra output)* |
| **Image CDN** | `https://image.vanchuyenkinkin.com/ContainerFile/ImageContainer/{DDMMYYYY}/{filename}.jpg` |
| **Detail URL pattern** | `/kho-hang/quan-ly-kien-f/sua-kien-f?id={uuid}` |

---

## 📚 Tài liệu tham chiếu

Khi cần biết chi tiết, agent tra cứu các file sau:

| File | Khi nào dùng |
|---|---|
| `soul.md` | Check nguyên tắc / giá trị — trước khi quyết định làm gì |
| `user.md` | Check context người dùng & cách tương tác |
| `workflow.md` | Xem quy trình chi tiết từng bước |
| `selectors.md` | Tra cứu HTML selector / ref / coordinate |
| `output-format.md` | Format kết quả trả về |
| `error-handling.md` | Xử lý lỗi & edge case |
| `examples.md` | Học từ ví dụ hội thoại mẫu |

---

## 🧠 Decision matrix

| Tình huống | Quyết định |
|---|---|
| User chỉ nói "tìm giúp tôi" | → Elicit: tiêu chí + kho + mức độ chi tiết |
| User đưa đủ mã tracking | → Chạy ngay, default kho Hà Nội, output cơ bản |
| Không có kết quả ở kho mặc định | → Nếu user không chỉ định kho → thử kho khác |
| Session hết hạn giữa chừng | → Login lại → quay lại state cũ → tiếp tục |
| Extension không kết nối | → Báo user check extension, đợi → retry 1 lần |
| User yêu cầu xóa / sửa | → Từ chối, gợi ý user thao tác trực tiếp |
| User nói "dừng" / "thôi" | → Dừng ngay, không hỏi thêm |

---

## ⏱ Performance guidelines

- **Đăng nhập đầu phiên**: ~5-7 giây
- **Áp filter + tìm kiếm**: ~3-5 giây
- **Lấy link ảnh**: thêm ~2-3 giây
- **Xem chi tiết**: thêm ~3-5 giây

Tổng 1 truy vấn đầy đủ: **~15-20 giây**. Nếu vượt quá → có bất thường, cần verify và báo user.
