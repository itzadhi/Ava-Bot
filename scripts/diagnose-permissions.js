import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REST, Routes, PermissionFlagsBits } from 'discord.js';
import { config } from '../src/config.js';
import { db } from '../src/db/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(ROOT_DIR, 'reports');

// Baseline ordinary community permissions
export const BASELINE_PERMISSIONS = [
  { flag: PermissionFlagsBits.ViewChannel, name: 'View Channel', bit: 1024n },
  { flag: PermissionFlagsBits.SendMessages, name: 'Send Messages', bit: 2048n },
  { flag: PermissionFlagsBits.SendMessagesInThreads, name: 'Send Messages in Threads', bit: 274877906944n },
  { flag: PermissionFlagsBits.AddReactions, name: 'Add Reactions', bit: 64n },
  { flag: PermissionFlagsBits.ReadMessageHistory, name: 'Read Message History', bit: 65536n },
  { flag: PermissionFlagsBits.EmbedLinks, name: 'Embed Links', bit: 16384n },
  { flag: PermissionFlagsBits.AttachFiles, name: 'Attach Files', bit: 32768n },
  { flag: PermissionFlagsBits.UseExternalEmojis, name: 'Use External Emojis', bit: 262144n },
  { flag: PermissionFlagsBits.Connect, name: 'Connect', bit: 1048576n },
  { flag: PermissionFlagsBits.Speak, name: 'Speak', bit: 2097152n },
  { flag: PermissionFlagsBits.CreatePublicThreads, name: 'Create Public Threads', bit: 34359738368n },
  { flag: PermissionFlagsBits.UseApplicationCommands, name: 'Use Application Commands', bit: 2147483648n }
];

export const INTENTIONAL_READONLY_KEYWORDS = [
  'rule', 'announcement', 'notice', 'info', 'welcome', 'faq', 'hall-of-fame', 'update', 'changelog', 'resources'
];

function isIntentionalReadOnly(channelName) {
  const lower = (channelName || '').toLowerCase();
  return INTENTIONAL_READONLY_KEYWORDS.some(k => lower.includes(k));
}

function decodePermissions(permBitfield) {
  const bits = BigInt(permBitfield || 0);
  const present = [];
  const missing = [];

  for (const item of BASELINE_PERMISSIONS) {
    if ((bits & item.flag) === item.flag) {
      present.push(item.name);
    } else {
      missing.push(item.name);
    }
  }

  return { bits: bits.toString(), present, missing };
}

export async function runDiagnostics() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  const me = await rest.get(Routes.user('@me'));
  console.log(`[DIAGNOSE] Authenticated as bot: ${me.username}#${me.discriminator} (ID: ${me.id})`);

  const guilds = await rest.get(Routes.userGuilds());
  console.log(`[DIAGNOSE] Discovered ${guilds.length} guild(s)`);

  const summaries = [];

  for (const g of guilds) {
    console.log(`[DIAGNOSE] Scanning guild: ${g.name} (${g.id})...`);
    const guildData = await rest.get(Routes.guild(g.id));
    const roles = await rest.get(Routes.guildRoles(g.id));
    const channels = await rest.get(Routes.guildChannels(g.id));

    // 1. Role Analysis
    const everyoneRole = roles.find(r => r.id === g.id);
    const memberRoles = roles.filter(r => {
      const name = r.name.toLowerCase();
      return r.id !== g.id && (name.includes('member') || name.includes('verified') || name.includes('community'));
    });

    const everyoneDecoded = decodePermissions(everyoneRole?.permissions);
    const memberRolesDecoded = memberRoles.map(r => ({
      id: r.id,
      name: r.name,
      ...decodePermissions(r.permissions)
    }));

    // 2. Channel Overwrite Analysis
    const damagedChannels = [];
    const intentionalChannels = [];
    const slowmodeChannels = [];

    for (const ch of channels) {
      if (ch.rate_limit_per_user > 0) {
        slowmodeChannels.push({ id: ch.id, name: ch.name, slowmode: ch.rate_limit_per_user });
      }

      const overwrites = ch.permission_overwrites || [];
      const everyoneOw = overwrites.find(o => o.id === g.id);

      if (everyoneOw) {
        const denyBits = BigInt(everyoneOw.deny || 0);
        const deniesSend = (denyBits & PermissionFlagsBits.SendMessages) === PermissionFlagsBits.SendMessages;
        const deniesReactions = (denyBits & PermissionFlagsBits.AddReactions) === PermissionFlagsBits.AddReactions;
        const deniesThreads = (denyBits & PermissionFlagsBits.SendMessagesInThreads) === PermissionFlagsBits.SendMessagesInThreads;
        const deniesConnect = (denyBits & PermissionFlagsBits.Connect) === PermissionFlagsBits.Connect;

        if (deniesSend || deniesReactions || deniesThreads || deniesConnect) {
          const item = {
            id: ch.id,
            name: ch.name,
            type: ch.type,
            denyBits: denyBits.toString(),
            denies: {
              SendMessages: deniesSend,
              AddReactions: deniesReactions,
              SendMessagesInThreads: deniesThreads,
              Connect: deniesConnect
            }
          };

          if (isIntentionalReadOnly(ch.name)) {
            intentionalChannels.push(item);
          } else {
            damagedChannels.push(item);
          }
        }
      }
    }

    // 3. Guild Safety & Incident Analysis
    const safety = {
      verificationLevel: guildData.verification_level,
      safetyAlertsChannelId: guildData.safety_alerts_channel_id || null,
      incidentsData: guildData.incidents_data || null,
      slowmodeChannelCount: slowmodeChannels.length,
      slowmodeChannels
    };

    // 4. Database Stuck Rows Check
    let dbStatus = {};
    try {
      const [lockState, lockPlans, lockItems, avaJobs, permLogs] = await Promise.all([
        db.from('lockdown_state').select('*').eq('guild_id', g.id).catch(() => ({ data: [] })),
        db.from('lockdown_plans').select('*').eq('guild_id', g.id).catch(() => ({ data: [] })),
        db.from('lockdown_items').select('*').eq('guild_id', g.id).catch(() => ({ data: [] })),
        db.from('ava_jobs').select('*').eq('guild_id', g.id).catch(() => ({ data: [] })),
        db.from('permission_write_log').select('*').eq('guild_id', g.id).order('created_at', { ascending: false }).limit(20).catch(() => ({ data: [] }))
      ]);

      dbStatus = {
        lockdownState: lockState.data || [],
        lockdownPlans: lockPlans.data || [],
        lockdownItems: lockItems.data || [],
        avaJobs: avaJobs.data || [],
        permissionWriteLogCount: permLogs.data?.length || 0,
        recentWriteLogs: permLogs.data || []
      };
    } catch (err) {
      dbStatus = { error: err.message };
    }

    // 5. Audit Log Evidence (Entries made by the bot)
    let botAuditEntries = [];
    try {
      const auditLogRes = await rest.get(Routes.guildAuditLog(g.id), {
        query: new URLSearchParams({ limit: '100' })
      });
      const entries = auditLogRes.audit_log_entries || [];

      // Filter entries authored by the bot
      botAuditEntries = entries
        .filter(e => e.user_id === me.id)
        .map(e => ({
          id: e.id,
          actionType: e.action_type,
          targetId: e.target_id,
          reason: e.reason || null,
          changes: e.changes || []
        }));
    } catch (err) {
      console.warn(`[DIAGNOSE] Could not fetch audit logs for ${g.id}: ${err.message}`);
    }

    // Compile Guild Report
    const reportData = {
      guild: { id: g.id, name: g.name },
      timestamp: new Date().toISOString(),
      bot: { id: me.id, tag: `${me.username}#${me.discriminator}` },
      roles: {
        everyone: {
          id: everyoneRole?.id,
          name: '@everyone',
          permissions: everyoneRole?.permissions,
          ...everyoneDecoded
        },
        members: memberRolesDecoded
      },
      channels: {
        totalChannels: channels.length,
        damagedCount: damagedChannels.length,
        intentionalReadOnlyCount: intentionalChannels.length,
        damagedChannels,
        intentionalChannels
      },
      safety,
      database: dbStatus,
      auditLogs: {
        botEntriesFound: botAuditEntries.length,
        entries: botAuditEntries
      }
    };

    // Write JSON report
    const jsonPath = path.join(REPORTS_DIR, `damage-${g.id}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2), 'utf8');

    // Write Markdown report
    const mdPath = path.join(REPORTS_DIR, `damage-${g.id}.md`);
    const mdContent = generateMarkdownReport(reportData);
    fs.writeFileSync(mdPath, mdContent, 'utf8');

    summaries.push({
      guildId: g.id,
      guildName: g.name,
      everyoneMissing: everyoneDecoded.missing,
      damagedChannelsCount: damagedChannels.length,
      intentionalChannelsCount: intentionalChannels.length,
      botAuditEntriesCount: botAuditEntries.length,
      jsonPath,
      mdPath
    });
  }

  return summaries;
}

function generateMarkdownReport(data) {
  const { guild, bot, roles, channels, safety, database, auditLogs, timestamp } = data;

  return `# Live Server Permission Diagnosis Report: ${guild.name} (${guild.id})
- **Scan Timestamp:** ${timestamp}
- **Scanner Bot:** \`${bot.tag}\` (${bot.id})
- **Target Guild:** \`${guild.name}\` (${guild.id})

---

## 1. Role Permissions vs Baseline
### @everyone Role (\`${roles.everyone.id}\`)
- **Current Bitfield:** \`${roles.everyone.bits}\`
- **Missing Ordinary Community Permissions:**
${roles.everyone.missing.length === 0 ? '  - *None. All baseline permissions present.*' : roles.everyone.missing.map(p => `  - ❌ **${p}**`).join('\n')}
- **Present Baseline Permissions:**
${roles.everyone.present.map(p => `  - ✅ ${p}`).join('\n')}

### Member / Community Roles
${roles.members.length === 0 ? '- *No dedicated member/verified roles found matching naming keywords.*' : roles.members.map(m => `
#### Role: \`${m.name}\` (\`${m.id}\`)
- **Bitfield:** \`${m.bits}\`
- **Missing Baseline:** ${m.missing.length === 0 ? 'None' : m.missing.join(', ')}
`).join('\n')}

---

## 2. Channel Overwrites & Lockdown Clusters
- **Total Channels Inspected:** ${channels.totalChannels}
- **Lockdown/Damaged Channels (Unintentional):** ${channels.damagedCount}
- **Intentional Read-Only Channels:** ${channels.intentionalReadOnlyCount}

### Damaged / Blocked Channels
${channels.damagedChannels.length === 0 ? '- *No active lockdown overwrites denying messaging found for @everyone.*' : channels.damagedChannels.map(c => `
- **#${c.name}** (\`${c.id}\`):
  - Deny Bitfield: \`${c.denyBits}\`
  - Denies: ${Object.entries(c.denies).filter(([, v]) => v).map(([k]) => `\`${k}\``).join(', ')}
`).join('\n')}

### Intentional Read-Only Channels
${channels.intentionalChannels.length === 0 ? '- *No recognized rules/announcement channels.*' : channels.intentionalChannels.map(c => `
- **#${c.name}** (\`${c.id}\`)
`).join('\n')}

---

## 3. Guild Safety & Incident Actions
- **Verification Level:** ${safety.verificationLevel}
- **Safety Alerts Channel:** ${safety.safetyAlertsChannelId ? `\`${safety.safetyAlertsChannelId}\`` : '*Not configured*'}
- **Incident Actions (Invites/DMs):** ${safety.incidentsData ? JSON.stringify(safety.incidentsData) : '*None active*'}
- **Channels with Active Slowmode:** ${safety.slowmodeChannelCount}

---

## 4. Database State & Stuck Rows
- **Lockdown State Rows:** ${database.lockdownState?.length || 0}
- **Lockdown Plans:** ${database.lockdownPlans?.length || 0}
- **Pending/Stuck Jobs:** ${database.avaJobs?.filter(j => j.status !== 'completed' && j.status !== 'failed').length || 0}
- **Permission Write Log Count:** ${database.permissionWriteLogCount || 0}

---

## 5. Audit Log Evidence (Bot Modifications)
- **Total Bot Entries in Audit Retention:** ${auditLogs.botEntriesFound}
${auditLogs.entries.length === 0 ? '- *No bot entries recorded in audit log.*' : auditLogs.entries.map(e => `
- **Entry ID:** \`${e.id}\` (Action: \`${e.actionType}\`, Target: \`${e.targetId}\`)
  - **Reason:** \`${e.reason || 'None'}\`
  - **Changes:** ${JSON.stringify(e.changes)}
`).join('\n')}
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDiagnostics()
    .then((results) => {
      console.log('\n================ DIAGNOSTIC SUMMARY ================');
      for (const r of results) {
        console.log(`\nGuild: "${r.guildName}" (${r.guildId})`);
        console.log(`- @everyone Missing Permissions: ${r.everyoneMissing.length ? r.everyoneMissing.join(', ') : 'None'}`);
        console.log(`- Damaged Channels with Deny Overwrites: ${r.damagedChannelsCount}`);
        console.log(`- Intentional Read-Only Channels: ${r.intentionalChannelsCount}`);
        console.log(`- Bot Audit Log Entries Found: ${r.botAuditEntriesCount}`);
        console.log(`- Report Files: ${r.mdPath} & ${r.jsonPath}`);
      }
      console.log('\n====================================================\n');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[DIAGNOSE] Error:', err);
      process.exit(1);
    });
}
