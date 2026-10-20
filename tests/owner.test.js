import test from 'node:test';
import assert from 'node:assert/strict';
import overviewTab from '../src/modules/owner/tabs/overview.js';
import guildsTab from '../src/modules/owner/tabs/guilds.js';
import blacklistTab from '../src/modules/owner/tabs/blacklist.js';
import premiumTab from '../src/modules/owner/tabs/premium.js';
import backupsTab from '../src/modules/owner/tabs/backups.js';
import broadcastTab from '../src/modules/owner/tabs/broadcast.js';
import presenceTab from '../src/modules/owner/tabs/presence.js';
import commandsTab from '../src/modules/owner/tabs/commands.js';
import logsTab from '../src/modules/owner/tabs/logs.js';
import auditTab from '../src/modules/owner/tabs/audit.js';

test('Owner panel tabs all render with proper data structures', async () => {
  const mockClient = {
    guilds: {
      cache: new Map([
        ['123', { id: '123', name: 'Test Guild', memberCount: 150, ownerId: '999', channels: { cache: new Map() }, roles: { cache: new Map() } }]
      ])
    },
    ws: { ping: 25, shards: new Map([[0, {}]]) },
    user: { setPresence: () => {} }
  };

  const state = { sessionId: 'TEST-1234', guildsPage: 1 };

  const overview = await overviewTab.render({ client: mockClient, state });
  assert.ok(overview.body.includes('Guilds'));

  const guilds = await guildsTab.render({ client: mockClient, state });
  assert.ok(guilds.body.includes('Test Guild'));

  const blacklist = await blacklistTab.render({ state });
  assert.ok(blacklist.subtext.includes('Active Restrictions'));

  const premium = await premiumTab.render({ state });
  assert.ok(premium.body.includes('Recent Generated License Codes'));

  const backups = await backupsTab.render({ state });
  assert.ok(backups.body.includes('Total Stored Backups'));

  const broadcast = await broadcastTab.render({ state });
  assert.ok(broadcast.subtext.includes('Global Broadcast System'));

  const presence = await presenceTab.render({ client: mockClient });
  assert.ok(presence.body.includes('Current Activity Type'));

  const commands = await commandsTab.render({ state });
  assert.ok(commands.body.includes('Total Registered Commands'));

  const logs = await logsTab.render({ state });
  assert.ok(logs.subtext.includes('System Error Logs'));

  const audit = await auditTab.render({ state });
  assert.ok(audit.subtext.includes('System & Administrative Audit Trail'));
});
