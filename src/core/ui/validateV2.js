import { MessageFlags, ComponentType, ButtonStyle } from 'discord.js';
import { logger } from '../../utils/logger.js';

/**
 * Validates a Discord Components V2 message payload against all hard API constraints.
 * Detects:
 * - Missing V2 flag
 * - Illegal content or embeds
 * - Component count > 40
 * - Total text characters > 4000
 * - Buttons per action row > 5
 * - Select menu options > 25
 * - Custom ID length > 100
 * - Button label length > 80
 * - Non-grey buttons (must be Secondary or Link)
 * - Duplicate custom_id collisions on the same message
 *
 * @param {object} payload
 * @param {object} [context={}]
 * @param {number} [context.page]
 * @param {string} [context.module]
 * @returns {{ valid: boolean, errors: string[], counts: object }}
 */
export function validateV2Payload(payload, context = {}) {
  const errors = [];
  const counts = {
    totalComponents: 0,
    totalTextLength: 0,
    actionRows: 0,
    buttons: 0,
    selectMenus: 0,
    textDisplays: 0
  };

  if (!payload || typeof payload !== 'object') {
    return {
      valid: false,
      errors: ['Payload is null or not an object'],
      counts
    };
  }

  // 1. Check Flags
  const flags = payload.flags || 0;
  if ((flags & MessageFlags.IsComponentsV2) !== MessageFlags.IsComponentsV2) {
    errors.push('Flag MessageFlags.IsComponentsV2 is missing in payload');
  }

  // 2. Prohibit top-level content and embeds with V2
  if (payload.content) {
    errors.push('Top-level `content` is strictly forbidden in Components V2');
  }
  if (payload.embeds && Array.isArray(payload.embeds) && payload.embeds.length > 0) {
    errors.push('Top-level `embeds` is strictly forbidden in Components V2');
  }

  const customIdsSeen = new Set();

  function walk(component, path = 'root') {
    if (!component) return;
    counts.totalComponents++;

    // Convert Builder or JSON
    const data = typeof component.toJSON === 'function' ? component.toJSON() : component;
    const type = data.type;

    // Check custom_id uniqueness and length
    if (data.custom_id) {
      if (data.custom_id.length > 100) {
        errors.push(`custom_id exceeds 100 chars at ${path}: "${data.custom_id.slice(0, 30)}..." (${data.custom_id.length} chars)`);
      }
      if (customIdsSeen.has(data.custom_id)) {
        errors.push(`Duplicate custom_id collision at ${path}: "${data.custom_id}"`);
      } else {
        customIdsSeen.add(data.custom_id);
      }
    }

    // Text Display (Type 10)
    if (type === 10 || data.content) {
      counts.textDisplays++;
      const textLen = (data.content || '').length;
      counts.totalTextLength += textLen;
    }

    // Action Row (Type 1)
    if (type === 1 || type === ComponentType.ActionRow) {
      counts.actionRows++;
      const sub = component.components || data.components || [];
      if (sub.length > 5) {
        errors.push(`ActionRow at ${path} has ${sub.length} components (max 5)`);
      }
    }

    // Button (Type 2)
    if (type === 2) {
      counts.buttons++;
      if (data.label && data.label.length > 80) {
        errors.push(`Button label at ${path} exceeds 80 chars: "${data.label}"`);
      }
      // Must be Secondary (2) or Link (5)
      const style = data.style;
      if (style !== undefined && style !== ButtonStyle.Secondary && style !== ButtonStyle.Link && style !== 2 && style !== 5) {
        errors.push(`Banned button style at ${path}: ${style}. Buttons must strictly be ButtonStyle.Secondary or ButtonStyle.Link`);
      }
    }

    // Select Menus (Types 3, 5, 6, 7, 8)
    if (type === 3 || type === 5 || type === 6 || type === 7 || type === 8) {
      counts.selectMenus++;
      if (data.options && data.options.length > 25) {
        errors.push(`SelectMenu at ${path} has ${data.options.length} options (max 25)`);
      }
    }

    // Recurse into children
    const children = component.components || data.components || [];
    for (let i = 0; i < children.length; i++) {
      walk(children[i], `${path}.components[${i}]`);
    }
  }

  const rootComponents = payload.components || [];
  for (let i = 0; i < rootComponents.length; i++) {
    walk(rootComponents[i], `components[${i}]`);
  }

  // Check cumulative limits
  if (counts.totalComponents > 40) {
    errors.push(`Total components count is ${counts.totalComponents} (hard cap is 40)`);
  }
  if (counts.totalTextLength > 4000) {
    errors.push(`Total text length across all text displays is ${counts.totalTextLength} (hard cap is 4000)`);
  }

  const valid = errors.length === 0;
  if (!valid) {
    logger.error({
      context,
      counts,
      errors
    }, `[V2 VALIDATION FAILED] Page ${context.page || 'unknown'}: ${errors.join('; ')}`);
  }

  return {
    valid,
    errors,
    counts
  };
}

export default validateV2Payload;
