# Suggestion Bot

A full-featured Discord suggestion bot using **Components v2** (Container Builder, Section Builder, Text Display, Separator, Action Row, Buttons).

Made by **ayliee**, **Aerox Development**.

---

## Features

- `/suggest` — Submit a suggestion (also `!suggest`)
- `/setsuggestions #channel` — Set the suggestion channel (Manage Server)
- `/removesuggestions` — Remove the suggestion channel (Manage Server)
- `/threadconfig [seconds]` — Set slowmode for suggestion threads (Manage Server)
- `/moderate <message_id> <status>` — Approve, deny, or consider a suggestion (Manage Messages)
- Upvote / Downvote buttons on every suggestion (Components v2)
- Per-guild config stored in `db.json`
- Prefix commands (`!`) alongside slash commands

---

## Pterodactyl Setup

1. **Upload files** — Upload this entire folder to your Pterodactyl container.
2. **Fill `.env`** — Copy `.env.example` to `.env` and fill in:
   ```
   TOKEN=your_bot_token_here
   CLIENT_ID=your_client_id_here
   ```
3. **Set startup command** — In Pterodactyl, set the startup command to:
   ```
   node index.js
   ```
   Or use the JS File variable: `index.js`
4. **Start** — Hit Start. The bot will install dependencies via `npm install` if using the Node.js egg with auto-install, then start.

### Node.js Egg (Pterodactyl)

- **Startup**: `if [ -f package.json ]; then npm install; fi; node {{JS_FILE}}`
- **JS_FILE variable**: `index.js`
- **Node version**: 18 or higher

---

## Local Setup

```bash
npm install
cp .env.example .env
# Fill in .env
npm start
```

---

## Required Bot Permissions

- `Send Messages`
- `Read Message History`
- `Manage Messages` (for deleting prefix command triggers)
- `Create Public Threads`
- `Send Messages in Threads`
- `Embed Links`
- `Use Application Commands`

---

## Environment Variables

| Variable    | Description                                      |
|-------------|--------------------------------------------------|
| `TOKEN`     | Your bot token from the Discord Developer Portal |
| `CLIENT_ID` | Your bot's Application ID                        |
