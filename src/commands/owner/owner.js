import { openOwnerPanel } from '../../modules/owner/panel.js';

export default {
  name: 'owner',
  aliases: ['ao', 'adminops', 'host'],
  description: 'Open the AVA Owner Control Panel (Bot Owner only)',
  category: 'owner',
  ownerOnly: true,
  cooldown: 3,
  async execute(ctx) {
    return openOwnerPanel(ctx);
  }
};
