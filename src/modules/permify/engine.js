import {
  PermissionFlagsBits,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  MessageFlags
} from 'discord.js';
import { saveSnapshot, getLatestSnapshot, saveGuildRoles } from '../../db/permify.js';
import { getGuildSettings, updateGuildSettings } from '../../db/guilds.js';
import { getTicketSettings, updateTicketSettings, getTicketCategories } from '../../db/tickets.js';
import { dispatchLog, buildLogCard } from '../logs/engine.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import * as format from '../../utils/ui/format.js';
import { logger } from '../../utils/logger.js';
import { endSession } from './session.js';

// Rate limit helper: wait ms milliseconds
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Core Bot Permissions on all channels to prevent lockout
const BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak
];

// Member normal permissions
const MEMBER_NORMAL_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.UseExternalEmojis,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.Stream
];

// Staff normal permissions
const STAFF_NORMAL_ALLOW = [
  ...MEMBER_NORMAL_ALLOW,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.MoveMembers
];

// Owner normal permissions
const OWNER_NORMAL_ALLOW = [
  ...STAFF_NORMAL_ALLOW,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks
];

// Staff-Only-Speak permissions:
// Members can view/read only, buttons & selects work; speaking & chatting denied
const MEMBER_STAFF_ONLY_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory
];
const MEMBER_STAFF_ONLY_DENY = [
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.Stream
];

// Staff in staff-only channels can speak and view, but NO ManageMessages here
const STAFF_STAFF_ONLY_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak
];

// Owner in staff-only channels retains full management including ManageMessages
const OWNER_STAFF_ONLY_ALLOW = [
  ...STAFF_STAFF_ONLY_ALLOW,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks
];

/**
 * Builds live progress V2 card payload
 */
function buildProgressCard({ current, total, channelName, startTime }) {
  const container = new ContainerBuilder();
  const ratio = total > 0 ? current / total : 0;
  const percent = Math.round(ratio * 100);
  const filled = Math.round(ratio * 10);
  const empty = 10 - filled;
  const bar = `${'▰'.repeat(filled)}${'▱'.repeat(empty)} ${percent}%`;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ⚙️ Permify In Progress...\n` +
      format.subtext('Sequentially clearing and rebuilding server permission architecture.')
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  const lines = [
    `• **Progress:** \`${bar}\` (\`${current}/${total}\` channels)`,
    `• **Current Channel:** ${channelName ? `#${channelName}` : 'Initializing...'}`,
    `• **Elapsed:** ${format.time(startTime, 'R')}`,
    `• **Status:** Rebuilding permission overwrites with rate-limit protection`
  ].join('\n');

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Executes the complete permission rebuild process
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} session
 */
export async function executePermifyApply(interaction, session) {
  const guild = interaction.guild;
  const startTime = new Date();
  const {
    guildId,
    userId,
    staffRoleIds = [],
    memberRoleIds = [],
    ownerRoleIds = [],
    staffCategoryIds = [],
    staffChannelIds = [],
    hideEveryone = true,
    connectAutorole = true,
    backfillMembers = false
  } = session;

  const staffCategorySet = new Set(staffCategoryIds);
  const staffChannelSet = new Set(staffChannelIds);

  // 1. Gather all channels & categories in scope
  const allChannels = Array.from(
    guild.channels.cache
      .filter(c => [
        ChannelType.GuildCategory,
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildVoice,
        ChannelType.GuildStageVoice,
        ChannelType.GuildForum
      ].includes(c.type))
      .values()
  );

  // Identify special log & ticket channels
  const [guildSettings, ticketSettings, ticketCategories] = await Promise.all([
    getGuildSettings(guild.id).catch(() => ({})),
    getTicketSettings(guild.id).catch(() => null),
    getTicketCategories(guild.id).catch(() => [])
  ]);

  const logChannelIds = new Set([
    guildSettings?.log_channel_id,
    guildSettings?.automod_log_channel_id,
    ticketSettings?.log_channel_id,
    ticketSettings?.transcript_channel_id
  ].filter(Boolean));

  const ticketCategoryIds = new Set([
    ticketSettings?.channel_category_id,
    ...ticketCategories.map(tc => tc.channel_category_id)
  ].filter(Boolean));

  // 2. Snapshot current overwrites & previous settings FIRST
  const snapshotData = {
    guild_id: guild.id,
    created_at: startTime.toISOString(),
    previousSettings: {
      autorole_member_role_ids: guildSettings?.autorole_member_role_ids || [],
      autorole_member_role_id: guildSettings?.autorole_member_role_id || null,
      ticket_support_role_ids: ticketSettings?.support_role_ids || [],
      ticket_admin_role_ids: ticketSettings?.admin_role_ids || [],
      ticket_allowed_role_ids: ticketSettings?.allowed_role_ids || []
    },
    channels: allChannels.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      parentId: c.parentId,
      overwrites: c.permissionOverwrites.cache.map(ow => ({
        id: ow.id,
        type: ow.type,
        allow: ow.allow.bitfield.toString(),
        deny: ow.deny.bitfield.toString()
      }))
    }))
  };

  await saveSnapshot(guild.id, userId, snapshotData);

  // Separate categories and channels (categories first so children can sync)
  const categories = allChannels.filter(c => c.type === ChannelType.GuildCategory);
  const regularChannels = allChannels.filter(c => c.type !== ChannelType.GuildCategory);
  const orderedList = [...categories, ...regularChannels];
  const total = orderedList.length;

  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const failureLog = [];

  const botMember = guild.members.me;
  const botId = botMember?.id;
  const botRoleId = botMember?.roles?.botRole?.id || null;

  // 3. Process each channel/category sequentially
  for (let i = 0; i < total; i++) {
    const chan = orderedList[i];

    // Live progress update every 5 channels or at start
    if (i % 5 === 0 || i === total - 1) {
      const progressPayload = buildProgressCard({
        current: i + 1,
        total,
        channelName: chan.name,
        startTime
      });
      await interaction.editReply(progressPayload).catch(() => {});
    }

    try {
      // Step A: Reset existing overwrites on this channel
      await resetChannelOverwrites(chan);

      // Step B: Build new overwrites array
      const newOverwrites = [];

      // 1. Bot overwrite first (prevent lockout)
      const botTargetId = botRoleId || botId;
      if (botTargetId) {
        newOverwrites.push({
          id: botTargetId,
          type: botRoleId ? 0 : 1, // 0 = role, 1 = member
          allow: BOT_PERMISSIONS
        });
      }

      const isLogChannel = logChannelIds.has(chan.id);
      const isTicketCategory = ticketCategoryIds.has(chan.id);
      const isStaffOnlyCategory = chan.type === ChannelType.GuildCategory && staffCategorySet.has(chan.id);
      const isStaffOnlyChannel = staffChannelSet.has(chan.id) || (chan.parentId && staffCategorySet.has(chan.parentId));

      // 2. Log / Vault channel rule
      if (isLogChannel) {
        newOverwrites.push({
          id: guild.id, // @everyone
          type: 0,
          deny: [PermissionFlagsBits.ViewChannel]
        });
        for (const roleId of memberRoleIds) {
          newOverwrites.push({
            id: roleId,
            type: 0,
            deny: [PermissionFlagsBits.ViewChannel]
          });
        }
        for (const roleId of staffRoleIds) {
          newOverwrites.push({
            id: roleId,
            type: 0,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages]
          });
        }
        for (const roleId of ownerRoleIds) {
          newOverwrites.push({
            id: roleId,
            type: 0,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory]
          });
        }
      }
      // 3. Ticket Category rule
      else if (isTicketCategory) {
        newOverwrites.push({
          id: guild.id,
          type: 0,
          deny: [PermissionFlagsBits.ViewChannel]
        });
        for (const roleId of staffRoleIds) {
          newOverwrites.push({
            id: roleId,
            type: 0,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageMessages
            ]
          });
        }
        for (const roleId of ownerRoleIds) {
          newOverwrites.push({
            id: roleId,
            type: 0,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageMessages
            ]
          });
        }
      }
      // 4. Staff-Only-Speak Categories or Channels
      else if (isStaffOnlyCategory || isStaffOnlyChannel) {
        if (hideEveryone) {
          newOverwrites.push({
            id: guild.id,
            type: 0,
            deny: [PermissionFlagsBits.ViewChannel]
          });
        }
        for (const roleId of memberRoleIds) {
          newOverwrites.push({
            id: roleId,
            type: 0,
            allow: MEMBER_STAFF_ONLY_ALLOW,
            deny: MEMBER_STAFF_ONLY_DENY
          });
        }
        for (const roleId of staffRoleIds) {
          newOverwrites.push({
            id: roleId,
            type: 0,
            allow: STAFF_STAFF_ONLY_ALLOW
          });
        }
        for (const roleId of ownerRoleIds) {
          newOverwrites.push({
            id: roleId,
            type: 0,
            allow: OWNER_STAFF_ONLY_ALLOW
          });
        }
      }
      // 5. Normal Channels
      else {
        if (hideEveryone) {
          newOverwrites.push({
            id: guild.id,
            type: 0,
            deny: [PermissionFlagsBits.ViewChannel]
          });
        }
        for (const roleId of memberRoleIds) {
          newOverwrites.push({
            id: roleId,
            type: 0,
            allow: MEMBER_NORMAL_ALLOW
          });
        }
        for (const roleId of staffRoleIds) {
          newOverwrites.push({
            id: roleId,
            type: 0,
            allow: STAFF_NORMAL_ALLOW
          });
        }
        for (const roleId of ownerRoleIds) {
          newOverwrites.push({
            id: roleId,
            type: 0,
            allow: OWNER_NORMAL_ALLOW
          });
        }
      }

      // Step C: Apply new overwrites to channel
      await chan.permissionOverwrites.set(newOverwrites);

      // If category, sync child channels where appropriate
      if (chan.type === ChannelType.GuildCategory) {
        const children = chan.children?.cache || [];
        for (const child of children.values()) {
          // If child is NOT an individually customized channel, lock to category
          if (!staffChannelSet.has(child.id)) {
            await child.lockPermissions().catch(() => {});
          }
        }
      }

      updatedCount++;
    } catch (err) {
      failedCount++;
      failureLog.push({ channel: chan.name, id: chan.id, reason: err.message });
      logger.warn({ err, channelId: chan.id }, 'Channel overwrite application failed');
    }

    // Rate-limit pause
    await sleep(200);
  }

  // 4. Save Role Groupings to Guild Roles Table & Settings
  await saveGuildRoles(guild.id, {
    staff: staffRoleIds,
    member: memberRoleIds,
    owner: ownerRoleIds
  });

  // 5. Autorole Integration
  if (connectAutorole && memberRoleIds.length > 0) {
    try {
      await updateGuildSettings(guild.id, {
        autorole_member_role_ids: memberRoleIds,
        autorole_member_role_id: memberRoleIds[0] || null,
        autorole_enabled: true
      });
    } catch (err) {
      logger.warn({ err }, 'Error syncing member roles to autorole');
    }
  }

  // 6. Optional Member Backfill
  let backfilledCount = 0;
  if (backfillMembers && memberRoleIds.length > 0) {
    try {
      const fetched = await guild.members.fetch();
      const unroled = fetched.filter(m => !m.user.bot && m.roles.cache.size <= 1);
      for (const m of unroled.values()) {
        await m.roles.add(memberRoleIds, 'Permify: Backfill unroled members').catch(() => {});
        backfilledCount++;
        await sleep(100);
      }
    } catch (err) {
      logger.warn({ err }, 'Error during unroled member backfill');
    }
  }

  // 7. Ticket Settings Integration
  if (ticketSettings) {
    try {
      await updateTicketSettings(guild.id, {
        support_role_ids: staffRoleIds,
        admin_role_ids: ownerRoleIds,
        allowed_role_ids: memberRoleIds
      });
    } catch (err) {
      logger.warn({ err }, 'Error updating ticket settings with permify roles');
    }
  }

  // 8. End Session Lock
  endSession(guild.id);

  // 9. Dispatch Audit Log
  const totalDuration = ((Date.now() - startTime.getTime()) / 1000).toFixed(1);
  const logCard = buildLogCard({
    eventName: 'Server Permissions Rebuilt',
    emoji: '🔒',
    category: 'roles',
    user: interaction.user,
    targetId: guild.id,
    details: [
      format.kvLine('Executed By', format.userMention(userId)),
      format.kvLine('Channels Updated', `\`${updatedCount}\``),
      format.kvLine('Channels Failed', `\`${failedCount}\``),
      format.kvLine('Staff Roles', staffRoleIds.map(id => `<@&${id}>`).join(' ') || 'None'),
      format.kvLine('Member Roles', memberRoleIds.map(id => `<@&${id}>`).join(' ') || 'None'),
      format.kvLine('Owner Roles', ownerRoleIds.map(id => `<@&${id}>`).join(' ') || 'None'),
      format.kvLine('Duration', `\`${totalDuration}s\``)
    ]
  });
  await dispatchLog(guild, { category: 'roles', cardPayload: logCard }).catch(() => {});

  // 10. Render Final Completion Report Card
  const reportPayload = buildReportCard({
    guildId: guild.id,
    userId,
    updatedCount,
    skippedCount,
    failedCount,
    failureLog,
    duration: totalDuration,
    timestamp: startTime,
    backfilledCount
  });

  await interaction.editReply(reportPayload).catch(() => {});
}

/**
 * Resets existing overwrites on a channel safely
 */
async function resetChannelOverwrites(channel) {
  if (!channel.permissionOverwrites?.cache) return;
  const existing = Array.from(channel.permissionOverwrites.cache.values());
  for (const ow of existing) {
    await ow.delete().catch(() => {});
  }
}

/**
 * Builds the final report Components V2 container
 */
function buildReportCard({
  guildId,
  userId,
  updatedCount,
  skippedCount,
  failedCount,
  failureLog,
  duration,
  timestamp,
  backfilledCount
}) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 🔒 Permify Complete\n` +
      format.subtext(`Server permissions rebuilt successfully in ${duration}s.`)
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  const summary = [
    `• **Updated Channels:** \`${updatedCount}\``,
    `• **Skipped Channels:** \`${skippedCount}\``,
    `• **Failed Channels:** \`${failedCount}\``,
    `• **Unroled Members Backfilled:** \`${backfilledCount}\``,
    `• **Completed At:** ${format.time(new Date(), 'F')}`,
    `• **Snapshot ID:** \`#${timestamp.getTime()}\` (Saved for instant rollback)`
  ].join('\n');

  let body = summary;
  if (failureLog.length > 0) {
    const errorLines = failureLog.slice(0, 5).map(f => `• #${f.channel}: \`${f.reason}\``).join('\n');
    body += `\n\n### ⚠️ Channel Notice\n${errorLines}`;
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

  // Grey Action Buttons: Undo Last Run & Close
  const actionRow = new ActionRowBuilder().addComponents(
    greyButton({
      id: `permify:open_undo:${guildId}:${userId}`,
      label: 'Undo Last Run',
      emoji: '🔄'
    }),
    greyButton({
      id: `permify:close:${guildId}:${userId}`,
      label: 'Close Report',
      emoji: '✕'
    })
  );

  container.addActionRowComponents(actionRow);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Restores channel overwrites and settings from the latest snapshot
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').Guild} guild
 */
export async function executePermifyUndo(interaction, guild) {
  const startTime = new Date();
  const snapshot = await getLatestSnapshot(guild.id);
  if (!snapshot || !snapshot.data || !Array.isArray(snapshot.data.channels)) {
    return interaction.followUp({
      content: '❌ No permission snapshot available to restore.',
      flags: MessageFlags.Ephemeral
    });
  }

  const { channels, previousSettings } = snapshot.data;
  const total = channels.length;

  // Live progress
  for (let i = 0; i < total; i++) {
    const item = channels[i];
    const chan = guild.channels.cache.get(item.id);

    if (i % 5 === 0 || i === total - 1) {
      const progressPayload = buildProgressCard({
        current: i + 1,
        total,
        channelName: item.name,
        startTime
      });
      await interaction.editReply(progressPayload).catch(() => {});
    }

    if (chan) {
      try {
        await resetChannelOverwrites(chan);
        const restored = (item.overwrites || []).map(ow => ({
          id: ow.id,
          type: ow.type,
          allow: BigInt(ow.allow || '0'),
          deny: BigInt(ow.deny || '0')
        })).filter(ow => guild.roles.cache.has(ow.id) || guild.members.cache.has(ow.id) || ow.id === guild.id);

        if (restored.length > 0) {
          await chan.permissionOverwrites.set(restored);
        }
      } catch (err) {
        logger.warn({ err, channelId: chan.id }, 'Error restoring channel overwrite');
      }
    }

    await sleep(150);
  }

  // Restore previous settings if present
  if (previousSettings) {
    try {
      if (previousSettings.autorole_member_role_ids) {
        await updateGuildSettings(guild.id, {
          autorole_member_role_ids: previousSettings.autorole_member_role_ids,
          autorole_member_role_id: previousSettings.autorole_member_role_id
        });
      }
      if (previousSettings.ticket_support_role_ids) {
        await updateTicketSettings(guild.id, {
          support_role_ids: previousSettings.ticket_support_role_ids,
          admin_role_ids: previousSettings.ticket_admin_role_ids,
          allowed_role_ids: previousSettings.ticket_allowed_role_ids
        });
      }
    } catch (_) {}
  }

  const duration = ((Date.now() - startTime.getTime()) / 1000).toFixed(1);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 🔄 Permify Rollback Complete\n` +
      format.blockQuote(`Restored \`${total}\` channels and previous server settings to state prior to Permify run.`) + '\n' +
      format.subtext(`Restored by <@${interaction.user.id}> in ${duration}s.`)
    )
  );

  const closeRow = new ActionRowBuilder().addComponents(
    greyButton({
      id: `permify:close:${guild.id}:${interaction.user.id}`,
      label: 'Close',
      emoji: '✕'
    })
  );
  container.addActionRowComponents(closeRow);

  await interaction.editReply({
    components: [container],
    flags: MessageFlags.IsComponentsV2
  }).catch(() => {});
}

export default {
  executePermifyApply,
  executePermifyUndo
};
