import { routeInteraction } from '../core/interactions/router.js';

/**
 * Global interactionCreate gateway event listener.
 * Routes every interaction through the central /core/interactions router.
 * @param {import('discord.js').Interaction} interaction
 */
export async function onInteractionCreate(interaction) {
  return routeInteraction(interaction);
}

export default onInteractionCreate;
