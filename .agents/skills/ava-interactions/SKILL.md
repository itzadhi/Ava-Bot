---
name: ava-interactions
description: Interaction lifecycle patterns, sub-second acknowledgement, safeRespond, modal handling, Discord Components V2 limits, and ownership verification.
---

# AVA Discord Interactions Guide

## 1. The Sub-Second Ack-First Rule
Discord Gateway revokes interaction tokens after 3 seconds (Error 10062).
- **Rule:** Acknowledge immediately before executing ANY database query, file I/O, canvas rendering, or network call.
- **Commands:** Run through `runHandler()` which issues `deferReply()` within <500ms.
- **Buttons / Selects:** Use `runHandler()` with `meta.instant = false` to auto-defer via `deferUpdate()`.
- **Modals:** Set `meta.opensModal = true` in `runHandler()`. NEVER call `deferReply()` or `deferUpdate()` before `showModal()`. Modal opening buttons must read data strictly from memory or cache (<10ms).

## 2. safeRespond Pattern
Always send responses through `safeRespond(interaction, payload, options)`:
```javascript
import { safeRespond } from '../core/interactions/safeRespond.js';
import { errorCard } from '../ui/cards.js';

await safeRespond(interaction, {
  components: [myContainer],
  flags: MessageFlags.IsComponentsV2
});
```
`safeRespond` automatically:
- Checks if the interaction was deferred or replied to, using `editReply()`, `followUp()`, or `reply()`.
- Catches error code `50027` (expired webhook tokens > 15m) and falls back cleanly to `message.edit()`.
- Catches error code `10008` (deleted messages) without crashing.
- Prevents double-acknowledgement error `40060`.

## 3. Custom ID Structure & Limits
Discord enforces a strict **100-character limit** on `customId`.
Format: `module:action:guildId:ownerId:key`
- Always construct using:
  ```javascript
  import { buildId } from '../core/interactions/ownership.js';

  const customId = buildId({
    module: 'shop',
    action: 'buy',
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
    key: productId
  });
  ```
- If payload exceeds 100 characters, `buildId()` automatically stores the full payload in `sessionStore` and embeds an 8-character session key.
- Always parse with `parseId(customId)`.

## 4. Components V2 Limits & Guardrails
- **Max components per message:** 40 components.
- **Max characters per TextDisplay / Container:** 4,000 characters.
- **Max select menu options:** 25 options.
- **Max buttons per ActionRow:** 5 buttons.
- **Always grey buttons:** Every button MUST use `greyButton()` (`ButtonStyle.Secondary`) or `ButtonStyle.Link`.

## 5. Ownership & Access Verification
Enforced centrally in `runHandler()` via `checkPanelAccess(interaction, meta)`:
- `owner`: Only the panel opener, server owner, or bot administrator can click.
- `staff`: Opener, users with `ManageGuild`, or configured staff roles.
- `participant`: The customer/buyer or server staff (used in tickets and order disputes).
- `public`: Any guild member can interact.
Rejected interactions respond with an ephemeral notice without mutating the original panel.
