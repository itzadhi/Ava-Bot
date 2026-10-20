// ──────────────────────────────────────────────────────────────
// Suggestion Bot — JSON Database Utility
// Made by ayliee, Aerox Development
// ──────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../db.json');

// Read the entire database
export const readDb = () => {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    const initial = { guilds: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
};

// Write the entire database
export const writeDb = (data) => {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

// Get or initialize a guild entry
export const getGuild = (db, guildId) => {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = {
      suggestionChannelId: null,
      logsChannelId: null,        // channel where high-vote suggestions are forwarded
      voteThreshold: null,        // upvote count required to trigger a log entry
      threadConfig: { slowmode: 0 },
      suggestions: {},
    };
    writeDb(db);
  }

  // Back-fill fields for guilds created before these keys existed
  const g = db.guilds[guildId];
  if (!('logsChannelId' in g))  g.logsChannelId  = null;
  if (!('voteThreshold' in g))  g.voteThreshold  = null;
  if (!g.threadConfig)          g.threadConfig   = { slowmode: 0 };

  return g;
};

// Save a guild entry
export const saveGuild = (db, guildId, guildData) => {
  db.guilds[guildId] = guildData;
  writeDb(db);
};
