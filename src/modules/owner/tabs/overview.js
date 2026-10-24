import { ButtonBuilder, ButtonStyle } from 'discord.js';
import { formatBytes } from '../../../utils/time.js';
import { isMaintenanceActive, setBotState } from '../../../db/botState.js';
import { getErrorCountLastHour } from '../../../db/errors.js';
import { db } from '../../../db/client.js';
import { queue } from '../../../services/queue.js';
import { logAudit } from '../../../db/audit.js';

export const overviewTab = {
  id: 'overview',
  label: 'Overview',
  async render({ client, state }) {
    const mem = process.memoryUsage();
    const uptimeSec = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSec / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);

    const guildCount = client.guilds.cache.size;
    const userCount = Array.from(client.guilds.cache.values()).reduce((acc, g) => acc + (g.memberCount || 0), 0);
    const shardCount = client.ws.shards.size;
    const wsPing = client.ws.ping;

    const dbStart = Date.now();
    await db.from('bot_state').select('key').limit(1);
    const dbPing = Date.now() - dbStart;

    const errorCount = await getErrorCountLastHour();
    const maintenance = isMaintenanceActive();

    // Count stored backups & active syncs
    const { data: backups } = await db.from('backups').select('id');
    const { data: syncs } = await db.from('syncs').select('id').eq('enabled', true);

    const lines = [
      `**Guilds**: ${guildCount.toLocaleString()} • **Users**: ${userCount.toLocaleString()} • **Shards**: ${shardCount}`,
      `**Memory (RSS)**: ${formatBytes(mem.rss)} (Heap: ${formatBytes(mem.heapUsed)})`,
      `**Uptime**: ${hours}h ${mins}m • **WS Ping**: ${wsPing}ms • **DB Latency**: ${dbPing}ms`,
      `**Queue Pending**: ${queue.size} active • **Errors (Last 1h)**: ${errorCount}`,
      `**Stored Backups**: ${backups?.length || 0} • **Active Syncs**: ${syncs?.length || 0}`,
      `**Maintenance Mode**: ${maintenance ? '🔴 Active' : '🟢 Operational'}`
    ];

    return {
      body: lines.join('\n')
    };
  },

  buttons({ state }) {
    const maintenance = isMaintenanceActive();
    return [
      new ButtonBuilder()
        .setCustomId(`owner:overview:refresh:${state.sessionId}`)
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`owner:overview:toggle_maint:${state.sessionId}`)
        .setLabel(maintenance ? 'Disable Maintenance' : 'Enable Maintenance')
        .setStyle(ButtonStyle.Secondary)
    ];
  },

  async handleAction({ action, interaction, state }) {
    if (action === 'toggle_maint') {
      const current = isMaintenanceActive();
      const updated = !current;
      await setBotState('maintenance', {
        enabled: updated,
        message: 'AVA is currently undergoing scheduled maintenance. Please check back shortly.'
      });
      await logAudit({
        userId: interaction.user.id,
        action: updated ? 'MAINTENANCE_ENABLED' : 'MAINTENANCE_DISABLED',
        details: { triggered_by: interaction.user.tag }
      });
      return { status: `Maintenance mode ${updated ? 'ENABLED' : 'DISABLED'}` };
    }
    return { status: 'Refreshed overview metrics' };
  }
};

export default overviewTab;
