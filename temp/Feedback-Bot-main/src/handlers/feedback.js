// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/aerox (AeroX Development )
// + for any queries reach out Community or DM me.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getEmoji } from './emoji.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_PATH = join(__dirname, '../../data/config.json');

export function getConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function setConfig(data) {
  try {
    const current = getConfig();
    const merged = { ...current, ...data };
    writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
    return true;
  } catch {
    return false;
  }
}

export function getGuildConfig(guildId) {
  const cfg = getConfig();
  return cfg[guildId] ?? null;
}

export function setGuildConfig(guildId, data) {
  const cfg = getConfig();
  cfg[guildId] = { ...(cfg[guildId] ?? {}), ...data };
  return setConfig(cfg);
}

export function buildStars(rating) {
  const n = Math.min(Math.max(parseInt(rating) || 0, 0), 5);
  const filled = getEmoji('star') || '⭐';
  const empty = getEmoji('star_empty') || '☆';
  return filled.repeat(n) + (n < 5 ? empty.repeat(5 - n) : '');
}

// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/aerox (AeroX Development )
// + for any queries reach out Community or DM me.
