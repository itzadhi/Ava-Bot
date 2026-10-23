import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { generateShortId } from '../../utils/id.js';
import { uploadSnapshot } from '../../db/storage.js';
import { createBackupRecord } from '../../db/backups.js';
import { progressCard } from '../../ui/cards.js';
import { logAudit } from '../../db/audit.js';
import { logger } from '../../utils/logger.js';
import { extractMessagePayload } from '../chatlog/engine.js';

/**
 * Creates a server snapshot and saves it to storage and database
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {import('discord.js').User} params.user
 * @param {string} params.name
 * @param {object} [params.options]
 * @param {boolean} [params.isAuto=false]
 * @param {Function} [params.onProgress]
 */
export async function createServerBackup({
  guild,
  user,
  name,
  options = {},
  isAuto = false,
  onProgress = null
}) {
  const backupId = generateShortId(4, 2);
  const opts = {
    roles: options.roles !== false,
    channels: options.channels !== false,
    settings: options.settings !== false,
    emojis: options.emojis !== false,
    stickers: options.stickers !== false,
    bans: options.bans === true,
    webhooks: options.webhooks === true,
    messages: options.messages !== false
  };

  let lastProgressUpdate = 0;
  async function updateProgress(step, done, total) {
    const now = Date.now();
    if (onProgress && (now - lastProgressUpdate > 2000 || done === total)) {
      lastProgressUpdate = now;
      try {
        await onProgress(progressCard({
          title: `Backing up "${guild.name}"`,
          step,
          done,
          total
        }));
      } catch (_) {}
    }
  }

  const snapshot = {
    version: '1.0.0',
    id: backupId,
    name: name || `Backup-${new Date().toISOString().slice(0, 10)}`,
    guildId: guild.id,
    guildName: guild.name,
    createdAt: new Date().toISOString(),
    options: opts,
    settings: {},
    roles: [],
    channels: [],
    emojis: [],
    stickers: [],
    bans: [],
    messages: {}
  };

  let totalSteps = 7;
  let currentStep = 0;

  // 1. Guild Settings
  await updateProgress('Collecting Guild Settings & Server Logo', ++currentStep, totalSteps);
  if (opts.settings) {
    const iconURL = typeof guild.iconURL === 'function' ? guild.iconURL({ extension: 'png', size: 1024 }) : null;
    let iconBase64 = null;
    if (iconURL) {
      try {
        const res = await fetch(iconURL);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          iconBase64 = `data:image/png;base64,${buf.toString('base64')}`;
        }
      } catch (err) {
        logger.warn(`Could not buffer guild icon during backup: ${err.message}`);
      }
    }

    snapshot.settings = {
      name: guild.name,
      description: guild.description,
      iconURL,
      iconBase64,
      bannerURL: typeof guild.bannerURL === 'function' ? guild.bannerURL({ extension: 'png', size: 1024 }) : null,
      splashURL: typeof guild.splashURL === 'function' ? guild.splashURL({ extension: 'png', size: 1024 }) : null,
      verificationLevel: guild.verificationLevel,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      explicitContentFilter: guild.explicitContentFilter,
      afkTimeout: guild.afkTimeout,
      preferredLocale: guild.preferredLocale
    };
  }

  // 2. Roles
  await updateProgress('Collecting Server Roles', ++currentStep, totalSteps);
  if (opts.roles) {
    if (guild.roles.everyone) {
      snapshot.everyonePermissions = guild.roles.everyone.permissions.bitfield.toString();
    }

    const roles = Array.from(guild.roles.cache.values())
      .filter(r => !r.managed && r.id !== guild.id) // Exclude bot managed roles and @everyone
      .sort((a, b) => b.position - a.position);

    for (const role of roles) {
      snapshot.roles.push({
        id: role.id,
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        permissions: role.permissions.bitfield.toString(),
        mentionable: role.mentionable,
        position: role.position,
        iconURL: role.iconURL ? role.iconURL() : null
      });
    }
  }

  // 3. Channels & Overwrites
  await updateProgress('Collecting Categories & Channels', ++currentStep, totalSteps);
  if (opts.channels) {
    const channels = Array.from(guild.channels.cache.values())
      .sort((a, b) => a.rawPosition - b.rawPosition);

    for (const ch of channels) {
      const overwrites = Array.from(ch.permissionOverwrites.cache.values()).map(o => ({
        id: o.id,
        type: o.type, // 0 = role, 1 = member
        allow: o.allow.bitfield.toString(),
        deny: o.deny.bitfield.toString()
      }));

      snapshot.channels.push({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        parentId: ch.parentId,
        position: ch.rawPosition,
        topic: ch.topic || null,
        nsfw: Boolean(ch.nsfw),
        bitrate: ch.bitrate || null,
        userLimit: ch.userLimit || null,
        rateLimitPerUser: ch.rateLimitPerUser || null,
        overwrites
      });
    }
  }

  // 4. Emojis
  await updateProgress('Collecting Emojis', ++currentStep, totalSteps);
  if (opts.emojis) {
    for (const emoji of guild.emojis.cache.values()) {
      snapshot.emojis.push({
        name: emoji.name,
        url: emoji.url
      });
    }
  }

  // 5. Stickers
  await updateProgress('Collecting Stickers', ++currentStep, totalSteps);
  if (opts.stickers) {
    for (const sticker of guild.stickers.cache.values()) {
      snapshot.stickers.push({
        name: sticker.name,
        description: sticker.description,
        tags: sticker.tags,
        url: sticker.url
      });
    }
  }

  // 6. Bans (if requested and bot has BanMembers permission)
  if (opts.bans && guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
    try {
      const bans = await guild.bans.fetch().catch(() => null);
      if (bans) {
        for (const ban of bans.values()) {
          snapshot.bans.push({
            userId: ban.user.id,
            reason: ban.reason
          });
        }
      }
    } catch (_) {}
  }

  // 7. Channel Messages (Chat history preservation)
  await updateProgress('Collecting Recent Channel Messages', ++currentStep, totalSteps);
  if (opts.messages && guild.channels?.cache) {
    const textChannels = Array.from(guild.channels.cache.values())
      .filter(c => typeof c.isTextBased === 'function' && c.isTextBased() && c.type !== ChannelType.GuildAnnouncement && (!c.isVoiceBased || !c.isVoiceBased()));

    for (const ch of textChannels.slice(0, 20)) {
      try {
        if (typeof ch.messages?.fetch === 'function') {
          const fetched = await ch.messages.fetch({ limit: 50 }).catch(() => null);
          if (fetched && fetched.size > 0) {
            snapshot.messages[ch.name] = Array.from(fetched.values())
              .reverse()
              .map(m => extractMessagePayload(m))
              .filter(Boolean);
          }
        }
      } catch (_) {}
    }
  }

  // Upload Snapshot
  await updateProgress('Compressing & Storing Snapshot', ++currentStep, totalSteps);
  const storagePath = `guild_${guild.id}/${backupId}.json.gz`;
  const uploadResult = await uploadSnapshot(storagePath, snapshot, false);

  const record = await createBackupRecord({
    id: backupId,
    guild_id: guild.id,
    owner_id: user.id,
    name: snapshot.name,
    storage_path: storagePath,
    size_bytes: uploadResult.sizeBytes,
    options: opts,
    locked: false,
    is_auto: isAuto
  });

  await logAudit({
    guildId: guild.id,
    userId: user.id,
    action: isAuto ? 'BACKUP_AUTO_CREATED' : 'BACKUP_CREATED',
    details: { backupId, name: snapshot.name, size: uploadResult.sizeBytes }
  });

  logger.info(`Created backup ${backupId} for guild ${guild.name} (${uploadResult.sizeBytes} bytes)`);
  return { id: backupId, record, snapshot };
}
