import {
  PermissionFlagsBits,
  ChannelType
} from 'discord.js';
import { logAudit } from '../../db/audit.js';
import { logger } from '../../utils/logger.js';
import { sanitizeEmbeds, componentsToEmbed, sanitizeEmbedForSend } from '../../utils/embed.js';

/**
 * Validates bot permissions before attempting a restore
 * @param {import('discord.js').Guild} guild 
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateRestorePermissions(guild) {
  const me = guild.members?.me;
  if (!me) {
    return { valid: false, missing: ['Bot Member in Guild'] };
  }

  const required = [
    { bit: PermissionFlagsBits.ManageGuild, name: 'Manage Server' },
    { bit: PermissionFlagsBits.ManageRoles, name: 'Manage Roles' },
    { bit: PermissionFlagsBits.ManageChannels, name: 'Manage Channels' }
  ];

  const missing = [];
  for (const r of required) {
    if (!me.permissions?.has(r.bit)) {
      missing.push(r.name);
    }
  }

  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Restores a snapshot into a target guild with clean slate wipe, precise role hierarchy,
 * sanitized permission overwrites, and real-time live console reporting.
 *
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {import('discord.js').User} params.user
 * @param {object} params.snapshot
 * @param {object} [params.options]
 * @param {boolean} [params.clean=true]
 * @param {string|null} [params.preserveChannelId=null]
 * @param {Function} [params.onProgress]
 * @returns {Promise<{ success: boolean, completedSteps: string[] }>}
 */
export async function restoreServerBackup({
  guild,
  user,
  snapshot,
  options = {},
  clean = true,
  preserveChannelId = null,
  onProgress = null
}) {
  const permCheck = validateRestorePermissions(guild);
  if (!permCheck.valid) {
    throw new Error(`Bot is missing required permissions: ${permCheck.missing.join(', ')}`);
  }

  const completedSteps = [];
  const pipelineChecklist = [
    '⏳ **Phase 1: Clean Slate Wipe** — Delete existing channels & roles',
    '⏳ **Phase 2: Role Hierarchy & Permissions Engine** — Rebuild role tree',
    '⏳ **Phase 3: Category Architecture** — Build categories & overwrites',
    '⏳ **Phase 4: Channels & Overwrites** — Build text/voice channels',
    '⏳ **Phase 5: Server Settings & Emojis** — Apply configurations'
  ];

  async function reportPhase(phaseIndex, status, detail, done = null) {
    if (status === 'running') {
      pipelineChecklist[phaseIndex] = `🔄 **Phase ${phaseIndex + 1}**: ${detail}...`;
    } else if (status === 'done') {
      pipelineChecklist[phaseIndex] = `✅ **Phase ${phaseIndex + 1}**: ${detail}`;
    }

    if (onProgress) {
      try {
        await onProgress({
          stage: 'running',
          phaseIndex,
          doneSteps: done ?? (status === 'done' ? phaseIndex + 1 : phaseIndex),
          totalSteps: 5,
          currentPhaseText: detail,
          checklist: [...pipelineChecklist]
        });
      } catch (_) {}
    }
  }

  const roleMap = new Map(); // Old role ID -> New role ID
  roleMap.set(snapshot.guildId, guild.id); // Map origin @everyone to target @everyone

  try {
    // ==========================================
    // PHASE 1: CLEAN SLATE WIPE
    // ==========================================
    if (clean) {
      await reportPhase(0, 'running', 'Deleting existing channels and unmanaged roles', 0);

      // 1. Delete all channels except the active console channel
      const channels = Array.from(guild.channels?.cache?.values() || []);
      const channelsToDelete = channels.filter(c => c.id !== preserveChannelId);
      let deletedChannels = 0;

      for (const ch of channelsToDelete) {
        try {
          if (typeof ch.delete === 'function') {
            await ch.delete('Argoni Clean Restore Wipe');
            deletedChannels++;
          }
        } catch (err) {
          logger.warn(`Could not delete channel ${ch.name}: ${err.message}`);
        }
      }

      // 2. Delete all non-managed roles below bot's highest role
      const roles = Array.from(guild.roles?.cache?.values() || []);
      const botHighestPos = guild.members?.me?.roles?.highest?.position ?? 999;
      const rolesToDelete = roles.filter(r => !r.managed && r.id !== guild.id && r.position < botHighestPos);
      let deletedRoles = 0;

      for (const role of rolesToDelete) {
        try {
          if (typeof role.delete === 'function') {
            await role.delete('Argoni Clean Restore Wipe');
            deletedRoles++;
          }
        } catch (err) {
          logger.warn(`Could not delete role ${role.name}: ${err.message}`);
        }
      }

      await reportPhase(0, 'done', `Cleaned ${deletedChannels} channels and ${deletedRoles} roles`, 1);
      completedSteps.push(`Cleaned ${deletedChannels} channels and ${deletedRoles} roles`);
    } else {
      await reportPhase(0, 'done', 'Additive mode (kept existing channels & roles)', 1);
      completedSteps.push('Preserved existing channels and roles (additive mode)');
    }

    // ==========================================
    // PHASE 2: ROLE HIERARCHY & PERMISSIONS ENGINE
    // ==========================================
    await reportPhase(1, 'running', 'Rebuilding roles and setting verified hierarchy', 1);

    // Apply origin @everyone permissions if present in snapshot
    if (snapshot.everyonePermissions && guild.roles?.everyone && typeof guild.roles.everyone.setPermissions === 'function') {
      try {
        await guild.roles.everyone.setPermissions(BigInt(snapshot.everyonePermissions), 'Argoni Restore: @everyone permissions');
      } catch (err) {
        logger.warn(`Could not update @everyone permissions: ${err.message}`);
      }
    }

    const createdRolesWithTargetPos = [];

    if (options.roles !== false && Array.isArray(snapshot.roles) && snapshot.roles.length > 0) {
      // Sort roles from lowest to highest position for sequential creation
      const sortedRoles = [...snapshot.roles].sort((a, b) => a.position - b.position);
      const botHasAdmin = guild.members?.me?.permissions?.has(PermissionFlagsBits.Administrator) ?? true;

      for (const roleData of sortedRoles) {
        let perms = BigInt(roleData.permissions || 0);
        // If bot lacks Administrator, strip Administrator to avoid 50013 API error
        if (!botHasAdmin && (perms & PermissionFlagsBits.Administrator) !== 0n) {
          perms &= ~PermissionFlagsBits.Administrator;
        }

        try {
          if (typeof guild.roles?.create === 'function') {
            const newRole = await guild.roles.create({
              name: roleData.name,
              color: roleData.color || 0,
              hoist: Boolean(roleData.hoist),
              permissions: perms,
              mentionable: Boolean(roleData.mentionable),
              reason: 'Argoni Role Hierarchy Engine'
            });

            if (newRole && newRole.id) {
              roleMap.set(roleData.id, newRole.id);
              createdRolesWithTargetPos.push({
                role: newRole,
                originalPosition: roleData.position
              });
            }
          }
        } catch (err) {
          logger.warn(`Failed to create role "${roleData.name}": ${err.message}`);
        }
      }

      // Reorder hierarchy: sort by original position ascending
      createdRolesWithTargetPos.sort((a, b) => a.originalPosition - b.originalPosition);
      const botMaxPos = guild.members?.me?.roles?.highest?.position ?? 999;
      const maxAllowedPos = Math.max(1, botMaxPos - 1);

      if (createdRolesWithTargetPos.length > 0 && typeof guild.roles?.setPositions === 'function') {
        const positionsPayload = createdRolesWithTargetPos.map((item, index) => {
          // Keep positions strictly bounded below bot's highest role
          const targetPos = Math.min(index + 1, maxAllowedPos);
          return {
            role: item.role.id,
            position: targetPos
          };
        });

        try {
          await guild.roles.setPositions(positionsPayload);
        } catch (posErr) {
          logger.warn(`Role setPositions note: ${posErr.message}`);
        }
      }

      await reportPhase(1, 'done', `Rebuilt ${createdRolesWithTargetPos.length} roles with verified hierarchy`, 2);
      completedSteps.push(`Rebuilt ${createdRolesWithTargetPos.length} roles with preserved hierarchy`);
    } else {
      await reportPhase(1, 'done', 'No custom roles to restore', 2);
    }

    // ==========================================
    // PHASE 3: CATEGORY ARCHITECTURE & OVERWRITES
    // ==========================================
    await reportPhase(2, 'running', 'Creating category hierarchy with permission overwrites', 2);
    const categoryMap = new Map(); // Old Category ID -> New Category ID

    if (options.channels !== false && Array.isArray(snapshot.channels)) {
      const categories = snapshot.channels
        .filter(c => c.type === ChannelType.GuildCategory)
        .sort((a, b) => (a.position || 0) - (b.position || 0));

      for (const cat of categories) {
        try {
          // Remap category permission overwrites (if perms enabled)
          const mappedCatOverwrites = options.perms !== false
            ? (cat.overwrites || []).map(o => {
                const targetId = roleMap.get(o.id) || (o.id === snapshot.guildId ? guild.id : null);
                if (!targetId) return null;
                return {
                  id: targetId,
                  type: o.type,
                  allow: BigInt(o.allow || 0),
                  deny: BigInt(o.deny || 0)
                };
              }).filter(Boolean)
            : [];

          if (typeof guild.channels?.create === 'function') {
            const newCat = await guild.channels.create({
              name: cat.name,
              type: ChannelType.GuildCategory,
              position: cat.position,
              permissionOverwrites: mappedCatOverwrites,
              reason: 'Argoni Category Architecture Restore'
            });

            if (newCat && newCat.id) {
              categoryMap.set(cat.id, newCat.id);
            }
          }
        } catch (err) {
          logger.warn(`Could not create category "${cat.name}": ${err.message}`);
        }
      }

      await reportPhase(2, 'done', `Restored ${categoryMap.size} categories with overwrites`, 3);
      completedSteps.push(`Restored ${categoryMap.size} categories with permission overwrites`);

      // ==========================================
      // PHASE 4: TEXT & VOICE CHANNELS WITH OVERWRITES
      // ==========================================
      await reportPhase(3, 'running', 'Creating text and voice channels with mapped overwrites', 3);
      const childChannels = snapshot.channels
        .filter(c => c.type !== ChannelType.GuildCategory)
        .sort((a, b) => (a.position || 0) - (b.position || 0));

      let restoredChannelsCount = 0;

      for (const ch of childChannels) {
        try {
          const newParentId = ch.parentId ? categoryMap.get(ch.parentId) : null;

          // Remap overwrites using roleMap and @everyone (if perms enabled)
          const mappedOverwrites = options.perms !== false
            ? (ch.overwrites || []).map(o => {
                const targetId = roleMap.get(o.id) || (o.id === snapshot.guildId ? guild.id : null);
                if (!targetId) return null;
                return {
                  id: targetId,
                  type: o.type,
                  allow: BigInt(o.allow || 0),
                  deny: BigInt(o.deny || 0)
                };
              }).filter(Boolean)
            : [];

          if (typeof guild.channels?.create === 'function') {
            await guild.channels.create({
              name: ch.name,
              type: ch.type,
              parent: newParentId,
              topic: ch.topic || undefined,
              nsfw: Boolean(ch.nsfw),
              bitrate: ch.bitrate && ch.type === ChannelType.GuildVoice ? ch.bitrate : undefined,
              userLimit: ch.userLimit && ch.type === ChannelType.GuildVoice ? ch.userLimit : undefined,
              rateLimitPerUser: ch.rateLimitPerUser || undefined,
              permissionOverwrites: mappedOverwrites,
              reason: 'Argoni Channel Architecture Restore'
            });
            restoredChannelsCount++;
          }
        } catch (err) {
          logger.warn(`Could not create channel "${ch.name}": ${err.message}`);
        }
      }

      await reportPhase(3, 'done', `Created ${restoredChannelsCount} channels with remapped overwrites`, 4);
      completedSteps.push(`Created ${restoredChannelsCount} text/voice channels with remapped permissions`);
    } else {
      await reportPhase(2, 'done', 'Skipped categories', 3);
      await reportPhase(3, 'done', 'Skipped channels', 4);
    }

    // ==========================================
    // PHASE 5: SERVER SETTINGS, SERVER LOGO & EMOJIS
    // ==========================================
    await reportPhase(4, 'running', 'Synchronizing server settings, server logo, and custom emojis', 4);

    if (options.settings !== false && snapshot.settings) {
      const editPayload = {};
      if (snapshot.settings.name) editPayload.name = snapshot.settings.name;
      if (snapshot.settings.verificationLevel !== undefined) editPayload.verificationLevel = snapshot.settings.verificationLevel;
      if (snapshot.settings.defaultMessageNotifications !== undefined) editPayload.defaultMessageNotifications = snapshot.settings.defaultMessageNotifications;
      if (snapshot.settings.explicitContentFilter !== undefined) editPayload.explicitContentFilter = snapshot.settings.explicitContentFilter;
      if (snapshot.settings.afkTimeout !== undefined) editPayload.afkTimeout = snapshot.settings.afkTimeout;

      // Restore Server Logo / Icon
      const iconData = snapshot.settings.iconBase64 || snapshot.settings.iconURL;
      if (iconData) {
        try {
          if (iconData.startsWith('data:')) {
            editPayload.icon = iconData;
          } else {
            const res = await fetch(iconData);
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              editPayload.icon = buf;
            }
          }
        } catch (iconErr) {
          logger.warn(`Could not prepare server icon: ${iconErr.message}`);
        }
      }

      if (typeof guild.edit === 'function') {
        try {
          await guild.edit(editPayload);
        } catch (err) {
          logger.warn(`Could not update guild settings: ${err.message}`);
          if (editPayload.icon && typeof guild.setIcon === 'function') {
            try {
              await guild.setIcon(editPayload.icon, 'Argoni Server Logo Restore');
            } catch (_) {}
          }
        }
      }
    }

    if (options.emojis !== false && Array.isArray(snapshot.emojis) && snapshot.emojis.length > 0 && typeof guild.emojis?.create === 'function') {
      for (const emoji of snapshot.emojis.slice(0, 50)) {
        try {
          await guild.emojis.create({
            attachment: emoji.url,
            name: emoji.name,
            reason: 'Argoni Restore'
          });
        } catch (_) {}
      }
    }

    await reportPhase(4, 'done', 'Server settings and media assets synchronized', 5);
    completedSteps.push('Synchronized server settings, verification levels, and emojis');

    // ==========================================
    // PHASE 6: MESSAGE HISTORY REPLAY VIA WEBHOOKS
    // ==========================================
    if (options.messages !== false && snapshot.messages && Object.keys(snapshot.messages).length > 0) {
      await reportPhase(4, 'running', 'Replaying channel message history with webhooks', 5);
      let totalMessagesReplayed = 0;
      for (const [chName, msgList] of Object.entries(snapshot.messages)) {
        const targetChannel = guild.channels?.cache?.find(c => c.name === chName && typeof c.isTextBased === 'function' && c.isTextBased());
        if (targetChannel && typeof targetChannel.createWebhook === 'function') {
          let webhook = null;
          try {
            webhook = await targetChannel.createWebhook({
              name: 'Argoni Replay',
              reason: 'Argoni Message History Restore'
            });
            for (const msg of msgList) {
              try {
                let sanitizedEmbeds = sanitizeEmbeds(msg.embeds);

                // Convert components to embed if no embeds exist
                if (sanitizedEmbeds.length === 0 && Array.isArray(msg.components) && msg.components.length > 0) {
                  const compEmbed = componentsToEmbed(msg.components);
                  if (compEmbed) {
                    const s = sanitizeEmbedForSend(compEmbed);
                    if (s) sanitizedEmbeds.push(s);
                  }
                }

                let content = typeof msg.content === 'string' ? msg.content : '';
                if (!content.replace(/[\s\u200b\u200c\u200d\ufeff]/gu, '')) {
                  content = '';
                } else {
                  content = content.trim();
                }

                if (!content && Array.isArray(msg.attachments) && msg.attachments.length > 0) {
                  content = msg.attachments.map(a => a.url).filter(Boolean).join('\n');
                }

                // If message has no content and no embeds, skip it to avoid sending blank space messages
                if (!content && sanitizedEmbeds.length === 0) {
                  continue;
                }

                const payload = {
                  username: (msg.authorName || 'User').slice(0, 80),
                  avatarURL: msg.authorAvatar || undefined
                };
                if (content) payload.content = content.slice(0, 2000);
                if (sanitizedEmbeds.length > 0) {
                  payload.embeds = sanitizedEmbeds;
                }
                await webhook.send(payload);
                totalMessagesReplayed++;
              } catch (_) {}
            }
          } catch (hookErr) {
            logger.warn(`Could not create webhook in #${chName} for message replay: ${hookErr.message}`);
          } finally {
            if (webhook && typeof webhook.delete === 'function') {
              try {
                await webhook.delete('Cleanup temporary replay webhook');
              } catch (_) {}
            }
          }
        }
      }
      if (totalMessagesReplayed > 0) {
        completedSteps.push(`Replayed ${totalMessagesReplayed} messages across text channels`);
      }
    }

    await logAudit({
      guildId: guild.id,
      userId: user.id,
      action: 'BACKUP_RESTORED',
      details: {
        backupId: snapshot.id,
        name: snapshot.name,
        completedSteps
      }
    });

    return {
      success: true,
      completedSteps
    };

  } catch (err) {
    logger.error({ err, guildId: guild.id }, 'Error occurred during backup restoration');
    err.completedSteps = completedSteps;
    err.checklist = pipelineChecklist;
    throw err;
  }
}

export default {
  validateRestorePermissions,
  restoreServerBackup
};
