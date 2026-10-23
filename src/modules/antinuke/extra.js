import {
  AuditLogEvent,
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags
} from 'discord.js';
import {
  getAntiNukeSettings,
  isTrusted,
  recordAntiNukeIncident
} from '../../db/antinuke.js';
import { punishOffender } from './restore.js';
import { logger } from '../../utils/logger.js';

// Sliding windows for extra protections:
// Map<`${guildId}:${type}:${executorId}`, Array<number timestamps>>
const extraSlidingWindows = new Map();

function trackEvent(guildId, type, executorId, windowSecs = 10) {
  const key = `${guildId}:${type}:${executorId}`;
  const now = Date.now();
  const list = (extraSlidingWindows.get(key) || []).filter(t => now - t < windowSecs * 1000);
  list.push(now);
  extraSlidingWindows.set(key, list);
  return list.length;
}

/**
 * Mass Role Deletion Guard
 */
export async function handleRoleDeleteEvent(role) {
  if (!role?.guild) return;
  const guild = role.guild;

  try {
    const settings = await getAntiNukeSettings(guild.id);
    if (!settings || settings.enabled === false) return;

    // Fetch audit log
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 }).catch(() => null);
    const entry = typeof logs?.entries?.first === 'function' ? logs.entries.first() : (logs?.entries?.values?.().next()?.value || null);
    const executor = entry?.executor;
    if (!executor) return;

    if (await isTrusted(guild, executor.id)) return;

    const limit = settings.thresholds?.mass_role_delete_limit || 3;
    const windowSecs = settings.thresholds?.mass_role_delete_window_seconds || 10;
    const count = trackEvent(guild.id, 'role_delete', executor.id, windowSecs);

    if (count >= limit) {
      const punishmentResult = await punishOffender(
        guild,
        executor,
        settings.punishment || 'ban',
        `Argoni Anti-Nuke: Mass role deletion detected (${count} roles in ${windowSecs}s)`,
        Boolean(settings.dry_run)
      );

      // Recreate deleted role (name, color, permissions, hoist, mentionable)
      let recreated = false;
      try {
        if (!settings.dry_run) {
          await guild.roles.create({
            name: role.name,
            color: role.color,
            permissions: role.permissions,
            hoist: role.hoist,
            mentionable: role.mentionable,
            reason: 'Argoni Anti-Nuke: Emergency role restoration'
          });
          recreated = true;
        }
      } catch (err) {
        logger.warn({ err }, 'Could not recreate deleted role');
      }

      await recordAntiNukeIncident(guild.id, 'mass_role_delete', executor.id, {
        roleName: role.name,
        count,
        punishment: punishmentResult,
        recreated
      });

      sendSecurityAlert(guild, settings, {
        title: 'Mass Role Deletion Intercepted',
        offender: executor,
        action: punishmentResult,
        description: `Deleted **${count}** roles within ${windowSecs}s. Role \`${role.name}\` was automatically recreated.`
      });
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id }, 'Error in handleRoleDeleteEvent');
  }
}

/**
 * Unauthorized Bot Add Guard
 */
export async function handleBotAddEvent(member) {
  if (!member?.user?.bot || !member.guild) return;
  const guild = member.guild;

  try {
    const settings = await getAntiNukeSettings(guild.id);
    if (!settings || settings.enabled === false) return;
    if (settings.thresholds?.bot_add_protection === false) return;

    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 1 }).catch(() => null);
    const entry = typeof logs?.entries?.first === 'function' ? logs.entries.first() : (logs?.entries?.values?.().next()?.value || null);
    const executor = entry?.executor;
    if (!executor) return;

    if (await isTrusted(guild, executor.id)) return;

    // Unauthorized bot added! Kick or ban the unauthorized bot
    try {
      if (!settings.dry_run) {
        await member.kick('Argoni Anti-Nuke: Unauthorized bot added by non-trusted user');
      }
    } catch (_) {}

    // Punish the user who added it
    const punishmentResult = await punishOffender(
      guild,
      executor,
      settings.punishment || 'ban',
      `Argoni Anti-Nuke: Added unauthorized bot (${member.user.tag})`,
      Boolean(settings.dry_run)
    );

    await recordAntiNukeIncident(guild.id, 'unauthorized_bot_add', executor.id, {
      botTag: member.user.tag,
      botId: member.id,
      punishment: punishmentResult
    });

    sendSecurityAlert(guild, settings, {
      title: 'Unauthorized Bot Add Intercepted',
      offender: executor,
      action: punishmentResult,
      description: `Attempted to invite bot \`${member.user.tag}\`. Bot was expelled immediately.`
    });
  } catch (err) {
    logger.error({ err, guildId: guild.id }, 'Error in handleBotAddEvent');
  }
}

/**
 * Dangerous Permission Grant Guard (Administrator / ManageGuild / ManageRoles added to role)
 */
export async function handleRoleUpdateEvent(oldRole, newRole) {
  if (!newRole?.guild) return;
  const guild = newRole.guild;

  try {
    const settings = await getAntiNukeSettings(guild.id);
    if (!settings || settings.enabled === false) return;
    if (settings.thresholds?.dangerous_perm_grant === false) return;

    // Check if dangerous permissions were added
    const dangerousBits = [
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.ManageRoles
    ];

    const addedDangerous = dangerousBits.some(bit => !oldRole.permissions.has(bit) && newRole.permissions.has(bit));
    if (!addedDangerous) return;

    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.RoleUpdate, limit: 1 }).catch(() => null);
    const entry = typeof logs?.entries?.first === 'function' ? logs.entries.first() : (logs?.entries?.values?.().next()?.value || null);
    const executor = entry?.executor;
    if (!executor) return;

    if (await isTrusted(guild, executor.id)) return;

    // Revert permissions immediately
    try {
      if (!settings.dry_run) {
        await newRole.setPermissions(oldRole.permissions, 'Argoni Anti-Nuke: Reverting unauthorized dangerous permission grant');
      }
    } catch (err) {
      logger.warn({ err }, 'Could not revert role permissions');
    }

    // Punish executor
    const punishmentResult = await punishOffender(
      guild,
      executor,
      settings.punishment || 'ban',
      `Argoni Anti-Nuke: Unauthorized dangerous permission grant on role ${newRole.name}`,
      Boolean(settings.dry_run)
    );

    await recordAntiNukeIncident(guild.id, 'dangerous_permission_grant', executor.id, {
      roleName: newRole.name,
      roleId: newRole.id,
      punishment: punishmentResult
    });

    sendSecurityAlert(guild, settings, {
      title: 'Dangerous Permission Grant Reverted',
      offender: executor,
      action: punishmentResult,
      description: `Attempted to grant Administrator/Manage permissions to role \`${newRole.name}\`. Permissions were restored.`
    });
  } catch (err) {
    logger.error({ err, guildId: guild.id }, 'Error in handleRoleUpdateEvent');
  }
}

/**
 * Webhook Creation Spam Guard
 */
export async function handleWebhookCreateEvent(channel) {
  if (!channel?.guild) return;
  const guild = channel.guild;

  try {
    const settings = await getAntiNukeSettings(guild.id);
    if (!settings || settings.enabled === false) return;

    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.WebhookCreate, limit: 1 }).catch(() => null);
    const entry = typeof logs?.entries?.first === 'function' ? logs.entries.first() : (logs?.entries?.values?.().next()?.value || null);
    const executor = entry?.executor;
    if (!executor) return;

    if (await isTrusted(guild, executor.id)) return;

    const limit = settings.thresholds?.webhook_spam_limit || 3;
    const windowSecs = settings.thresholds?.webhook_spam_window_seconds || 10;
    const count = trackEvent(guild.id, 'webhook_create', executor.id, windowSecs);

    if (count >= limit) {
      // Delete target webhook if found
      if (entry.target?.delete && !settings.dry_run) {
        await entry.target.delete('Argoni Anti-Nuke: Webhook spam protection').catch(() => {});
      }

      const punishmentResult = await punishOffender(
        guild,
        executor,
        settings.punishment || 'ban',
        `Argoni Anti-Nuke: Webhook creation spam (${count} webhooks in ${windowSecs}s)`,
        Boolean(settings.dry_run)
      );

      sendSecurityAlert(guild, settings, {
        title: 'Webhook Creation Spam Intercepted',
        offender: executor,
        action: punishmentResult,
        description: `Created **${count}** webhooks rapidly in <#${channel.id}>.`
      });
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id }, 'Error in handleWebhookCreateEvent');
  }
}

/**
 * Helper to dispatch incident alerts
 */
async function sendSecurityAlert(guild, settings, { title, offender, action, description }) {
  const logChanId = settings.log_channel_id || settings.alert_channel_id;
  if (!logChanId) return;

  const chan = guild.channels.cache.get(logChanId);
  if (!chan || !chan.isTextBased?.()) return;

  const container = new ContainerBuilder();
  const unixNow = Math.floor(Date.now() / 1000);

  const lines = [
    `## 🛡️ Anti-Nuke: ${title}`,
    `Security protection triggered <t:${unixNow}:R>.`,
    ``,
    `### Event Details`,
    `- **Offender:** <@${offender.id}> (\`${offender.tag || offender.id}\`)`,
    `- **Action Taken:** **${action}**`,
    `- **Details:** ${description}`
  ];

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  await chan.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  }).catch(() => {});
}

export const handleRoleDelete = handleRoleDeleteEvent;
export const handleBotMemberAdd = handleBotAddEvent;
export const handleRolePermissionUpdate = handleRoleUpdateEvent;

export default {
  handleRoleDeleteEvent,
  handleBotAddEvent,
  handleRoleUpdateEvent,
  handleWebhookCreateEvent,
  handleRoleDelete,
  handleBotMemberAdd,
  handleRolePermissionUpdate
};
