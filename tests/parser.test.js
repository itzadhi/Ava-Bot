import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, parsePrefixArgs, extractId } from '../src/utils/parser.js';
import { parseDuration } from '../src/utils/time.js';

test('tokenize parses basic words and quoted strings', () => {
  const input = 'create "My Server Backup" \'Another Snapshot\' normal_word';
  const { positional, flags } = tokenize(input);

  assert.deepEqual(positional, ['create', 'My Server Backup', 'Another Snapshot', 'normal_word']);
  assert.deepEqual(flags, {});
});

test('tokenize parses boolean flags and key-value options', () => {
  const input = 'backup load A7K2-9QXM --clean --roles=false --name "New Server"';
  const { positional, flags } = tokenize(input);

  assert.deepEqual(positional, ['backup', 'load', 'A7K2-9QXM']);
  assert.equal(flags.clean, true);
  assert.equal(flags.roles, 'false');
  assert.equal(flags.name, 'New Server');
});

test('extractId extracts mentions and snowflakes', () => {
  assert.equal(extractId('<@123456789012345678>', 'user'), '123456789012345678');
  assert.equal(extractId('<@!123456789012345678>', 'user'), '123456789012345678');
  assert.equal(extractId('<#987654321098765432>', 'channel'), '987654321098765432');
  assert.equal(extractId('<@&112233445566778899>', 'role'), '112233445566778899');
  assert.equal(extractId('123456789012345678', 'user'), '123456789012345678');
  assert.equal(extractId('A7K2-9QXM', 'id'), 'A7K2-9QXM');
});

test('parseDuration converts string durations into milliseconds', () => {
  assert.equal(parseDuration('60s'), 60 * 1000);
  assert.equal(parseDuration('15m'), 15 * 60 * 1000);
  assert.equal(parseDuration('12h'), 12 * 60 * 60 * 1000);
  assert.equal(parseDuration('30d'), 30 * 24 * 60 * 60 * 1000);
  assert.equal(parseDuration('invalid'), null);
});

test('parsePrefixArgs parses schema with types and validates choices', () => {
  const schema = [
    { name: 'target', type: 'user', required: true },
    { name: 'duration', type: 'duration', required: true },
    { name: 'tier', type: 'choice', choices: ['pro', 'ultimate'], required: false, defaultValue: 'pro' }
  ];

  const input = '<@123456789012345678> 30d';
  const { args, errors } = parsePrefixArgs(input, schema);

  assert.equal(errors.length, 0);
  assert.equal(args.target, '123456789012345678');
  assert.equal(args.duration, 30 * 24 * 60 * 60 * 1000);
  assert.equal(args.tier, 'pro');
});

test('parsePrefixArgs returns errors for invalid and missing parameters', () => {
  const schema = [
    { name: 'id', type: 'id', required: true },
    { name: 'count', type: 'int', required: true }
  ];

  const input = '';
  const { errors } = parsePrefixArgs(input, schema);

  assert.equal(errors.length, 2);
  assert.match(errors[0], /Missing required parameter: `id`/);
  assert.match(errors[1], /Missing required parameter: `count`/);
});
