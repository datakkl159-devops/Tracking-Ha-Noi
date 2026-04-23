# ITTracking Bot

Telegram bot tra cứu vận đơn KinKin (vanchuyenkinkin.com) — standalone Node.js, không dùng LLM.

## Kiến trúc

- `scripts/tg-bot.mjs` — Telegram long-poll, intent parse (regex), gọi KinKin API, reply + inline buttons
- `scripts/lookup-core.mjs` — module lookup chính (JWT cached, auto-refresh qua Playwright browser)
- `scripts/lookup.mjs` — CLI version của lookup-core (dev/debug)
- `scripts/sheet-logger.mjs` — log message vào Google Sheet qua Service Account
- `scripts/sniff-api.mjs` — dev tool: sniff network backend API (chỉ chạy khi cần debug)

## Tính năng

- Tra theo mã tracking / mã KH, date range, multi-warehouse (Hà nội / HCM / Shiki)
- 6 nút gợi ý: Trạng thái, Cần ảnh, Nhập kho đi, Kiểm hoá, Invoice, Chi tiết
- Ảnh: download + upload multipart + cache `file_id` (lần 2 instant, không tốn bandwidth)
- Multi-group: whitelist hot-reload từ `.allowed-chats.json`, mỗi group log vào 1 Google Sheet riêng qua `.group-sheets.json`
- Log system events: member_added, member_left, bot_reply, user_message, user_callback
- Concurrency limit (5 ảnh song song) + 429 retry-after

## Yêu cầu

- Node.js ≥ 18
- Tài khoản KinKin (có quyền access `khodi.vanchuyenkinkin.com`)
- Telegram bot (tạo qua @BotFather)
- Google Cloud Service Account (để log sheet)

## Cài đặt

```bash
git clone <repo-url> ittracking-bot
cd ittracking-bot
npm install
```

## Cấu hình

### 1. Environment variables

```bash
cp .env.example .env
# Điền các giá trị:
# - TELEGRAM_BOT_TOKEN (từ @BotFather)
# - TELEGRAM_BOT_USERNAME
# - KINKIN_USERNAME, KINKIN_PASSWORD
# - GOOGLE_SA_KEY_FILE (đường dẫn tới service account JSON)
```

### 2. Google Service Account

1. Google Cloud Console → IAM → Service Accounts → Create
2. Download JSON key, đặt vào `credentials/google-service-account.json` (hoặc đường dẫn trong `GOOGLE_SA_KEY_FILE`)
3. Bật **Google Sheets API** trong project
4. Mở mỗi sheet muốn log → Share với email service account (quyền Editor)
5. Mỗi sheet cần 1 tab tên `Log` — script sẽ tự tạo header

### 3. Group whitelist & sheet mapping

```bash
cp .allowed-chats.example.json .allowed-chats.json
cp .group-sheets.example.json .group-sheets.json
# Edit 2 file trên với chat_id + sheet_id thật
```

**Cách lấy chat_id:** add bot vào group → gửi bất kỳ tin nào có `@<bot>` → check log `Rejected chat id=...` → copy ID → thêm vào `.allowed-chats.json`.

## Chạy bot

### Test nhanh

```bash
# Node 20+ hỗ trợ sẵn --env-file
node --env-file=.env scripts/tg-bot.mjs

# Hoặc export biến môi trường thủ công (bất cứ Node version nào)
set -a; source .env; set +a; node scripts/tg-bot.mjs
```

### Systemd (production)

```bash
# Copy service template, edit đường dẫn
sudo cp systemd/ittracking-bot.service.example /etc/systemd/system/ittracking-bot.service
sudo nano /etc/systemd/system/ittracking-bot.service  # edit WorkingDirectory & paths

sudo systemctl daemon-reload
sudo systemctl enable --now ittracking-bot.service
sudo systemctl status ittracking-bot.service
```

Log:
```bash
tail -f /var/log/ittracking-bot.log
```

## State files (không commit)

| File | Mục đích | Lifecycle |
|---|---|---|
| `.auth-state.json` | JWT KinKin | Auto-refresh khi 401 (cần Playwright browser lần đầu) |
| `.tg-offset` | Telegram polling offset | Persist qua restart, tránh duplicate |
| `.file-id-cache.json` | Cache `file_id` ảnh Telegram | TTL 7 ngày |
| `.allowed-chats.json` | Chat IDs được phép | Hot-reload mỗi 30s |
| `.group-sheets.json` | chatId → sheetId mapping | Hot-reload mỗi 30s |

## Playwright (cho JWT refresh)

Lần đầu chạy cần cài browser cho Playwright:

```bash
npx playwright install chromium
# Nếu lỗi dependencies (Ubuntu/Debian):
npx playwright install-deps chromium
```

Sau khi JWT đã có trong `.auth-state.json`, các request tiếp theo dùng cached JWT trực tiếp — không cần browser. Browser chỉ chạy lại khi JWT hết hạn (401).

## Troubleshooting

**Bot không nhận message:** check `Rejected chat` trong log → add chat_id vào `.allowed-chats.json`.

**`fetch failed` / `ETIMEDOUT`:** Telegram API bị block IPv6. Đảm bảo `NODE_OPTIONS=--dns-result-order=ipv4first` trong `.env`. Code bot đã force IPv4 qua undici agent.

**Sheet log không hoạt động:** check:
- Service account đã được share quyền Editor trên sheet
- Google Sheets API đã enable trong Google Cloud project
- `GOOGLE_SA_KEY_FILE` trỏ đúng file JSON

**Ảnh không gửi được:** KinKin server có thể block Telegram IP. Code đã fallback: download ảnh về → upload multipart → cache file_id.
