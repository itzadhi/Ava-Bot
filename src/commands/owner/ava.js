import {
  ApplicationCommandOptionType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  MessageFlags
} from 'discord.js';
import { metrics } from '../../core/metrics.js';
import { getMemoryStats } from '../../core/pterodactyl/memory.js';
import { moduleRegistry } from '../../structures/ModuleRegistry.js';
import { instanceManager } from '../../core/instance.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import { buildId } from '../../core/interactions/ownership.js';
import * as format from '../../utils/ui/format.js';

export function buildAvaStatusPayload(client, userId, guildId = '') {
  const snapshot = metrics.getSnapshot(client);
  const memStats = getMemoryStats();
  const modules = moduleRegistry.getAll ? moduleRegistry.getAll() : [];
  const container = new ContainerBuilder();

  // Title Header
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## 🌸 AVA System Telemetry & Status')
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  // Core Gateway & Runtime
  const heartbeatState = instanceManager.getInstanceCount ? instanceManager.getInstanceCount() : 1;
  const statusLines = [
    format.kvLine('Gateway Ping', snapshot.wsPing),
    format.kvLine('Process Uptime', snapshot.uptime),
    format.kvLine('Active Instances', `${heartbeatState} detected`),
    format.kvLine('Event Loop Lag', `p50: ${snapshot.eventLoopLag.p50} · p95: ${snapshot.eventLoopLag.p95} · max: ${snapshot.eventLoopLag.max}`)
  ].join('\n');

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(statusLines)
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  // Performance & Latencies
  const perfLines = [
    `**Response & Query Latencies**`,
    format.kvLine('Ack Time', `avg ${snapshot.ackTime.avg} · p95 ${snapshot.ackTime.p95}`),
    format.kvLine('Handler Time', `avg ${snapshot.handlerTime.avg} · p95 ${snapshot.handlerTime.p95}`),
    format.kvLine('DB Latency', `avg ${snapshot.dbQueries.avg} · slowest: ${snapshot.dbQueries.slowest}`)
  ].join('\n');

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(perfLines)
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  // Memory & Container Quota
  const memLines = [
    `**Container Memory (Pterodactyl / cgroup)**`,
    format.kvLine('RSS / Quota', `${memStats.rssMb} MB / ${memStats.limitMb} MB (${memStats.usagePercent}%)`),
    format.kvLine('Heap Used', `${memStats.heapUsedMb} MB / ${memStats.heapTotalMb} MB`),
    format.kvLine('Memory Pressure', memStats.isCritical ? '🚨 CRITICAL (>=90%)' : (memStats.isConstrained ? '⚠️ HIGH (>=80%)' : '🟢 Healthy (<80%)')),
    format.kvLine('Cache Sizes', `Guilds: ${snapshot.cacheSizes.guildSettings} · Sessions: ${snapshot.cacheSizes.activeSessions}`)
  ].join('\n');

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(memLines)
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  // Modules Summary
  const moduleLines = [
    `**Active Modules (${modules.length} registered)**`,
    modules.length > 0
      ? modules.map(m => `\`${m.id || m.name}\` (${m.version || '1.0.0'})`).join(' · ')
      : 'Core modules initialized'
  ].join('\n');

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(moduleLines)
  );

  // Grey Refresh Button
  const refreshCustomId = buildId({
    module: 'ava',
    action: 'status_refresh',
    guildId: guildId || '',
    ownerId: userId || 'staff',
    key: 'status'
  });

  const row = new ActionRowBuilder().addComponents(
    greyButton({
      id: refreshCustomId,
      label: 'Refresh Status',
      emoji: '🔄'
    })
  );

  return {
    components: [container, row],
    flags: MessageFlags.IsComponentsV2
  };
}

export default {
  name: 'ava',
  description: 'AVA administrative and operational controls',
  category: 'owner',
  ownerOnly: true,
  options: [
    {
      name: 'status',
      description: 'Display live telemetry, latencies, container memory, and module health',
      type: ApplicationCommandOptionType.Subcommand
    }
  ],
  async execute(ctx) {
    const payload = buildAvaStatusPayload(ctx.client, ctx.user.id, ctx.guild?.id);
    return ctx.reply(payload);
  }
};
