import { getSupabase } from './client.js';
import * as guilds from './guilds.js';
import * as backups from './backups.js';
import * as chatlogs from './chatlogs.js';
import * as syncs from './syncs.js';
import * as templates from './templates.js';
import * as blacklist from './blacklist.js';
import * as premium from './premium.js';
import * as botState from './botState.js';
import * as audit from './audit.js';
import * as errors from './errors.js';
import * as moduleData from './moduleData.js';
import * as storage from './storage.js';
import * as suggestions from './suggestions.js';
import * as feedback from './feedback.js';
import * as voice from './voice.js';
import * as panels from './panels.js';

export const db = {
  client: getSupabase,
  guilds,
  backups,
  chatlogs,
  syncs,
  templates,
  blacklist,
  premium,
  botState,
  audit,
  errors,
  moduleData,
  storage,
  suggestions,
  feedback,
  voice,
  panels
};

export {
  getSupabase,
  guilds,
  backups,
  chatlogs,
  syncs,
  templates,
  blacklist,
  premium,
  botState,
  audit,
  errors,
  moduleData,
  storage,
  suggestions,
  feedback,
  voice,
  panels
};

export default db;
