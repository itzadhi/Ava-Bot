import { parseDuration } from './time.js';

/**
 * Tokenizes an input command string into tokens and named flags
 * Supports:
 * - Double and single quotes ("hello world", 'good morning')
 * - Flags: --clean, --force
 * - Options: --key value, --key="value", --key=value
 * - Discord mentions: <@123>, <#123>, <@&123>
 * - Discord IDs: 123456789012345678
 * @param {string} input 
 * @returns {{ positional: string[], flags: Record<string, string|boolean> }}
 */
export function tokenize(input) {
  const rawTokens = [];
  if (!input || !input.trim()) {
    return { positional: [], flags: {} };
  }

  // Matches either:
  // 1. Quoted string: "..." or '...'
  // 2. Unquoted token: anything without whitespace
  const tokenRegex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;

  while ((match = tokenRegex.exec(input)) !== null) {
    if (match[1] !== undefined) {
      rawTokens.push({ text: match[1], quoted: true });
    } else if (match[2] !== undefined) {
      rawTokens.push({ text: match[2], quoted: true });
    } else if (match[3] !== undefined) {
      rawTokens.push({ text: match[3], quoted: false });
    }
  }

  const positional = [];
  const flags = {};

  for (let i = 0; i < rawTokens.length; i++) {
    const { text, quoted } = rawTokens[i];

    if (!quoted && text.startsWith('--')) {
      const eqIndex = text.indexOf('=');
      if (eqIndex !== -1) {
        // e.g. --roles=false
        const key = text.slice(2, eqIndex);
        const val = text.slice(eqIndex + 1);
        flags[key] = val;
      } else {
        const key = text.slice(2);
        // Lookahead: if next token exists and is not a flag, consume as flag value
        if (i + 1 < rawTokens.length && (rawTokens[i + 1].quoted || !rawTokens[i + 1].text.startsWith('--'))) {
          flags[key] = rawTokens[i + 1].text;
          i++; // Consume next token
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(text);
    }
  }

  return { positional, flags };
}

/**
 * Extracts a snowflake ID from a mention or plain ID string
 * @param {string} str 
 * @param {'user'|'channel'|'role'|'id'} type 
 * @returns {string|null}
 */
export function extractId(str, type = 'id') {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();

  // User mention: <@123> or <@!123>
  const userMatch = trimmed.match(/^<@!?(\d{17,20})>$/);
  if (userMatch) return userMatch[1];

  // Channel mention: <#123>
  const channelMatch = trimmed.match(/^<#(\d{17,20})>$/);
  if (channelMatch) return channelMatch[1];

  // Role mention: <@&123>
  const roleMatch = trimmed.match(/^<@&(\d{17,20})>$/);
  if (roleMatch) return roleMatch[1];

  // Raw snowflake ID
  const rawIdMatch = trimmed.match(/^(\d{17,20})$/);
  if (rawIdMatch) return rawIdMatch[1];

  // Short backup or template ID (e.g. A7K2-9QXM or ARG-1234)
  const shortIdMatch = trimmed.match(/^[A-Za-z0-9_-]{4,20}$/);
  if (type === 'id' && shortIdMatch) return trimmed.toUpperCase();

  return null;
}

/**
 * Matches tokenized prefix arguments against a command's args schema
 * @param {string} rawInput 
 * @param {Array<object>} schemaArgs 
 * @returns {{ args: Record<string, any>, errors: string[] }}
 */
export function parsePrefixArgs(rawInput, schemaArgs = []) {
  const { positional, flags } = tokenize(rawInput);
  const args = {};
  const errors = [];
  let posIndex = 0;

  for (const schema of schemaArgs) {
    const { name, type, required = false, choices = null, defaultValue = undefined } = schema;
    let rawVal = flags[name] !== undefined ? flags[name] : positional[posIndex];

    if (rawVal === undefined || rawVal === null) {
      if (defaultValue !== undefined) {
        args[name] = defaultValue;
      } else if (required) {
        errors.push(`Missing required parameter: \`${name}\``);
      } else {
        args[name] = null;
      }
      continue;
    }

    // Advance positional pointer only if token came from positional array
    if (flags[name] === undefined) {
      posIndex++;
    }

    // Type coercion & validation
    switch (type) {
      case 'int':
      case 'integer': {
        const num = parseInt(rawVal, 10);
        if (isNaN(num)) {
          errors.push(`Invalid integer for \`${name}\`: "${rawVal}"`);
        } else {
          args[name] = num;
        }
        break;
      }

      case 'bool':
      case 'boolean': {
        if (typeof rawVal === 'boolean') {
          args[name] = rawVal;
        } else {
          const lower = String(rawVal).toLowerCase();
          if (['true', 'yes', 'on', '1', 'enable'].includes(lower)) {
            args[name] = true;
          } else if (['false', 'no', 'off', '0', 'disable'].includes(lower)) {
            args[name] = false;
          } else {
            errors.push(`Invalid boolean for \`${name}\`: "${rawVal}"`);
          }
        }
        break;
      }

      case 'duration': {
        const ms = parseDuration(String(rawVal));
        if (ms === null) {
          errors.push(`Invalid duration for \`${name}\`: "${rawVal}". Use formats like 30d, 12h, 45m.`);
        } else {
          args[name] = ms;
        }
        break;
      }

      case 'user': {
        const id = extractId(String(rawVal), 'user');
        if (!id) {
          errors.push(`Invalid user for \`${name}\`: "${rawVal}". Provide a user mention or user ID.`);
        } else {
          args[name] = id;
        }
        break;
      }

      case 'channel': {
        const id = extractId(String(rawVal), 'channel');
        if (!id) {
          errors.push(`Invalid channel for \`${name}\`: "${rawVal}". Provide a channel mention or ID.`);
        } else {
          args[name] = id;
        }
        break;
      }

      case 'role': {
        const id = extractId(String(rawVal), 'role');
        if (!id) {
          errors.push(`Invalid role for \`${name}\`: "${rawVal}". Provide a role mention or ID.`);
        } else {
          args[name] = id;
        }
        break;
      }

      case 'id': {
        const id = extractId(String(rawVal), 'id');
        if (!id) {
          errors.push(`Invalid ID for \`${name}\`: "${rawVal}".`);
        } else {
          args[name] = id;
        }
        break;
      }

      case 'choice':
      case 'string':
      default: {
        const strVal = String(rawVal);
        if (choices && choices.length > 0) {
          const valid = choices.find(c => 
            (typeof c === 'string' && c.toLowerCase() === strVal.toLowerCase()) ||
            (c.value !== undefined && String(c.value).toLowerCase() === strVal.toLowerCase())
          );
          if (!valid) {
            const allowed = choices.map(c => typeof c === 'string' ? c : c.name || c.value).join(', ');
            errors.push(`Invalid choice for \`${name}\`: "${strVal}". Allowed options: ${allowed}`);
          } else {
            args[name] = typeof valid === 'object' ? valid.value : valid;
          }
        } else {
          args[name] = strVal;
        }
        break;
      }
    }
  }

  // Also include any extra flags passed
  for (const [k, v] of Object.entries(flags)) {
    if (args[k] === undefined) {
      args[k] = v;
    }
  }

  return { args, errors };
}
