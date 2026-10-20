# Argoni Discord Bot Verification Checklist

Use this checklist to prepare Argoni for the official Discord Bot Verification review.

---

## 1. Discord Developer Portal Configuration

- [ ] **Application Profile**:
  - **Name**: Argoni
  - **Icon / Avatar**: Upload `assets/logo.jpg` (Official white geometric 'A' emblem on dark background).
  - **Description**: Production-grade server backup, restore, templates, cloning, and channel synchronization platform.
  - **Tags**: `backup`, `templates`, `moderation`, `sync`, `utility`
- [ ] **Policy & Support Links**:
  - **Terms of Service URL**: `https://argoni.app/terms` (or link to `docs/TERMS.md`)
  - **Privacy Policy URL**: `https://argoni.app/privacy` (or link to `docs/PRIVACY_POLICY.md`)
  - **Support Server**: Link to the official Argoni support guild (e.g. `https://discord.gg/argoni`).
- [ ] **Interactions Endpoint URL**:
  - Leave blank (Argoni is a gateway bot with Discord WebSocket connection and auto-sharding).

---

## 2. Privileged Gateway Intents (Bot Tab)

- [x] **Server Members Intent (`GUILD_MEMBERS`)**: ENABLED (Required for role restoration, member hierarchy checks, and `/sync role-assign`).
- [x] **Message Content Intent (`MESSAGE_CONTENT`)**: ENABLED (Required for prefix commands, opted-in chatlogs, and opted-in `/sync messages`).
- [ ] **Presence Intent (`GUILD_PRESENCES`)**: **DISABLED** (Never request this intent; Argoni does not read member presences).

---

## 3. Account & Team Security

- [ ] **Team Ownership**:
  - The application is transferred to a Discord Developer Team.
- [ ] **Two-Factor Authentication (2FA)**:
  - 2FA is strictly enabled on the owner's account and **all team members**' accounts.

---

## 4. Verification Form Submission Answers

- **Application Feature Summary**:
  > Argoni is a production-grade Discord server backup, restore, cloning, template, and synchronization bot. It enables server owners and administrators to safeguard their communities against griefing, accidental channel deletion, or server compromise. It features gzipped snapshots, AES-256-GCM encrypted disaster chatlogs, community templates, and real-time channel sync pipelines. Built with Discord Components V2 only.
- **Intent Explanations**:
  > Copy directly from `docs/INTENT_JUSTIFICATION.md`.

---

## 5. Milestone Reminder

- 🔔 **Applying Window**: Discord allows bot verification applications once your bot reaches **75+ servers**.
- ⚠️ **Mandatory Threshold**: Bot verification is mandatory before joining **100 servers**. Once at 100 servers, unverified bots cannot join additional guilds.
