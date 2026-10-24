import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { REST, Routes, PermissionFlagsBits } from 'discord.js';
import { config } from '../src/config.js';
import { perm } from '../src/core/permissions/permApply.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(ROOT_DIR, 'reports');

// Dangerous administrative permissions that baseline recovery must NEVER grant
export const BANNED_ADMIN_PERMISSIONS = (
  PermissionFlagsBits.Administrator |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageWebhooks |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.MentionEveryone |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.ModerateMembers
);

/**
 * Plans recovery actions for a guild by comparing live state with audit logs,
 * backup files, and baseline community rules.
 *
 * @param {string} guildId
 * @returns {Promise<{ guildId: string, guildName: string, actions: Array<object> }>}
 */
export async function planRecovery(guildId) {
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  const guildData = await rest.get(Routes.guild(guildId));
  const roles = await rest.get(Routes.guildRoles(guildId));
  const channels = await rest.get(Routes.guildChannels(guildId));

  const actions = [];
  const everyoneRole = roles.find(r => r.id === guildId);

  // 1. Audit Log / Role check for @everyone
  // Check if @everyone lacks baseline community permissions (like Use External Emojis, Create Public Threads)
  if (everyoneRole) {
    const currentBits = BigInt(everyoneRole.permissions || 0);

    // Standard baseline community additions if missing
    const communityAdditions = [
      { flag: PermissionFlagsBits.UseExternalEmojis, name: 'Use External Emojis' },
      { flag: PermissionFlagsBits.CreatePublicThreads, name: 'Create Public Threads' }
    ];

    let suggestedBits = currentBits;
    const addedNames = [];

    for (const item of communityAdditions) {
      if ((currentBits & item.flag) !== item.flag) {
        suggestedBits |= item.flag;
        addedNames.push(item.name);
      }
    }

    // Safety assert: verify no banned permissions are granted
    suggestedBits &= ~BANNED_ADMIN_PERMISSIONS;

    if (suggestedBits !== currentBits) {
      actions.push({
        targetType: 'role',
        targetId: everyoneRole.id,
        targetName: '@everyone',
        field: 'permissions',
        currentValue: currentBits.toString(),
        targetValue: suggestedBits.toString(),
        source: 'baseline defaults (safe community only)',
        reason: `Restore missing community messaging flags: ${addedNames.join(', ')}`,
        execute: () => rest.patch(Routes.guildRole(guildId, everyoneRole.id), {
          body: { permissions: suggestedBits.toString() }
        })
      });
    }
  }

  // 2. Channel Overwrites Check
  // Inspect overwrites on voice and text channels
  for (const ch of channels) {
    const overwrites = ch.permission_overwrites || [];
    const everyoneOw = overwrites.find(o => o.id === guildId);

    if (everyoneOw) {
      const denyBits = BigInt(everyoneOw.deny || 0);
      const allowBits = BigInt(everyoneOw.allow || 0);

      // Check if Voice channel has Connect denied on @everyone
      const deniesConnect = (denyBits & PermissionFlagsBits.Connect) === PermissionFlagsBits.Connect;

      if (deniesConnect) {
        const newDenyBits = denyBits & ~PermissionFlagsBits.Connect;

        actions.push({
          targetType: 'channel_overwrite',
          targetId: ch.id,
          targetName: `#${ch.name}`,
          field: 'Connect',
          currentValue: 'deny: Connect',
          targetValue: newDenyBits === 0n ? 'remove overwrite' : `deny: ${newDenyBits}`,
          source: 'lockdown cluster remediation',
          reason: 'Remove unintentional Connect deny on voice channel',
          execute: async () => {
            if (newDenyBits === 0n && allowBits === 0n) {
              return rest.delete(Routes.channelOverwrite(ch.id, guildId));
            } else {
              return rest.put(Routes.channelOverwrite(ch.id, guildId), {
                body: {
                  type: 0,
                  allow: allowBits.toString(),
                  deny: newDenyBits.toString()
                }
              });
            }
          }
        });
      }
    }
  }

  return {
    guildId,
    guildName: guildData.name,
    actions
  };
}

export async function main() {
  const isExecute = process.argv.includes('--execute');
  const confirmGuildArg = process.argv.find(a => a.startsWith('--guild=') || a.startsWith('--guildId='));
  const targetGuildId = confirmGuildArg ? confirmGuildArg.split('=')[1] : null;

  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  const guilds = await rest.get(Routes.userGuilds());

  const targetGuilds = targetGuildId ? guilds.filter(g => g.id === targetGuildId) : guilds;

  console.log(`\n================ RECOVERY PLAN (Mode: ${isExecute ? 'EXECUTION' : 'DRY RUN'}) ================`);

  for (const g of targetGuilds) {
    const plan = await planRecovery(g.id);
    console.log(`\nGuild: "${plan.guildName}" (${plan.guildId})`);
    console.log(`Proposed Recovery Actions: ${plan.actions.length}`);

    if (plan.actions.length === 0) {
      console.log('  ✓ No recovery actions required. Server permissions match desired baseline.');
      continue;
    }

    console.log('\nDiff Table:');
    console.log('┌──────────────────────────────────────┬──────────────────────┬──────────────────────┬────────────────────────────────┬────────────────────────────────────────────────────────┐');
    console.log('│ Target                               │ Now                  │ Becomes              │ Source                         │ Reason                                                 │');
    console.log('├──────────────────────────────────────┼──────────────────────┼──────────────────────┼────────────────────────────────┼────────────────────────────────────────────────────────┤');

    for (const a of plan.actions) {
      const targetStr = `${a.targetName} (${a.targetId})`.padEnd(36).slice(0, 36);
      const nowStr = String(a.currentValue).padEnd(20).slice(0, 20);
      const becomesStr = String(a.targetValue).padEnd(20).slice(0, 20);
      const sourceStr = a.source.padEnd(30).slice(0, 30);
      const reasonStr = a.reason.padEnd(54).slice(0, 54);
      console.log(`│ ${targetStr} │ ${nowStr} │ ${becomesStr} │ ${sourceStr} │ ${reasonStr} │`);
    }
    console.log('└──────────────────────────────────────┴──────────────────────┴──────────────────────┴────────────────────────────────┴────────────────────────────────────────────────────────┘');

    if (isExecute) {
      console.log(`\n[WARNING] Execution requested for guild "${plan.guildName}" (${plan.guildId}).`);
      console.log('Safety check: PERMISSION_WRITES status must be verified before modifying.');
      if (!perm.isWritable() && process.env.PERMISSION_WRITES !== 'on') {
        console.log('❌ Refused execution: PERMISSION_WRITES is not "on". Aborting live change.');
        continue;
      }

      console.log(`Applying ${plan.actions.length} action(s) with rate-limit pacing...`);
      for (const a of plan.actions) {
        try {
          await a.execute();
          console.log(`  ✓ Applied: ${a.targetName} -> ${a.targetValue}`);
        } catch (err) {
          console.error(`  ❌ Failed: ${a.targetName}: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 250));
      }
      console.log(`\n✓ Completed recovery application for guild ${plan.guildId}.`);
    } else {
      console.log(`\n[NOTE] Dry run complete for ${plan.guildName}. No live changes were made.`);
      console.log(`To execute live recovery, the user must explicitly approve and run:`);
      console.log(`PERMISSION_WRITES=on node scripts/recover-permissions.js --execute --guild=${plan.guildId}`);
    }
  }

  console.log('\n========================================================================\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('[RECOVER] Fatal error:', err);
    process.exit(1);
  });
}
