import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} from 'discord.js';
import { card } from '../../ui/cards.js';
import { THEME } from '../../ui/theme.js';
import { config } from '../../config.js';
import { generateShortId } from '../../utils/id.js';

import overviewTab from './tabs/overview.js';
import guildsTab from './tabs/guilds.js';
import blacklistTab from './tabs/blacklist.js';
import premiumTab from './tabs/premium.js';
import backupsTab from './tabs/backups.js';
import broadcastTab from './tabs/broadcast.js';
import presenceTab from './tabs/presence.js';
import commandsTab from './tabs/commands.js';
import logsTab from './tabs/logs.js';
import auditTab from './tabs/audit.js';

const TABS = {
  overview: overviewTab,
  guilds: guildsTab,
  blacklist: blacklistTab,
  premium: premiumTab,
  backups: backupsTab,
  broadcast: broadcastTab,
  presence: presenceTab,
  commands: commandsTab,
  logs: logsTab,
  audit: auditTab
};

// Panel state map: sessionId -> session object
const sessions = new Map();

/**
 * Creates and renders the owner control panel
 * @param {import('../../structures/CommandContext.js').CommandContext} ctx 
 */
export async function openOwnerPanel(ctx) {
  if (!config.OWNER_IDS.includes(ctx.user.id)) {
    if (ctx.isSlash) {
      return ctx.reply({
        flags: MessageFlags.Ephemeral,
        content: 'Access denied: Owner privileges required.'
      });
    }
    return; // Ignore prefix silently for non-owners
  }

  const sessionId = generateShortId(4, 2);
  const session = {
    sessionId,
    ownerId: ctx.user.id,
    currentTab: 'overview',
    statusLine: null,
    lastActive: Date.now(),
    timeoutTimer: null
  };

  sessions.set(sessionId, session);

  // Auto-expire session after 5 minutes of inactivity
  session.timeoutTimer = setTimeout(() => {
    sessions.delete(sessionId);
  }, 5 * 60 * 1000);

  const payload = await renderPanelMessage(session, ctx.client);
  const msg = await ctx.reply(payload);

  if (msg && !ctx.isSlash) {
    session.messageId = msg.id;
  }
}

/**
 * Renders the Discord Components V2 payload for the panel
 */
async function renderPanelMessage(session, client) {
  const tab = TABS[session.currentTab] || TABS.overview;
  const rendered = await tab.render({ client, state: session });

  const uptimeSec = Math.floor(process.uptime());
  const hours = Math.floor(uptimeSec / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  const ping = client.ws.ping >= 0 ? `${client.ws.ping}ms` : '0ms';

  let sub = `Tab: ${tab.label} • Uptime: ${hours}h ${mins}m • Ping: ${ping}`;
  if (session.statusLine) {
    sub = `[Status: ${session.statusLine}]\n${sub}`;
    session.statusLine = null; // Clear after one render
  }

  // Row 1: Tab Select Menu
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`owner:nav:tab:${session.sessionId}`)
    .setPlaceholder(`Switch tab (Current: ${tab.label})...`)
    .addOptions(
      Object.values(TABS).map(t =>
        new StringSelectMenuOptionBuilder()
          .setLabel(t.label)
          .setValue(t.id)
          .setDefault(t.id === session.currentTab)
      )
    );

  const row1 = new ActionRowBuilder().addComponents(selectMenu);

  // Row 2: Contextual buttons from current tab
  const tabButtons = tab.buttons ? tab.buttons({ client, state: session }) : [];
  const rows = [row1];
  if (tabButtons.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(tabButtons.slice(0, 4)));
  }

  return card({
    title: 'Control Panel',
    glyph: 'ℹ',
    subtitle: sub,
    body: rendered.body,
    subtext: rendered.subtext || 'Argoni System Administration',
    color: THEME.colors.neutral,
    rows
  });
}

/**
 * Unified router for all owner panel interactions (buttons, select menus, modals)
 * @param {import('discord.js').Interaction} interaction 
 */
export async function handleOwnerInteraction(interaction) {
  const customId = interaction.customId || '';
  const parts = customId.split(':');
  // Format: owner:<tab>:<action>:<sessionId>
  const tabId = parts[1];
  const action = parts[2];
  const sessionId = parts[3];

  // Re-verify owner security check on EVERY interaction
  if (!config.OWNER_IDS.includes(interaction.user.id)) {
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: 'Unauthorized: Owner credentials required.'
    });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: 'This control panel session has expired. Reopen using /owner or ao!owner.'
    });
  }

  // Reset 5-minute inactivity timer
  clearTimeout(session.timeoutTimer);
  session.timeoutTimer = setTimeout(() => {
    sessions.delete(sessionId);
  }, 5 * 60 * 1000);

  // 1. Tab Navigation
  if (tabId === 'nav' && action === 'tab' && interaction.isStringSelectMenu()) {
    const chosen = interaction.values[0];
    if (TABS[chosen]) {
      session.currentTab = chosen;
    }
    const payload = await renderPanelMessage(session, interaction.client);
    await interaction.update(payload);
    return;
  }

  const tab = TABS[tabId];
  if (!tab) return;

  // 2. Modal Submissions
  if (interaction.isModalSubmit()) {
    if (tab.handleModalSubmit) {
      const res = await tab.handleModalSubmit({ action, interaction, state: session, client: interaction.client });
      if (res?.status) {
        session.statusLine = res.status;
      }
      if (!res?.modalReplied) {
        const payload = await renderPanelMessage(session, interaction.client);
        await interaction.update(payload).catch(async () => {
          // If modal cannot update message directly
          await interaction.deferUpdate().catch(() => {});
        });
      }
    }
    return;
  }

  // 3. Button Actions
  if (interaction.isButton()) {
    if (tab.handleAction) {
      const res = await tab.handleAction({ action, interaction, state: session, client: interaction.client });
      if (res?.modalShown) {
        // Modal was opened, don't update component message yet
        return;
      }
      if (res?.status) {
        session.statusLine = res.status;
      }
      const payload = await renderPanelMessage(session, interaction.client);
      await interaction.update(payload);
    }
  }
}
