// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/aerox (AeroX Development )
// + for any queries reach out Community or DM me.

import { createReadStream } from 'fs';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import https from 'https';
import http from 'http';
import { REST } from 'discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const EMOJI_REGEX = /^<(a?):(\w+):(\d+)>$/;
const EMOJI_PATH  = join(__dirname, '../../data/emoji.json');

const col = {
    reset:  '\x1b[0m',
    bright: '\x1b[1m',
    purple: '\x1b[35m',
    pink:   '\x1b[95m',
    white:  '\x1b[97m',
    gray:   '\x1b[90m',
    green:  '\x1b[92m',
    yellow: '\x1b[93m',
    red:    '\x1b[91m',
    cyan:   '\x1b[96m',
};

const tag  = `${col.purple}${col.bright}  [EmojiSync]${col.reset}`;
const line = `${col.purple}${col.bright}  ─────────────────────────────────────${col.reset}`;

function fetchEmojiImage(id, animated) {
    const ext = animated ? 'gif' : 'webp';
    const url = `https://cdn.discordapp.com/emojis/${id}.${ext}`;
    return fetchFromUrl(url);
}

function fetchFromUrl(url) {
    const mod = url.startsWith('https') ? https : http;
    return new Promise((resolve) => {
        mod.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                fetchFromUrl(res.headers.location).then(resolve);
                return;
            }
            if (res.statusCode !== 200) { resolve(null); return; }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', () => resolve(null));
    });
}

export default async function syncEmojis(token) {
    if (!token) {
        console.log(`${tag} ${col.yellow}No token — skipping emoji sync.${col.reset}`);
        return;
    }

    let emojis;
    try {
        emojis = JSON.parse(readFileSync(EMOJI_PATH, 'utf8'));
    } catch (err) {
        console.log(`${tag} ${col.red}Failed to read emoji.json: ${err.message}${col.reset}`);
        return;
    }

    console.log(line);
    console.log(`${tag} ${col.white}${col.bright}Starting emoji sync...${col.reset}`);

    const rest = new REST({ version: '10' }).setToken(token);

    let appId;
    try {
        const app = await rest.get('/applications/@me');
        appId = app.id;
    } catch (err) {
        console.log(`${tag} ${col.red}Failed to fetch application info: ${err.message}${col.reset}`);
        console.log(line);
        return;
    }

    let appEmojis = [];
    try {
        const res = await rest.get(`/applications/${appId}/emojis`);
        appEmojis = Array.isArray(res) ? res : (res.items ?? []);
    } catch (err) {
        console.log(`${tag} ${col.red}Failed to fetch application emojis: ${err.message}${col.reset}`);
        console.log(line);
        return;
    }

    const emojiEntries = Object.entries(emojis);
    console.log(`${tag} ${col.gray}Config: ${col.white}${emojiEntries.length}${col.gray} emojis  |  Application: ${col.white}${appEmojis.length}${col.gray} emojis${col.reset}`);
    console.log(line);

    let updated  = false;
    let skipped  = 0;
    let uploaded = 0;
    let fixed    = 0;
    let failed   = 0;
    const result = { ...emojis };

    for (const [key, emojiStr] of emojiEntries) {
        const match = typeof emojiStr === 'string' && emojiStr.match(EMOJI_REGEX);
        if (!match) {
            console.log(`${tag} ${col.yellow}  ? ${col.white}${key}${col.yellow} — not a custom emoji, skipping${col.reset}`);
            skipped++;
            continue;
        }

        const animated = match[1] === 'a';
        const name     = match[2];
        const id       = match[3];

        const existing = appEmojis.find(e => e.id === id) ?? appEmojis.find(e => e.name === name);

        if (existing) {
            const correct = existing.animated
                ? `<a:${existing.name}:${existing.id}>`
                : `<:${existing.name}:${existing.id}>`;

            if (emojiStr !== correct) {
                result[key] = correct;
                updated = true;
                fixed++;
                console.log(`${tag} ${col.yellow}  ↻ ${col.white}${name}${col.yellow} — ID corrected${col.reset}`);
            } else {
                skipped++;
                console.log(`${tag} ${col.green}  ✓ ${col.white}${name}${col.gray} — already present${col.reset}`);
            }
            continue;
        }

        console.log(`${tag} ${col.cyan}  ↑ ${col.white}${name}${col.cyan} — not found, uploading...${col.reset}`);

        const imageBuffer = await fetchEmojiImage(id, animated);
        if (!imageBuffer) {
            console.log(`${tag} ${col.red}  ✗ ${col.white}${name}${col.red} — could not download image, skipping${col.reset}`);
            failed++;
            continue;
        }

        try {
            const mimeType = animated ? 'image/gif' : 'image/webp';
            const image    = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
            const newEmoji = await rest.post(`/applications/${appId}/emojis`, {
                body: { name, image },
            });
            result[key] = newEmoji.animated
                ? `<a:${newEmoji.name}:${newEmoji.id}>`
                : `<:${newEmoji.name}:${newEmoji.id}>`;
            updated = true;
            uploaded++;
            console.log(`${tag} ${col.green}  ✓ ${col.white}${name}${col.green} — uploaded (${newEmoji.id})${col.reset}`);
        } catch (err) {
            console.log(`${tag} ${col.red}  ✗ ${col.white}${name}${col.red} — upload failed: ${err.message}${col.reset}`);
            failed++;
        }
    }

    console.log(line);

    if (updated) {
        try {
            writeFileSync(EMOJI_PATH, JSON.stringify(result, null, 4));
            console.log(`${tag} ${col.green}${col.bright}  emoji.json saved with updated IDs.${col.reset}`);
        } catch (err) {
            console.log(`${tag} ${col.red}  Failed to save emoji.json: ${err.message}${col.reset}`);
        }
    }

    const parts = [
        skipped  ? `${col.green}${skipped} present${col.reset}`   : null,
        fixed    ? `${col.yellow}${fixed} fixed${col.reset}`       : null,
        uploaded ? `${col.cyan}${uploaded} uploaded${col.reset}`   : null,
        failed   ? `${col.red}${failed} failed${col.reset}`        : null,
    ].filter(Boolean);

    console.log(`${tag}  ${parts.join('  ')}`);
    console.log(line);
}

// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/aerox (AeroX Development )
// + for any queries reach out Community or DM me.
