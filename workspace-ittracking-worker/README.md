# KinKin Tracking Agent

Sub-agent tự động tra cứu mã tracking trên hệ thống kho hàng **KinKin Logistics** (`khodi.vanchuyenkinkin.com`), hoạt động qua browser automation.

---

## 📁 Cấu trúc file

### 🔵 Core (bắt buộc — đọc theo thứ tự)

| # | File | Vai trò |
|---|---|---|
| 1 | **`soul.md`** | 🪪 Danh tính, giá trị cốt lõi, nguyên tắc bất biến |
| 2 | **`agent.md`** | 🛠 Năng lực, công cụ, decision matrix |
| 3 | **`user.md`** | 👤 Chân dung người dùng, cách tương tác |

### 🟡 Reference (tra cứu khi cần)

| # | File | Vai trò |
|---|---|---|
| 4 | `workflow.md` | Quy trình 8 bước chi tiết |
| 5 | `selectors.md` | HTML selector, ref, coordinate |
| 6 | `output-format.md` | Template kết quả (A → F) |
| 7 | `error-handling.md` | 14 edge case |
| 8 | `examples.md` | 9 hội thoại mẫu |

---

## 🧠 Thứ tự đọc chuẩn

```
soul.md   →   agent.md   →   user.md
  (là ai)       (làm gì)      (phục vụ ai)
      ↓              ↓              ↓
          [sẵn sàng hoạt động]
                    ↓
     ┌──────────────┼──────────────┐
     ↓              ↓              ↓
 workflow.md  selectors.md  output-format.md
     ↓              ↓              ↓
error-handling.md ── examples.md
```

---

## 🚀 Cách nạp làm sub-agent

### Cách 1 — System prompt gộp (đơn giản)

Ghép theo thứ tự vào system prompt:
```
soul.md + agent.md + user.md + workflow.md + selectors.md 
+ output-format.md + error-handling.md + examples.md
```

### Cách 2 — System prompt ngắn + tài liệu tham chiếu (tiết kiệm token)

System prompt:
```markdown
Bạn là KinKin Tracking Agent.

Tài liệu của bạn:
- soul.md     → danh tính & giá trị
- agent.md    → năng lực & công cụ
- user.md     → cách tương tác
- workflow.md → 8 bước thao tác
- selectors.md → HTML reference
- output-format.md → template output
- error-handling.md → xử lý lỗi
- examples.md → ví dụ mẫu

Luôn đọc 3 file core (soul, agent, user) trước. 
Tra cứu các file còn lại khi cần.
```

### Cách 3 — Đóng gói thành skill

Đưa toàn bộ folder vào 1 skill với SKILL.md là `README.md` này.

---

## ⚙️ Yêu cầu môi trường

- Chrome đang mở
- Extension **"Claude for Chrome"** đã cài + đăng nhập
- Domain `khodi.vanchuyenkinkin.com` được cấp quyền
- Tài khoản KinKin hợp lệ: `<KINKIN_USERNAME>` / `<KINKIN_PASSWORD>`

---

## 🔐 Lưu ý bảo mật

- File `soul.md` và `agent.md` chứa **mật khẩu plain text**
- Không commit public
- Production: tách credentials ra secret store / env var

---

## 📌 Version

- **v2.0** — 21/04/2026 — Cấu trúc chuẩn soul/agent/user
- v1.0 — 21/04/2026 — Bản đầu

---

## 🧪 Test nhanh

Sau khi nạp agent:
> "Tra mã F1050159 giúp"

**Kỳ vọng:** Agent đăng nhập (nếu cần), tìm kiếm tại kho Hà Nội, trả về Template A với đầy đủ 13 trường dữ liệu và gợi ý next step.
