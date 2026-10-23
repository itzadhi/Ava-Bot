import { ActionRowBuilder, MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { metrics } from '../../core/metrics.js';
import { card, errorCard } from '../../ui/cards.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import { registerComponent } from '../../core/interactions/registry.js';
import { safeRespond } from '../../core/interactions/safeRespond.js';

/**
 * Builds the performance diagnostic Components V2 card
 * @param {import('discord.js').Client} client
 * @param {boolean} [ephemeral=true]
 */
export function buildPerfCard(client, ephemeral = true) {
  const snap = metrics.getSnapshot(client);

  const body = [
    `### ⚡ Gateway & Execution Latencies`,
    `- **Websocket Ping**: \`${snap.wsPing}\``,
    `- **Time to Acknowledge**: Avg \`${snap.ackTime.avg}\` • p95 \`${snap.ackTime.p95}\``,
    `- **Handler Duration**: Avg \`${snap.handlerTime.avg}\` • p95 \`${snap.handlerTime.p95}\``,
    `- **Event Loop Lag**: p50 \`${snap.eventLoopLag.p50}\` • p95 \`${snap.eventLoopLag.p95}\` (Max: \`${snap.eventLoopLag.max}\`)`,
    '',
    `### 🗄️ Database & Cache Performance`,
    `- **Supabase Query Latency**: Avg \`${snap.dbQueries.avg}\``,
    `- **Slowest Query**: \`${snap.dbQueries.slowest}\``,
    `- **Guild Settings Cache**: \`${snap.cacheSizes.guildSettings}\` cached guilds`,
    `- **Active Memory Sessions**: \`${snap.cacheSizes.activeSessions}\` panels/wizards`,
    '',
    `### 🖥️ System Footprint & Throughput`,
    `- **RSS Memory**: \`${snap.memory.rss}\` (Heap: \`${snap.memory.heapUsed}\` / \`${snap.memory.heapTotal}\`)`,
    `- **Guild Count**: \`${snap.guilds}\` servers`,
    `- **Uptime**: \`${snap.uptime}\``,
    `- **Interaction Rate**: \`${snap.interactionsPerMin}\` req/min`,
    '',
    `### 🛡️ Discord Error Dispatches (Last 1 Hour)`,
    `- \`10062\` Unknown interaction: **${snap.errorsLastHour.unknownInteraction10062}**`,
    `- \`40060\` Already acknowledged: **${snap.errorsLastHour.alreadyAcknowledged40060}**`,
    `- \`50027\` Expired webhook token: **${snap.errorsLastHour.invalidWebhook50027}**`,
    `- \`429\` Gateway rate limits: **${snap.errorsLastHour.rateLimit429}**`,
    `- Other runtime errors: **${snap.errorsLastHour.other}**`
  ].join('\n');

  const refreshBtn = greyButton({
    id: 'perf:refresh',
    label: 'Refresh',
    emoji: '⟳'
  });

  const row = new ActionRowBuilder().addComponents(refreshBtn);

  return card({
    title: '⚡ System Performance Diagnostics',
    subtitle: 'Real-time gateway telemetry and interaction health monitoring',
    body,
    subtext: 'Argoni Core Telemetry • Components V2',
    rows: [row],
    ephemeral
  });
}

// Register persistent refresh handler
registerComponent('perf:refresh', async (interaction) => {
  if (!config.OWNER_IDS.includes(interaction.user.id)) {
    return safeRespond(interaction, errorCard({
      title: 'Access Restricted',
      reason: 'Only configured bot owners can inspect performance diagnostics.',
      ephemeral: true
    }), { ephemeral: true });
  }

  const payload = buildPerfCard(interaction.client, true);
  return safeRespond(interaction, payload);
}, { authorOnly: false });

export default {
  name: 'perf',
  aliases: ['performance', 'telemetry', 'diag'],
  description: 'Owner-only system telemetry, interaction latency, and gateway health',
  category: 'owner',
  cooldown: 2,
  instant: true,
  ephemeral: true,
  args: [],
  async execute(ctx) {
    if (!config.OWNER_IDS.includes(ctx.user.id)) {
      return ctx.reply(errorCard({
        title: 'Access Restricted',
        reason: 'This diagnostic command is restricted to bot administrators.',
        fix: 'Contact the bot owner if you believe this is in error.',
        ephemeral: true
      }));
    }

    const payload = buildPerfCard(ctx.client, true);
    return ctx.reply(payload);
  }
};
