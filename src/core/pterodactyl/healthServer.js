import http from 'node:http';
import { logger } from '../../utils/logger.js';
import { getMemoryStats } from './memory.js';

let server = null;

/**
 * Starts optional HTTP health probe server if enabled via ENABLE_HEALTH_ENDPOINT=true
 * @param {import('discord.js').Client} [client]
 */
export function startHealthServer(client = null) {
  if (process.env.ENABLE_HEALTH_ENDPOINT !== 'true') {
    return null; // Off by default on Pterodactyl panels
  }

  const port = parseInt(process.env.SERVER_PORT || process.env.PORT || '8080', 10);
  if (isNaN(port) || port <= 0) {
    logger.warn('ENABLE_HEALTH_ENDPOINT is true but SERVER_PORT is invalid. Skipping health server.');
    return null;
  }

  server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/' || req.url === '/ping') {
      const mem = getMemoryStats();
      const ping = client?.ws?.ping ?? -1;
      const uptimeSecs = Math.floor(process.uptime());

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        uptime: uptimeSecs,
        ping: Math.round(ping),
        memory: mem
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info({ port }, `Pterodactyl web health endpoint online at http://0.0.0.0:${port}/health`);
  });

  return server;
}

export function stopHealthServer() {
  if (server) {
    try {
      server.close();
    } catch (_) {}
    server = null;
  }
}
