import { config } from '../src/config.js';
import { Client, GatewayIntentBits } from 'discord.js';
import { autoRepairPermissionsAndTickets } from '../src/modules/permify/repair.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('clientReady', async (readyClient) => {
  console.log(`\n======================================================`);
  console.log(`[PUSH PERMISSIONS] Logged in as ${readyClient.user.tag}`);
  console.log(`[PUSH PERMISSIONS] Connected to ${readyClient.guilds.cache.size} guilds`);
  console.log(`======================================================\n`);

  try {
    const summary = await autoRepairPermissionsAndTickets(readyClient);
    console.log(`\n[REPAIR COMPLETE SUMMARY]:`, JSON.stringify(summary, null, 2));

    // Audit verify each guild
    for (const guild of readyClient.guilds.cache.values()) {
      console.log(`\n--- Verification for Guild: ${guild.name} (${guild.id}) ---`);
      const channels = await guild.channels.fetch();
      for (const chan of channels.values()) {
        if (!chan) continue;
        const owEveryone = chan.permissionOverwrites.cache.get(guild.id);
        const deniesView = Boolean(owEveryone?.deny?.has(1024n));
        const allowsView = Boolean(owEveryone?.allow?.has(1024n));
        if (chan.name.startsWith('ticket-') || chan.name.includes('ticket') || deniesView) {
          console.log(`  #${chan.name} (${chan.id}) | @everyone deny: ${deniesView}, allow: ${allowsView} | total ow: ${chan.permissionOverwrites.cache.size}`);
        }
      }
    }
  } catch (err) {
    console.error(`[PUSH ERROR]:`, err);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(config.DISCORD_TOKEN);
