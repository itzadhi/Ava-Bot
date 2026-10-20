import { startHelpSession } from '../../modules/help/panel.js';

export default {
  name: 'help',
  aliases: ['h', 'commands'],
  description: 'Interactive Components V2 Help Menu and command directory',
  category: 'general',
  cooldown: 3,
  args: [
    {
      name: 'category',
      description: 'Quickly view commands in a specific category',
      type: 'string',
      required: false
    }
  ],
  async execute(ctx) {
    return startHelpSession(ctx);
  }
};
