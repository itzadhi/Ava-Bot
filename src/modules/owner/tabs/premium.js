import { ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { grantGuildTier, revokeGuildTier, createPremiumCode, listRecentCodes } from '../../../db/premium.js';
import { getGuildSettings } from '../../../db/guilds.js';
import { generateShortId } from '../../../utils/id.js';
import { logAudit } from '../../../db/audit.js';

export const premiumTab = {
  id: 'premium',
  label: 'Premium',
  async render({ state }) {
    const codes = await listRecentCodes(5);
    const codeLines = codes.map(c => 
      `• \`${c.code}\` — **${c.tier.toUpperCase()}** (${c.duration_days}d, ${c.uses_left} uses left)`
    );

    const body = [
      '**Recent Generated License Codes**:',
      codeLines.length > 0 ? codeLines.join('\n') : '_No codes generated yet._'
    ].join('\n');

    return {
      body,
      subtext: 'License Management & Guild Tier Overrides'
    };
  },

  buttons({ state }) {
    return [
      new ButtonBuilder()
        .setCustomId(`owner:premium:grant_modal:${state.sessionId}`)
        .setLabel('Grant Tier')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`owner:premium:revoke_modal:${state.sessionId}`)
        .setLabel('Revoke Tier')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`owner:premium:check_modal:${state.sessionId}`)
        .setLabel('Check Guild')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`owner:premium:code_modal:${state.sessionId}`)
        .setLabel('Generate Code')
        .setStyle(ButtonStyle.Success)
    ];
  },

  async handleAction({ action, interaction, state }) {
    if (action === 'grant_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:premium:grant_submit:${state.sessionId}`)
        .setTitle('Grant Premium Tier');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('guild_id').setLabel('Guild ID').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('tier').setLabel('Tier: pro OR ultimate').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('duration').setLabel('Duration in days (e.g. 30, 365)').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return { modalShown: true };
    }

    if (action === 'revoke_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:premium:revoke_submit:${state.sessionId}`)
        .setTitle('Revoke Premium Tier');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('guild_id').setLabel('Guild ID').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return { modalShown: true };
    }

    if (action === 'check_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:premium:check_submit:${state.sessionId}`)
        .setTitle('Check Guild Tier');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('guild_id').setLabel('Guild ID').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return { modalShown: true };
    }

    if (action === 'code_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:premium:code_submit:${state.sessionId}`)
        .setTitle('Generate Premium Code');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('tier').setLabel('Tier: pro OR ultimate').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('duration').setLabel('Duration in days (e.g. 30, 365)').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('uses').setLabel('Maximum Uses (default 1)').setStyle(TextInputStyle.Short).setRequired(false)
        )
      );
      await interaction.showModal(modal);
      return { modalShown: true };
    }

    return {};
  },

  async handleModalSubmit({ action, interaction, state }) {
    if (action === 'grant_submit') {
      const guildId = interaction.fields.getTextInputValue('guild_id')?.trim();
      const tier = interaction.fields.getTextInputValue('tier')?.trim().toLowerCase();
      const days = parseInt(interaction.fields.getTextInputValue('duration')?.trim() || '30', 10);

      if (!['pro', 'ultimate'].includes(tier)) {
        return { status: 'Error: Tier must be either "pro" or "ultimate"' };
      }

      await grantGuildTier(guildId, tier, days);
      await logAudit({
        userId: interaction.user.id,
        action: 'OWNER_GRANT_PREMIUM',
        details: { guildId, tier, days }
      });
      return { status: `Successfully granted ${tier.toUpperCase()} to guild ${guildId} for ${days} days` };
    }

    if (action === 'revoke_submit') {
      const guildId = interaction.fields.getTextInputValue('guild_id')?.trim();
      await revokeGuildTier(guildId);
      await logAudit({
        userId: interaction.user.id,
        action: 'OWNER_REVOKE_PREMIUM',
        details: { guildId }
      });
      return { status: `Successfully revoked premium tier for guild ${guildId}` };
    }

    if (action === 'check_submit') {
      const guildId = interaction.fields.getTextInputValue('guild_id')?.trim();
      const settings = await getGuildSettings(guildId);
      return {
        status: `Guild ${guildId}: Tier ${settings.premium_tier.toUpperCase()} | Until: ${settings.premium_until || 'Never'}`
      };
    }

    if (action === 'code_submit') {
      const tier = interaction.fields.getTextInputValue('tier')?.trim().toLowerCase();
      const days = parseInt(interaction.fields.getTextInputValue('duration')?.trim() || '30', 10);
      const uses = parseInt(interaction.fields.getTextInputValue('uses')?.trim() || '1', 10);

      if (!['pro', 'ultimate'].includes(tier)) {
        return { status: 'Error: Tier must be either "pro" or "ultimate"' };
      }

      const code = `ARGONI-${tier.toUpperCase()}-${generateShortId(4, 2)}`;
      await createPremiumCode({
        code,
        tier,
        duration_days: days,
        uses_left: isNaN(uses) ? 1 : uses,
        created_by: interaction.user.id
      });

      await logAudit({
        userId: interaction.user.id,
        action: 'OWNER_CREATE_CODE',
        details: { code, tier, days, uses }
      });

      return { status: `Generated Code: ${code} (${tier.toUpperCase()}, ${days}d, ${uses} uses)` };
    }

    return {};
  }
};

export default premiumTab;
