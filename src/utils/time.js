/**
 * Parses duration strings like '30d', '12h', '45m', '60s' into milliseconds
 * @param {string} str 
 * @returns {number|null} Duration in milliseconds or null if invalid
 */
export function parseDuration(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.trim().match(/^(\d+)\s*(s|sec|m|min|h|hr|d|day|w|week)s?$/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 's':
    case 'sec':
      return value * 1000;
    case 'm':
    case 'min':
      return value * 60 * 1000;
    case 'h':
    case 'hr':
      return value * 60 * 60 * 1000;
    case 'd':
    case 'day':
      return value * 24 * 60 * 60 * 1000;
    case 'w':
    case 'week':
      return value * 7 * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

/**
 * Formats a Date or unix timestamp into Discord timestamp format
 * @param {Date|number|string} date 
 * @param {'R'|'F'|'d'|'T'} format 
 * @returns {string}
 */
export function discordTimestamp(date, format = 'R') {
  let unix;
  if (date instanceof Date) {
    unix = Math.floor(date.getTime() / 1000);
  } else if (typeof date === 'number') {
    unix = date > 1e11 ? Math.floor(date / 1000) : date;
  } else {
    unix = Math.floor(new Date(date).getTime() / 1000);
  }
  return `<t:${unix}:${format}>`;
}

/**
 * Formats bytes into human readable string
 * @param {number} bytes 
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Formats milliseconds into human readable duration string (e.g. 2h 15m)
 * @param {number} ms 
 * @returns {string}
 */
export function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const sec = Math.floor(ms / 1000) % 60;
  const min = Math.floor(ms / (1000 * 60)) % 60;
  const hr = Math.floor(ms / (1000 * 60 * 60)) % 24;
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hr > 0) parts.push(`${hr}h`);
  if (min > 0) parts.push(`${min}m`);
  if (sec > 0 || parts.length === 0) parts.push(`${sec}s`);
  return parts.join(' ');
}
