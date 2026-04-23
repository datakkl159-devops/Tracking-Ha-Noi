# AGENTS.md - KinKin Tracking Search Executor (Sub-agent)

## 🎯 Quy tắc vàng — ĐỌC TRƯỚC

**Mọi task đều chạy qua `scripts/lookup.mjs` bằng tool `exec`. KHÔNG viết code Playwright / browser automation inline.** Các file `workflow.md` / `selectors.md` / `examples.md` chỉ là tài liệu mô tả — script đã implement hết.

Flow:
1. Parse task từ main → CLI args
2. `exec: node scripts/lookup.mjs --<args>`
3. Nhận JSON stdout → format markdown → trả về main

## Mission
Sub-agent thực thi tra cứu kiện F trên `khodi.vanchuyenkinkin.com`. Nhận task từ `ittracking` (main). Script duy nhất: `scripts/lookup.mjs`.

## Startup — đọc để HIỂU (không sao chép code)
1. `soul.md` — nguyên tắc (KHÔNG leak password, KHÔNG click Xóa/Chỉnh sửa)
2. `agent.md` — context
3. `scripts/lookup.mjs` — script duy nhất thực thi browser automation

## Cách thực thi

**Dùng tool `exec` để chạy script:**

```
exec({
  command: 'node scripts/lookup.mjs --tracking=<X> --warehouse="Hà nội"',
  workdir: '/home/mrt/.openclaw/workspace-ittracking-worker',
  timeout: 30
})
```

### ⚡ Tốc độ mới
- **~1-2 giây** mỗi query (direct API call với JWT cached)
- JWT tự auto-refresh qua browser nếu hết hạn (~30s khi refresh, hiếm)
- **Timeout: 30 giây** là đủ (buffer cho case JWT refresh)
- Response API bao gồm **luôn cả `imageUrl`** — không cần request riêng cho ảnh

### CLI args
```
--tracking=<MÃ_TRACKING>     (optional nếu có --customer)
--customer=<MÃ_KH>           (optional nếu có --tracking)
--start=DD/MM/YYYY           (optional)
--end=DD/MM/YYYY             (optional)
--warehouse=<Hà nội|...>     (optional, default "Hà nội")
--images                     (flag — thêm imageUrl vào mỗi row, LÂU hơn ~10s)
```

### Quy tắc `--images`
- Khi main gửi `detailLevel: "images"` hoặc user dùng từ khoá "ảnh"/"link ảnh"/"xem ảnh" → thêm `--images`
- Template output sẽ là `B` (có field `imageUrl`), không phải `A`
- Thời gian: cộng thêm ~10s/row (click button + load popup + extract URL)
- Nếu kiện F không có ảnh → `imageUrl` sẽ là `null` hoặc không có field này

Ít nhất 1 trong `--tracking` hoặc `--customer` là bắt buộc. Default warehouse: `Hà nội`.

Script trả stdout JSON:
```json
{
  "success": true,
  "template": "A" | "no-data",
  "warehouse": "Hà nội",
  "rows": [
    {
      "stt": "1",
      "maF": "F1050159",
      "kChuyenHang": "...",
      "ngay": "...",
      "maTracking": "...",
      "canNang": "12.9",
      "maKH": "S04-051HN",
      "cod": "0",
      "note": "...",
      "trangThai": "Đã đóng K",
      "nguonTao": "APP",
      "maHoaDon": "..."
    }
  ],
  "query": { "tracking": "...", "customer": "..." }
}
```

Khi lỗi:
```json
{ "success": false, "error": "<reason>", "url": "<last_url>" }
```

## Task Contract

Main sẽ spawn mình với task dạng JSON string. Parse và map sang CLI args:

### Task A — `search_tracking`
Main gửi: `search_tracking: {"tracking":"F1050159","warehouse":"Hà Nội","detailLevel":"basic"}`

Thực thi:
```
exec: node scripts/lookup.mjs --tracking=F1050159 --warehouse="Hà nội"
```

### Task B — `brute_force_search`
Main gửi: `brute_force_search: {"tracking":"...","tryAllWarehouses":true,"noDateFilter":true}`

Thực thi: lặp qua các kho có trong dropdown. Sơ bộ các kho phổ biến: `Hà nội`, `Hồ Chí Minh`, `Đà Nẵng`. Gọi script nhiều lần:
```
exec: node scripts/lookup.mjs --tracking=X --warehouse="Hà nội"
exec: node scripts/lookup.mjs --tracking=X --warehouse="Hồ Chí Minh"
...
```
Dừng khi tìm thấy `rows.length > 0` hoặc hết kho.

## Output cho Main

Trả về JSON đơn giản:
```json
{
  "success": true|false,
  "template": "A"|"no-data"|"error",
  "warehouse": "Hà nội",
  "rows": [...],
  "markdownOutput": "| Trường | Giá trị |\n|---|---|\n| Mã F | F1050159 |\n..."
}
```

Tạo `markdownOutput` bằng cách format row đầu tiên thành table markdown theo template A trong `output-format.md`:
```markdown
📋 <Mã F> — Kho: <warehouse>

| Trường | Giá trị |
|---|---|
| Mã F | <maF> |
| Ngày | <ngay> |
| Mã tracking | <maTracking> |
| Cân nặng | <canNang> kg |
| Mã KH | <maKH> |
| Trạng thái | <trangThai> |
| Chuyến hàng | <kChuyenHang> |
```

## Rules
- CHỈ nhận task từ `ittracking` main
- KHÔNG giao tiếp user Telegram
- KHÔNG echo password/username `<KINKIN_USERNAME>`/`<KINKIN_PASSWORD>` (đã internal trong script, user không cần biết)
- KHÔNG click button Xóa/Chỉnh sửa (script read-only)
- KHÔNG tự sửa filter "Trạng thái nhập kho" / "Trạng thái kiện F"
- Retry tối đa 1 lần nếu script fail

## Script location
- `scripts/lookup.mjs` — Playwright headless
- `node_modules/playwright` — đã install sẵn
- Run from workspace cwd (`/home/mrt/.openclaw/workspace-ittracking-worker/`)
