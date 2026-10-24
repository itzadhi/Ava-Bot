import 'dotenv/config';
import { Client, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { getSupabase } from '../src/db/client.js';

// Standard Discord @everyone permission set
const STANDARD_EVERYONE_PERMS =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.SendMessagesInThreads |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.AddReactions |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.AttachFiles |
  PermissionFlagsBits.UseApplicationCommands |
  PermissionFlagsBits.Connect |
  PermissionFlagsBits.Speak |
  PermissionFlagsBits.Stream |
  PermissionFlagsBits.UseVAD |
  PermissionFlagsBits.CreateInstantInvite |
  PermissionFlagsBits.ChangeNickname;

export async function runUnlockOnly({ dryRun = true } = {}) {
  const db = getSupabase();
  const { data: states } = await db.from('lockdown_state').select('*');
  const { data: jobs } = await db.from('ava_jobs').select('*');

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);

  const report = [];

  for (const [gid, guild] of client.guilds.cache) {
    const g = await guild.fetch();
    const everyoneRole = g.roles.everyone;
    const isDenied = !everyoneRole.permissions.has(PermissionFlagsBits.SendMessages) || everyoneRole.permissions.bitfield.toString() === '0';
    const stateRow = states?.find(s => s.guild_id === gid);

    let result = 'CLEAN';
    let failures = 'none';

    if (isDenied) {
      if (dryRun) {
        result = 'NEEDS_RESTORE (role perms bitfield is 0)';
      } else {
        try {
          await everyoneRole.setPermissions(STANDARD_EVERYONE_PERMS, 'AVA Fresh Start: Restoring standard @everyone permissions');
          result = 'RESTORED';
          // Mark db idle
          await db.from('lockdown_state').update({ state: 'idle', plan: {}, locked_channels: [] }).eq('guild_id', gid);
        } catch (err) {
          result = 'FAILED';
          failures = err.message;
        }
      }
    }

    report.push({
      guildId: gid,
      guildName: g.name,
      stateInDb: stateRow?.state || 'none',
      startedBy: stateRow?.started_by || 'n/a',
      result,
      failures
    });
  }

  await client.destroy();
  return report;
}

if (process.argv[1]?.endsWith('unlock-servers.js')) {
  const isExecute = process.argv.includes('--execute');
  const results = await runUnlockOnly({ dryRun: !isExecute });
  process.stdout.write('\n════════════════════════════════════════════════════════════════════════════════\n');
  process.stdout.write('                     PHASE 1: SERVER UNLOCK STATUS REPORT                      \n');
  process.stdout.write('════════════════════════════════════════════════════════════════════════════════\n');
  process.stdout.write('Guild ID            | Guild Name         | DB State | Started By           | Status\n');
  process.stdout.write('--------------------+--------------------+----------+----------------------+-------------------------------------------\n');
  for (const r of results) {
    const gid = r.guildId.padEnd(19);
    const gname = r.guildName.slice(0, 18).padEnd(18);
    const dbSt = r.stateInDb.padEnd(8);
    const sb = r.startedBy.padEnd(20);
    process.stdout.write(`${gid} | ${gname} | ${dbSt} | ${sb} | ${r.result}\n`);
  }
  process.stdout.write('════════════════════════════════════════════════════════════════════════════════\n\n');
}
