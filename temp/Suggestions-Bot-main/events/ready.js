// ──────────────────────────────────────────────────────────────
// Suggestion Bot — Ready Event
// Made by ayliee, Aerox Development
// ──────────────────────────────────────────────────────────────

import { Events, REST, Routes, Collection } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`[Ready] Logged in as ${client.user.tag}`);

    // Load all commands into the client collection
    client.commands = new Collection();
    const commands = [];
    const commandsPath = path.join(__dirname, '../commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      const command = await import(`file://${filePath}`);
      if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        commands.push(command.data.toJSON());
      }
    }

    // Register slash commands globally
    const rest = new REST().setToken(process.env.TOKEN);
    try {
      console.log(`[Ready] Registering ${commands.length} slash commands...`);
      const data = await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands },
      );
      console.log(`[Ready] Successfully registered ${data.length} slash commands.`);
    } catch (error) {
      console.error('[Ready] Failed to register slash commands:', error);
    }
  },
};
