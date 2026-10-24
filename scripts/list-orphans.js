import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';

export async function findOrphanedMessages() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  await client.login(process.env.DISCORD_TOKEN);

  const report = [];

  for (const [gid, guild] of client.guilds.cache) {
    const g = await guild.fetch();
    const channels = await g.channels.fetch();

    for (const [cid, ch] of channels) {
      if (!ch || (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement)) continue;

      try {
        const messages = await ch.messages.fetch({ limit: 50 });
        const botMessages = messages.filter(m => m.author.id === client.user.id);

        for (const [mid, msg] of botMessages) {
          report.push({
            guildId: gid,
            guildName: g.name,
            channelId: cid,
            channelName: ch.name,
            messageId: mid,
            createdAt: msg.createdAt.toISOString(),
            link: `https://discord.com/channels/${gid}/${cid}/${mid}`,
            hasComponents: msg.components?.length > 0
          });
        }
      } catch (_) {}
    }
  }

  await client.destroy();
  return report;
}

if (process.argv[1]?.endsWith('list-orphans.js')) {
  process.stdout.write('\nScanning Discord servers for leftover bot messages...\n');
  const orphans = await findOrphanedMessages();

  process.stdout.write('\n════════════════════════════════════════════════════════════════════════════════\n');
  process.stdout.write('                  DISCORD ORPHANED BOT MESSAGES REPORT                         \n');
  process.stdout.write('════════════════════════════════════════════════════════════════════════════════\n');

  if (orphans.length === 0) {
    process.stdout.write('No orphaned bot messages found in scanned text channels.\n');
  } else {
    process.stdout.write(`Found ${orphans.length} orphaned bot message(s):\n\n`);
    for (const o of orphans) {
      process.stdout.write(`• Guild: "${o.guildName}" | Channel: #${o.channelName}\n`);
      process.stdout.write(`  Link: ${o.link}\n`);
      process.stdout.write(`  Created: ${o.createdAt} | Has Interactive Buttons: ${o.hasComponents ? 'YES' : 'NO'}\n\n`);
    }
  }
  process.stdout.write('════════════════════════════════════════════════════════════════════════════════\n\n');
}
