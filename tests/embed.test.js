import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeEmbedForSend,
  sanitizeEmbeds,
  componentsToEmbed,
  extractMessagePayload
} from '../src/utils/embed.js';

test('sanitizeEmbedForSend strips disallowed read-only video and provider fields', () => {
  const rawEmbed = {
    type: 'video',
    title: 'Awesome YouTube Video',
    description: 'Check out this cool video',
    url: 'https://youtube.com/watch?v=123',
    video: {
      url: 'https://youtube.com/embed/123',
      proxy_url: 'https://images-ext-1.discordapp.net/video',
      height: 720,
      width: 1280
    },
    provider: {
      name: 'YouTube',
      url: 'https://youtube.com'
    },
    thumbnail: {
      url: 'https://i.ytimg.com/vi/123/hqdefault.jpg',
      proxy_url: 'https://images-ext-1.discordapp.net/thumb',
      height: 360,
      width: 480
    },
    fields: [
      { name: 'Field 1', value: 'Value 1', inline: true },
      { name: 'Count', value: 42 }, // numeric value should be preserved as string
      { name: '   ', value: 'Empty name' }, // should be stripped
      { name: 'Empty value', value: '' } // should be stripped
    ]
  };

  const sanitized = sanitizeEmbedForSend(rawEmbed);

  assert.ok(sanitized, 'Sanitized embed must not be null');
  assert.equal(sanitized.type, undefined, 'type field must be omitted');
  assert.equal(sanitized.video, undefined, 'video object must be omitted');
  assert.equal(sanitized.provider, undefined, 'provider object must be omitted');
  assert.equal(sanitized.thumbnail.proxy_url, undefined, 'proxy_url must be omitted');
  assert.equal(sanitized.thumbnail.url, 'https://i.ytimg.com/vi/123/hqdefault.jpg');
  assert.equal(sanitized.title, 'Awesome YouTube Video');
  assert.equal(sanitized.description, 'Check out this cool video');
  assert.equal(sanitized.fields.length, 2, 'Field 1 and numeric Count field must be preserved');
  assert.equal(sanitized.fields[0].name, 'Field 1');
  assert.equal(sanitized.fields[1].name, 'Count');
  assert.equal(sanitized.fields[1].value, '42');
});

test('sanitizeEmbeds returns empty array for empty or invisible embeds', () => {
  assert.deepEqual(sanitizeEmbeds(null), []);
  assert.deepEqual(sanitizeEmbeds([]), []);
  assert.deepEqual(sanitizeEmbeds([{}, { title: '' }]), []);
});

test('componentsToEmbed converts Discord Components V2 structure to rich embed', () => {
  const container = [
    {
      type: 17,
      accent_color: 16754000,
      components: [
        {
          type: 9,
          accessory: {
            type: 11,
            media: {
              url: 'https://juniper.bot/static/img/icon_256.png'
            }
          },
          components: [
            {
              type: 10,
              content: '## JuniperBot\nHello! I am JuniperBot!'
            }
          ]
        },
        {
          type: 14,
          divider: true
        },
        {
          type: 10,
          content: '### Features\nFull moderation & backups'
        },
        {
          type: 1,
          components: [
            {
              type: 2,
              label: 'Website',
              url: 'https://juniper.bot'
            }
          ]
        }
      ]
    }
  ];

  const embed = componentsToEmbed(container);
  assert.ok(embed, 'Embed should be created');
  assert.equal(embed.color, 16754000);
  assert.equal(embed.thumbnail.url, 'https://juniper.bot/static/img/icon_256.png');
  assert.ok(embed.description.includes('## JuniperBot'));
  assert.ok(embed.description.includes('### Features'));
  assert.ok(embed.description.includes('[Website](https://juniper.bot)'));
});

test('extractMessagePayload extracts content, embeds and converts bot components', () => {
  const mockMsg = {
    id: '123456789',
    author: {
      id: '987654321',
      username: 'CardBot',
      displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/cardbot.png'
    },
    content: '',
    createdAt: new Date('2026-10-20T00:00:00Z'),
    attachments: new Map(),
    embeds: [],
    components: [
      {
        data: {
          type: 17,
          accent_color: 0x5865F2,
          components: [
            {
              data: {
                type: 10,
                content: '## Welcome Card\nThanks for joining!'
              }
            }
          ]
        }
      }
    ]
  };

  const payload = extractMessagePayload(mockMsg);
  assert.ok(payload);
  assert.equal(payload.id, '123456789');
  assert.equal(payload.authorName, 'CardBot');
  assert.equal(payload.embeds.length, 1, 'Component card must be converted to an embed');
  assert.ok(payload.embeds[0].description.includes('Welcome Card'));
  assert.equal(payload.components.length, 1);
});
