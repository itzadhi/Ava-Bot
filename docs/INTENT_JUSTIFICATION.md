# Discord Bot Verification: Privileged Intent Justifications

**Bot Name**: Argoni  
**Application ID**: [Insert Client ID]  

Use the clear, honest explanations below when submitting the Discord Bot Verification application form.

---

## 1. Server Members Intent (`GUILD_MEMBERS`)

### Why does Argoni need this intent?
Argoni is a disaster-recovery, server backup, and cross-server synchronization platform. The `GUILD_MEMBERS` intent is strictly necessary for two primary core features:

1. **Role Restoration & Reassignment**:
   When restoring a server backup or loading a template, Argoni needs to reconstruct member roles and permissions. Furthermore, for verification of server ownership and administrative authority across multiple servers (such as `/copy` and `/sync`), the bot must fetch the invoking user's member object to ensure they possess `Manage Server` or `Administrator` permissions in both origin and destination guilds.

2. **Cross-Server Role Assignment Synchronization (`/sync role-assign`)**:
   Communities running sister servers or tier networks synchronize specific VIP or staff roles between servers. The bot listens to member updates and updates member roles in linked servers.

### Data Handling:
- Member objects are accessed in-memory during real-time operations.
- Argoni **does not** store member lists, profiles, or personal member data in long-term storage.

---

## 2. Message Content Intent (`MESSAGE_CONTENT`)

### Why does Argoni need this intent?
Argoni requests `MESSAGE_CONTENT` for three specific, user-requested features:

1. **Server Chat History Disaster Recovery (`/chatlog create`)**:
   Communities frequently suffer accidental channel deletions or server raids. `/chatlog create` provides an explicit disaster backup of channel message history.
   - **Strict Opt-in**: This feature is **disabled by default**. It can only be activated if the server owner explicitly toggles `/settings set-chatlog enabled:true`.
   - **Encryption at Rest**: All exported message history is compressed with gzip and encrypted with application-level **AES-256-GCM** before being stored in private Supabase Storage buckets.
   - **Strict 90-Day Retention**: All chatlogs automatically expire and are purged after 90 days.

2. **Cross-Server Channel Synchronization (`/sync messages`)**:
   Allows linked servers (such as announcement channels or partner networks) to bridge designated channels.
   - Requires explicit opt-in on both servers (`/settings set-message-sync enabled:true`).
   - Content is read in real time, checked against an anti-loop cache (`synced_messages`), and mirrored to the destination channel via Discord Webhooks.

3. **Prefix Command Parsing**:
   Allows communities to run traditional text commands (e.g. `a!backup create`, `a!help`). Every prefix command has an identical Slash Command equivalent. If `MESSAGE_CONTENT` is not granted, Argoni gracefully disables prefix commands while remaining 100% functional via Slash Commands.

### Data Handling:
- Message content is never logged in console or error logs.
- Message content is never shared with third parties or used for profiling.

---

## 3. Intents NOT Requested

To demonstrate adherence to Discord's principle of least privilege:
- **`GUILD_PRESENCES`**: **NOT requested**. Argoni does not inspect or track user activities, games, or online presence.
- **Direct Message Intents**: Not used for general commands.
