// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/aerox (AeroX Development )
// + for any queries reach out Community or DM me.
import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import syncEmojis from './utils/syncEmojis.js';
import deployCommands from './utils/deployCommands.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const col = {
    reset:  '\x1b[0m',
    bright: '\x1b[1m',
    cyan:   '\x1b[96m',
    blue:   '\x1b[34m',
    white:  '\x1b[97m',
    purple: '\x1b[35m',
    green:  '\x1b[92m',
    dim:    '\x1b[90m',
};

function banner() {
    const lines = [
        '',
        `${col.cyan}${col.bright}   █████╗ ███████╗██████╗  ██████╗ ██╗  ██╗${col.reset}`,
        `${col.cyan}${col.bright}  ██╔══██╗██╔════╝██╔══██╗██╔═══██╗╚██╗██╔╝${col.reset}`,
        `${col.blue}${col.bright}  ███████║█████╗  ██████╔╝██║   ██║ ╚███╔╝ ${col.reset}`,
        `${col.blue}${col.bright}  ██╔══██║██╔══╝  ██╔══██╗██║   ██║ ██╔██╗ ${col.reset}`,
        `${col.white}${col.bright}  ██║  ██║███████╗██║  ██║╚██████╔╝██╔╝ ██╗${col.reset}`,
        `${col.white}${col.bright}  ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝${col.reset}`,
        '',
        `${col.dim}  ─────────────────────────────────────────────────${col.reset}`,
        `  ${col.green}●${col.reset} ${col.white}AeroX Feedback Bot${col.reset}  ${col.dim}|${col.reset}   ${col.white}discord.gg/aerox${col.reset}`,
        `  ${col.green}●${col.reset} ${col.white}Developer         ${col.reset}  ${col.dim}|${col.reset}   ${col.white}warrior · AeroX Development${col.reset}`,
        `${col.dim}  ─────────────────────────────────────────────────${col.reset}`,
        '',
    ];
    for (const line of lines) process.stdout.write(line + '\n');
}

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
    console.error(`${col.red}${col.bright}[AeroX] DISCORD_TOKEN is not set.${col.reset}`);
    process.exit(1);
}

banner();

await syncEmojis(TOKEN);
await deployCommands(TOKEN, process.env.DISCORD_CLIENT_ID);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel],
});

client.commands       = new Collection();
client.prefixCommands = new Collection();

const commandFiles = readdirSync(join(__dirname, 'commands')).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
    const mod     = await import(pathToFileURL(join(__dirname, 'commands', file)).href);
    const command = mod.default;
    if (command?.data)   client.commands.set(command.data.name, command);
    if (command?.prefix) client.prefixCommands.set(command.prefix, command);
}

const eventFiles = readdirSync(join(__dirname, 'events')).filter(f => f.endsWith('.js'));
for (const file of eventFiles) {
    const mod   = await import(pathToFileURL(join(__dirname, 'events', file)).href);
    const event = mod.default;
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

client.login(TOKEN);

// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/aerox (AeroX Development )
// + for any queries reach out Community or DM me.
