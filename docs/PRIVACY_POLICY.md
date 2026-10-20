# Argoni Privacy Policy

**Effective Date**: October 18, 2026  
**Last Updated**: October 18, 2026  

Argoni ("we", "our", or "the Bot") is committed to protecting your privacy and handling your data with complete transparency, integrity, and compliance with the Discord Developer Policy and global privacy regulations (including GDPR).

---

## 1. Data We Collect & Why

Argoni operates exclusively as a Discord server management, backup, template, and synchronization utility. We strictly collect only the data necessary to provide these requested features:

### A. Guild Structural Data (Backups & Templates)
- **Data Collected**: Server names, category hierarchies, channel names, slowmode/topic configurations, role names, colors, hierarchy positions, and permission bitfields.
- **Purpose**: To allow authorized server administrators to generate backup snapshots and restore or clone server structures.
- **Exclusions**: We do not store member direct messages, personal profiles, or channel contents in standard backups.

### B. Message History (Chatlogs & Realtime Sync)
- **Explicit Opt-in Required**: Message content is **never** collected by default. The server owner must explicitly opt in via `/settings set-chatlog enabled:true` or `/settings set-message-sync enabled:true`.
- **Purpose**: To archive channel history for disaster recovery or synchronize designated channels between approved servers.
- **Encryption**: All message content is protected with application-level **AES-256-GCM encryption** prior to storage. Encryption keys are managed strictly server-side and never exposed.

### C. Operational & Audit Identifiers
- **Data Collected**: Discord User Snowflake IDs, Guild Snowflake IDs, and timestamps of administrative actions (e.g., who created or loaded a backup).
- **Purpose**: To provide an immutable server audit trail (`/audit view`) and prevent abuse.

---

## 2. Data Storage & Security

- **Infrastructure**: All database tables and file assets are securely hosted on Supabase (PostgreSQL with private, authenticated storage buckets).
- **Row Level Security (RLS)**: Enabled across all database tables. Public and anonymous access is strictly blocked; only authenticated service-role bot processes can access data.
- **No Selling or Sharing**: We never sell, rent, monetize, or disclose user data to third parties, advertisers, or data brokers.

---

## 3. Data Retention & Automatic Erasure

- **Automated Backup Rotation**: Automated backups rotate on a configurable FIFO basis (skipping locked backups).
- **Chatlog Expiry (TTL)**: Chatlog archives are automatically purged after **90 days**.
- **Departed Server Cleanup**: When Argoni is removed from a server, all server backups, chatlogs, templates, sync pipelines, and settings enter a 30-day grace period. If the bot is not re-added, **all guild data is permanently deleted after 30 days**.

---

## 4. User Rights & Data Erasure (GDPR)

Users and server owners retain full control over their data:
- **Personal Data Erasure**: Any user can run `/privacy delete-my-data` to erase all audit trail entries tied to their Discord user ID.
- **Server Data Erasure**: Server owners can run `/privacy delete-server-data` to immediately and permanently wipe every backup, chatlog, template, and configuration record for their guild.

---

## 5. Contact Information

For inquiries, support, or privacy concerns:
- **Support Discord**: https://discord.gg/argoni
- **Website**: https://argoni.app
- **Email**: privacy@argoni.app
