// ──────────────────────────────────────────────────────────────
// Suggestion Bot — Entry Point
// Made by ayliee, Aerox Development
// ──────────────────────────────────────────────────────────────

import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Validate required env vars on startup
if (!process.env.TOKEN) {
  console.error('[ERROR] TOKEN is not set in your .env file. Exiting.');
  process.exit(1);
}
if (!process.env.CLIENT_ID) {
  console.error('[ERROR] CLIENT_ID is not set in your .env file. Exiting.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Load event handlers
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = await import(`file://${filePath}`);
  if (event.default.once) {
    client.once(event.default.name, (...args) => event.default.execute(...args));
  } else {
    client.on(event.default.name, (...args) => event.default.execute(...args));
  }
}

client.login(process.env.TOKEN);
