import { db } from './client.js';
import { logger } from '../utils/logger.js';

// In-memory cache for ultra-fast middleware checks
let stateCache = {
  maintenance: { enabled: false, message: 'AVA is currently undergoing maintenance. Please try again later.' },
  disabled_commands: [],
  presence: { type: 'Playing', text: 'a!help | /backup', status: 'online' }
};

export async function initBotState() {
  try {
    const { data, error } = await db.from('bot_state').select('*');
    if (!error && data) {
      for (const item of data) {
        stateCache[item.key] = item.value;
      }
      logger.info('Bot state loaded from database');
    }
  } catch (err) {
    logger.warn({ err }, 'Could not load bot state from DB, using defaults');
  }
}

export function getBotState(key) {
  return stateCache[key];
}

export async function setBotState(key, value) {
  stateCache[key] = value;
  const { data, error } = await db
    .from('bot_state')
    .upsert({
      key,
      value,
      updated_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    logger.error({ error, key }, 'Error updating bot state in DB');
    throw error;
  }
  return data;
}

export function isMaintenanceActive() {
  return Boolean(stateCache.maintenance?.enabled);
}

export function getMaintenanceMessage() {
  return stateCache.maintenance?.message || 'AVA is currently undergoing scheduled maintenance.';
}

export function isCommandDisabled(commandName) {
  const disabled = stateCache.disabled_commands || [];
  return disabled.some(d => d.name === commandName || d === commandName);
}

export function getCommandDisableReason(commandName) {
  const disabled = stateCache.disabled_commands || [];
  const entry = disabled.find(d => d.name === commandName);
  return entry?.reason || 'This command has been temporarily disabled by the bot administration.';
}
