# AeroX Feedback Bot

A Discord bot for collecting structured feedback from server members, built with Discord.js v14 using the latest Components V2 API. Supports both slash commands and prefix commands, interactive setup, emoji syncing, and automatic slash command registration on startup.

> **Support Server:** [discord.gg/aerox](https://discord.gg/aerox)
> **Developer:** warrior (AeroX Development)

---

## Features

- Components V2 UI — rich panels using `ContainerBuilder`, `SectionBuilder`, `ThumbnailBuilder`, and more
- Slash commands + prefix commands (configurable prefix via `.env`)
- Star rating system (1–5) with optional screenshot attachment
- Per-guild feedback channel configuration with automatic locking
- Application emoji sync on startup — uploads missing emojis automatically
- Slash commands register automatically on every startup — no manual deploy step needed
- Colored, structured console output for easy debugging

---

## Requirements

- Node.js 20 or higher
- A Discord bot token and application ID from the [Discord Developer Portal](https://discord.com/developers/applications)

---

## Setup

1. **Clone the repository**

2. **Install dependencies**
   ```
   npm install
   ```

3. **Create your `.env` file** in the project root:
   ```
   DISCORD_TOKEN=your_bot_token_here
   DISCORD_CLIENT_ID=your_application_id_here
   BOT_PREFIX=,,
   ```

4. **Enable Privileged Intents** in the Discord Developer Portal under `Bot > Privileged Gateway Intents`:
   - Server Members Intent
   - Message Content Intent

5. **Start the bot**
   ```
   node --env-file=.env src/index.js
   ```

   On startup the bot will automatically:
   - Sync application emojis
   - Register slash commands globally
   - Log in and set its presence

---

## Environment Variables

| Variable          | Required | Description                                      |
|-------------------|----------|--------------------------------------------------|
| `DISCORD_TOKEN`   | Yes      | Your bot's token from the Developer Portal       |
| `DISCORD_CLIENT_ID` | Yes    | Your application's client ID                     |
| `BOT_PREFIX`      | No       | Prefix for text commands (default: `,,`)         |

---

## Commands

### Slash Commands

| Command     | Description                                          | Permission      |
|-------------|------------------------------------------------------|-----------------|
| `/feedback` | Opens the feedback panel (ephemeral)                 | Everyone        |
| `/setup`    | Configures the feedback channel for this server      | Manage Server   |
| `/ping`     | Shows bot latency and API response time              | Everyone        |
| `/help`     | Lists all available commands                         | Everyone        |

### Prefix Commands

| Command                  | Description                                                    |
|--------------------------|----------------------------------------------------------------|
| `,,feedback`             | Sends the feedback panel to your DMs                           |
| `,,setup`                | Interactive channel setup (prompts you to mention a channel)   |
| `,,setup #channel`       | Configures the given channel directly                          |
| `,,ping`                 | Shows bot latency                                              |
| `,,help`                 | Lists all commands                                             |
| `,,listemoji`            | Lists all registered application emojis                        |

> The prefix shown above (`,,`) is the default. Change it by setting `BOT_PREFIX` in your `.env`.

---

## How Feedback Works

1. A user runs `/feedback` or `,,feedback`
2. The bot presents a panel with a "Write Your Review" button
3. A modal collects their star rating (1–5), written review, and an optional screenshot URL
4. After submitting, the bot asks if they want to attach a screenshot from their DMs (60 second window)
5. The completed feedback card is posted to the server's configured feedback channel

---

## Customization

### Changing the Prefix
Set `BOT_PREFIX` in your `.env` file. No code changes needed.

### Emojis
Edit `data/emoji.json` and restart the bot. The emoji sync utility will automatically upload any new entries to your application and update the IDs.

### Feedback Panel Text
Edit the `feedbackPanel()` function in `src/commands/setup.js`.

### Feedback Card Appearance
Edit the `buildFeedbackCard()` function in `src/commands/feedback.js`.

---

## Project Structure

```
src/
  commands/
    feedback.js       — Feedback command + card builder
    help.js           — Help command
    ping.js           — Ping command
    setup.js          — Setup command + feedback panel
    listemoji.js      — List emojis command
  events/
    ready.js          — Bot ready event (presence, login log)
    messageCreate.js  — Prefix command handler + image upload listener
    interactionCreate.js — Slash command, button, and modal handler
  handlers/
    emoji.js          — Read/write helpers for emoji.json
    feedback.js       — Guild config helpers + star builder
  utils/
    syncEmojis.js     — Uploads and corrects application emojis on startup
    deployCommands.js — Registers slash commands with Discord on startup
    config.js         — Shared config (prefix, etc.)
  index.js            — Entry point
data/
  emoji.json          — Application emoji definitions
  guilds.json         — Per-guild feedback channel config (auto-generated)
```

---

## Tech Stack

- [discord.js](https://discord.js.org/) v14
- Node.js (ESM modules)

---

## Credits

Developed by **warrior** for **AeroX Development**.

For support, questions, or permission requests, join the community:
**[discord.gg/aerox](https://discord.gg/aerox)**

---

## License

This project is source-available under a custom license. See [LICENSE](./LICENSE) for full terms.

In short:
- You may view, run privately, and modify for personal use
- You may **not** redistribute, sublicense, sell, or publicly host this bot without written permission
- You may **not** claim authorship or remove the license/copyright notice
