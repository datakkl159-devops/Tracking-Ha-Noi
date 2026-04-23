# AI-Project — KinKin Tracking (OpenClaw + Standalone Bot)

Repo đóng gói toàn bộ dự án tracking KinKin, gồm:

1. **Standalone Telegram Bot** (production) — `workspace-ittracking-worker/scripts/` — Node.js thuần, không cần LLM, response 1-3s/query
2. **LLM Agent pipeline** (optional) — OpenClaw config + 3 workspace (ittracking, ittracking-worker, ittracking-qa) — dùng Claude Haiku/Sonnet qua Anthropic API hoặc 9router

## Cấu trúc

```
AI-Project/
├── README.md                         ← file này
├── .gitignore
├── .env.example                      ← template env vars (bot standalone)
├── openclaw.example.json             ← template config OpenClaw (đã redact secrets)
├── systemd/
│   ├── openclaw-gateway.service.example
│   └── ittracking-bot.service.example
│
├── workspace-ittracking/             ← LLM agent chính (Claude Haiku)
│   ├── AGENTS.md                     instruction/profile cho Claude
│   ├── IDENTITY.md, SOUL.md, USER.md, TOOLS.md
│   └── HEARTBEAT.md
│
├── workspace-ittracking-worker/      ← Worker (LLM agent + bot standalone)
│   ├── AGENTS.md, agent.md           prompt/rule cho agent
│   ├── workflow.md, selectors.md     playbook chi tiết
│   ├── examples.md, error-handling.md, output-format.md
│   ├── package.json, package-lock.json
│   ├── .allowed-chats.example.json, .group-sheets.example.json
│   └── scripts/                      Bot Node.js standalone
│       ├── tg-bot.mjs                Telegram poll + intent parse + reply
│       ├── lookup-core.mjs           KinKin API module
│       ├── lookup.mjs                CLI version (dev/debug)
│       ├── sheet-logger.mjs          Google Sheets logger
│       └── sniff-api.mjs             Dev tool (Playwright network sniff)
│
└── workspace-ittracking-qa/          ← QA subagent (Claude Sonnet)
    └── AGENTS.md, IDENTITY.md, SOUL.md, USER.md, TOOLS.md
```

## 2 cách chạy

### ✅ Mode A — Standalone bot (khuyên dùng cho production)

Bot Node thuần, không dùng LLM, cực nhanh. Đây là mode đang chạy trên máy local.

```bash
cd workspace-ittracking-worker
npm install
npx playwright install chromium
cp .env.example .env                  # điền TELEGRAM_BOT_TOKEN, KINKIN_USERNAME, KINKIN_PASSWORD, GOOGLE_SA_KEY_FILE
cp .allowed-chats.example.json .allowed-chats.json    # điền chat IDs
cp .group-sheets.example.json .group-sheets.json      # điền sheet IDs
node --env-file=.env scripts/tg-bot.mjs
```

Xem `workspace-ittracking-worker/README.md` cho chi tiết.

### 🤖 Mode B — Full OpenClaw + LLM agents (optional)

Chạy qua gateway OpenClaw, 3 agents Claude xử lý query bằng LLM. Chậm hơn, tốn API token, nhưng xử lý được ngôn ngữ tự nhiên phức tạp hơn.

**Yêu cầu:**
- OpenClaw gateway binary (v2026.4.8+) cài trên server
- Anthropic API key (hoặc 9router local)
- Telegram bot tokens riêng cho main + tracking

**Setup:**
```bash
cp openclaw.example.json openclaw.json
# Điền:
# - env.ANTHROPIC_API_KEY
# - gateway.auth.token (random 48 chars)
# - models.providers.9router.apiKey (nếu dùng 9router local)
# - channels.telegram.accounts.default.botToken + ittracking.botToken
# - agents[].workspace — update absolute path theo server

cp systemd/openclaw-gateway.service.example ~/.config/systemd/user/openclaw-gateway.service
# Edit User, paths trong service file
systemctl --user daemon-reload
systemctl --user enable --now openclaw-gateway
```

## Secrets và credentials cần chuẩn bị

| Secret | Mục đích | Lấy ở đâu |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Auth bot Telegram | @BotFather → /newbot |
| `KINKIN_USERNAME` / `PASSWORD` | Login khodi.vanchuyenkinkin.com | Tài khoản KinKin |
| `GOOGLE_SA_KEY_FILE` | Service Account log Sheets | GCP Console → IAM → Service Accounts → JSON key |
| `ANTHROPIC_API_KEY` | (Mode B) Claude API | console.anthropic.com |
| `9ROUTER_API_KEY` | (Mode B) Provider proxy | 9router local instance |

**Bắt buộc trên GCP:**
- Bật **Google Sheets API** trong project
- Share mỗi Google Sheet với email service account, quyền **Editor**

## State files (per-server, gitignored)

Sau lần đầu chạy, các file sau sẽ được tự tạo — **KHÔNG commit**:

| File | Mục đích |
|---|---|
| `.auth-state.json` | JWT cached của KinKin (Playwright lưu) |
| `.tg-offset` | Telegram polling offset |
| `.file-id-cache.json` | Telegram file_id cache cho ảnh |
| `.allowed-chats.json` | Danh sách group được phép |
| `.group-sheets.json` | Map group → sheet log |

## Troubleshooting

- `fetch failed` → force IPv4: đảm bảo `NODE_OPTIONS=--dns-result-order=ipv4first` trong `.env`
- `Bad Request: wrong type of the web page content` khi gửi ảnh → KinKin block Telegram IP, code đã fallback download + upload multipart + cache file_id
- Bot không nhận message → thiếu `@mention` bot trong tin nhắn (rule), hoặc chat_id chưa có trong `.allowed-chats.json`

## License

Private — nội bộ KinKin Logistics.
