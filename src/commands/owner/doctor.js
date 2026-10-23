import { ActionRowBuilder, MessageFlags } from 'discord.js';
import { runDiagnostics } from '../../../scripts/doctor.js';
import { ComponentBuilder } from '../../ui/builder.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import { componentRegistry } from '../../structures/ComponentRegistry.js';

export default {
  name: 'doctor',
  aliases: ['health', 'diagnostics'],
  description: 'Run comprehensive system health, dependency, and database diagnostics (Owner only)',
  category: 'owner',
  ownerOnly: true,
  cooldown: 5,
  async execute(ctx) {
    await ctx.deferReply(true);

    const results = await runDiagnostics();
    const payload = renderDoctorCard(results);
    return ctx.editReply(payload);
  }
};

/**
 * Builds the Components V2 status card for /doctor output
 * @param {object} results Diagnostic results from runDiagnostics()
 * @returns {object} Discord message payload
 */
export function renderDoctorCard(results) {
  const builder = ComponentBuilder.create().setEphemeral(true);

  builder.setTitle('Argoni System Doctor Diagnostics', '🩺');
  builder.setSubtitle(
    `Diagnostic check run at ${new Date(results.timestamp).toLocaleTimeString()} • ` +
    `Overall Status: **${results.passed ? 'ALL SYSTEMS OPERATIONAL' : 'ISSUES DETECTED'}**`
  );
  builder.addSeparator();

  const lines = results.checks.map(c => {
    const icon = c.status === 'PASS' ? '🟢' : (c.status === 'WARN' ? '🟡' : '🔴');
    return `${icon} **${c.name}**: \`${c.status}\`\n-# ${c.details}`;
  });

  builder.addText(lines.join('\n\n'));
  builder.addSeparator();

  // Control Buttons Row (Pure grey buttons via greyButton helper)
  const buttonsRow = new ActionRowBuilder().addComponents(
    greyButton({ id: 'doctor:rerun', label: 'Rerun Diagnostics', emoji: '🔄' }),
    greyButton({ id: 'doctor:dismiss', label: 'Close', emoji: '✖️' })
  );

  builder.actionRows.push(buttonsRow);
  return builder.build();
}

// Register interactive button handlers
componentRegistry.register({
  customId: 'doctor:rerun',
  authorOnly: true,
  async execute(interaction) {
    await interaction.deferUpdate();
    const results = await runDiagnostics();
    const payload = renderDoctorCard(results);
    return interaction.editReply(payload);
  }
});

componentRegistry.register({
  customId: 'doctor:dismiss',
  authorOnly: true,
  async execute(interaction) {
    return interaction.deleteReply().catch(() => {
      return interaction.editReply({
        components: [],
        flags: MessageFlags.IsComponentsV2
      });
    });
  }
});
