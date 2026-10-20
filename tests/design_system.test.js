import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, ButtonStyle, TextInputStyle } from 'discord.js';
import {
  theme,
  buildContainer,
  successCard,
  errorCard,
  warnCard,
  infoCard,
  confirmCard,
  paginatedCard,
  panelCard,
  createButton,
  createStringSelect,
  createChannelSelect,
  createRoleSelect,
  createModal,
  bold,
  italic,
  boldItalic,
  underline,
  strike,
  spoiler,
  code,
  codeBlock,
  ansiBlock,
  ansi,
  quote,
  blockQuote,
  heading,
  subtext,
  link,
  userMention,
  roleMention,
  channelMention,
  commandMention,
  time,
  timeLongAndRelative,
  list,
  numberedList,
  truncate,
  progressBar,
  kvLine,
  escapeMarkdown,
  allowedMentionsNone
} from '../src/utils/ui/index.js';

test('Theme configuration exports expected tokens and links', () => {
  assert.equal(theme.accent, undefined, 'theme.accent must be removed');
  assert.ok(theme.colors.success);
  assert.ok(theme.colors.error);
  assert.ok(theme.colors.warn);
  assert.ok(theme.colors.info);
  assert.ok(theme.emojis.dot);
  assert.ok(theme.emojis.arrow);
  assert.ok(theme.emojis.success);
  assert.ok(theme.emojis.error);
  assert.ok(theme.emojis.warn);
  assert.ok(theme.emojis.loading);
  assert.ok(theme.emojis.on);
  assert.ok(theme.emojis.off);
  assert.ok(theme.footer.text);
  assert.ok(theme.links.invite);
  assert.ok(theme.links.website);
  assert.ok(theme.links.support);
});

test('Format helpers format Discord markdown correctly', () => {
  assert.equal(bold('test'), '**test**');
  assert.equal(italic('test'), '*test*');
  assert.equal(boldItalic('test'), '***test***');
  assert.equal(underline('test'), '__test__');
  assert.equal(strike('test'), '~~test~~');
  assert.equal(spoiler('test'), '||test||');
  assert.equal(code('test'), '`test`');
  assert.equal(codeBlock('js', 'const x = 1;'), '```js\nconst x = 1;\n```');
  assert.equal(ansiBlock(ansi.green('ok')), '```ansi\n\u001b[0;32mok\u001b[0m\n```');
  assert.equal(quote('test'), '> test');
  assert.equal(blockQuote('test'), '>>> test');
  assert.equal(heading(1, 'Title'), '# Title');
  assert.equal(heading(2, 'Subtitle'), '## Subtitle');
  assert.equal(heading(3, 'Section'), '### Section');
  assert.equal(subtext('hint'), '-# hint');
  assert.equal(link('Web', 'https://example.com'), '[Web](https://example.com)');
  assert.equal(userMention('123'), '<@123>');
  assert.equal(roleMention('456'), '<@&456>');
  assert.equal(channelMention('789'), '<#789>');
  assert.equal(commandMention('help', '101'), '</help:101>');
  assert.equal(commandMention('help'), '`/help`');
  assert.ok(time(new Date(), 'R').startsWith('<t:'));
  assert.ok(timeLongAndRelative(new Date()).includes(':F> (<t:'));
  assert.equal(list(['a', 'b']), '- a\n- b');
  assert.equal(numberedList(['a', 'b']), '1. a\n2. b');
  assert.equal(progressBar(50, 100), '▰▰▰▰▰▱▱▱▱▱ 50%');
  assert.equal(kvLine('Status', 'Active'), `${theme.emojis.dot} **Status:** Active`);
});

test('escapeMarkdown and allowedMentions prevent user input injection', () => {
  const unsafe = 'Hello **everyone** `code` <@12345> [link](url) # heading';
  const safe = escapeMarkdown(unsafe);
  assert.ok(!safe.includes('**'));
  assert.ok(safe.includes('\\*\\*'));
  assert.ok(safe.includes('\\`'));
  assert.ok(safe.includes('\\['));
  assert.deepEqual(allowedMentionsNone, { parse: [] });
});

test('truncate handles limits without cutting mentions or code blocks', () => {
  const longText = 'A'.repeat(5000);
  const truncated = truncate(longText, 200);
  assert.ok(truncated.length <= 200);
  assert.ok(truncated.endsWith('...'));

  const textWithCode = 'Here is code ```js\nconst secret = 42;\n``` more text';
  const cutCode = truncate(textWithCode, 28);
  assert.ok(cutCode.includes('```'));
});

test('buildContainer produces compliant Components V2 payload with NO sidebar color', () => {
  const payload = buildContainer({
    title: 'Container Title',
    lines: ['Line 1', 'Line 2'],
    footer: 'Footer subtext'
  });

  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(payload.components.length, 1);
  const json = payload.components[0].toJSON();
  assert.ok(json.components.length >= 2);
  assert.equal(json.accent_color, undefined, 'Container must have NO sidebar color strip');
});

test('Cards return single ContainerBuilder with IsComponentsV2 flag', () => {
  const sc = successCard({ title: 'Done', lines: ['Saved successfully'] });
  assert.equal(sc.flags, MessageFlags.IsComponentsV2);

  const ec = errorCard({ title: 'Failed', reason: 'Timeout', fix: 'Retry' });
  assert.equal(ec.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);

  const wc = warnCard({ title: 'Caution', lines: ['Low memory'] });
  assert.equal(wc.flags, MessageFlags.IsComponentsV2);

  const ic = infoCard({ title: 'Note', lines: ['Informational text'] });
  assert.equal(ic.flags, MessageFlags.IsComponentsV2);

  const cc = confirmCard({ title: 'Are you sure?', text: 'Irreversible action' });
  assert.equal(cc.flags, MessageFlags.IsComponentsV2);

  const pc = paginatedCard({ title: 'Pages', pages: ['Page 1 content', 'Page 2 content'], currentPage: 1, totalPages: 2 });
  assert.equal(pc.flags, MessageFlags.IsComponentsV2);

  const panel = panelCard({
    title: 'AutoMod Settings',
    isEnabled: true,
    statusLines: [kvLine('Anti-Spam', 'Active')],
    buttons: [createButton({ customId: 'toggle', label: 'Disable', style: ButtonStyle.Danger })]
  });
  assert.equal(panel.flags, MessageFlags.IsComponentsV2);
});

test('Component creation helpers produce valid Discord builders', () => {
  const btn = createButton({ id: 'btn_1', label: 'Click', style: 'primary', emoji: '⚡' });
  const btnJson = btn.toJSON();
  assert.equal(btnJson.custom_id, 'btn_1');
  assert.equal(btnJson.label, 'Click');
  assert.equal(btnJson.style, ButtonStyle.Primary);

  const strSel = createStringSelect({ id: 'sel_1', placeholder: 'Choose...', options: [{ label: 'Opt 1', value: '1' }] });
  const strSelJson = strSel.toJSON();
  assert.equal(strSelJson.custom_id, 'sel_1');
  assert.equal(strSelJson.options.length, 1);

  const chanSel = createChannelSelect({ id: 'chan_1', placeholder: 'Pick channel' });
  assert.equal(chanSel.toJSON().custom_id, 'chan_1');

  const roleSel = createRoleSelect({ id: 'role_1', placeholder: 'Pick role' });
  assert.equal(roleSel.toJSON().custom_id, 'role_1');

  const modal = createModal({
    id: 'modal_1',
    title: 'Edit Config',
    fields: [
      { id: 'f_name', label: 'Name', placeholder: 'Enter name', required: true },
      { id: 'f_bio', label: 'Bio', paragraph: true, required: false }
    ]
  });
  const modalJson = modal.toJSON();
  assert.equal(modalJson.custom_id, 'modal_1');
  assert.equal(modalJson.components.length, 2);
});
