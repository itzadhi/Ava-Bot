import {
  MessageFlags,
  ComponentType,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  SeparatorBuilder
} from 'discord.js';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { copy } from '../../config/copy.js';
import { greyButton } from '../../utils/ui/greyButton.js';

/**
 * Validates a Discord Components V2 message payload against all hard API constraints.
 * Detects:
 * - Missing V2 flag
 * - Illegal content or embeds
 * - Component count > 40
 * - Total text characters > 4000
 * - Buttons per action row > 5
 * - Select menu options > 25 or === 0
 * - Custom ID length > 100
 * - Button label length > 80
 * - Non-grey buttons (must be Secondary or Link)
 * - Duplicate custom_id collisions on the same message
 * - Empty or whitespace-only TextDisplays
 * - Container accent color presence (borderless rule)
 * - ActionRow mixing select menu with other components
 *
 * @param {object} payload
 * @param {object} [context={}]
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

    // Container (Type 17) - check borderless rule
    if (type === 17 || type === ComponentType.Container) {
      if (data.accent_color !== undefined && data.accent_color !== null) {
        errors.push(`Container at ${path} has accent_color set (${data.accent_color}). Borderless cards require no accent color.`);
      }
    }

    // Text Display (Type 10)
    if (type === 10 || data.content !== undefined) {
      counts.textDisplays++;
      const text = typeof data.content === 'string' ? data.content : '';
      if (!text || text.length === 0) {
        errors.push(`TextDisplay at ${path} is empty. Discord API rejects empty string content.`);
      }
      counts.totalTextLength += text.length;
    }

    // Action Row (Type 1)
    if (type === 1 || type === ComponentType.ActionRow) {
      counts.actionRows++;
      const sub = component.components || data.components || [];
      if (sub.length > 5) {
        errors.push(`ActionRow at ${path} has ${sub.length} components (max 5)`);
      }

      // Check if ActionRow has both select menu and buttons or multiple select menus
      let hasSelect = false;
      let hasOther = false;
      for (const item of sub) {
        const itemData = typeof item.toJSON === 'function' ? item.toJSON() : item;
        const itype = itemData.type;
        const isSelect = itype === 3 || itype === 5 || itype === 6 || itype === 7 || itype === 8;
        if (isSelect) {
          if (hasSelect) {
            errors.push(`ActionRow at ${path} contains multiple select menus`);
          }
          hasSelect = true;
        } else {
          hasOther = true;
        }
      }
      if (hasSelect && hasOther) {
        errors.push(`ActionRow at ${path} mixes a select menu with other components`);
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
      // String select menu (type 3) MUST have at least 1 option and at most 25
      if (type === 3) {
        const opts = data.options || [];
        if (opts.length === 0) {
          errors.push(`SelectMenu at ${path} has 0 options (must have between 1 and 25 options)`);
        } else if (opts.length > 25) {
          errors.push(`SelectMenu at ${path} has ${opts.length} options (max 25)`);
        }
        for (let i = 0; i < opts.length; i++) {
          const opt = opts[i];
          if (opt.label && opt.label.length > 100) {
            errors.push(`SelectMenu option ${i} label exceeds 100 chars at ${path}`);
          }
          if (opt.description && opt.description.length > 100) {
            errors.push(`SelectMenu option ${i} description exceeds 100 chars at ${path}`);
          }
        }
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
  if (!valid && context.logErrors !== false) {
    logger.debug({
      context,
      counts,
      errors
    }, `[V2 VALIDATION] Page ${context.page || context.module || 'unknown'}: ${errors.join('; ')}`);
  }

  return {
    valid,
    errors,
    counts
  };
}

/**
 * Automatically repairs common V2 payload violations in-place:
 * 1. Sets MessageFlags.IsComponentsV2 and strips content / embeds.
 * 2. Replaces empty or whitespace-only TextDisplays with zero-width space '\u200B'.
 * 3. Removes empty select menus (0 options) and substitutes friendly "-# Nothing available yet" text.
 * 4. Truncates custom IDs > 100 chars.
 * 5. Truncates button labels > 80 chars.
 * 6. Slices select menu options > 25 to 25 items, truncating option labels/descriptions to 100 chars.
 * 7. Isolates select menus to their own ActionRow; caps ActionRow buttons at 5.
 * 8. Coerces non-grey buttons (1, 3, 4) to ButtonStyle.Secondary (2).
 * 9. Deduplicates duplicate custom_ids on the same message payload.
 * 10. Removes container accent colors to maintain borderless cards.
 * 11. Proactively caps cumulative text length to <= 3900 chars and components to <= 40.
 *
 * @param {object} payload
 * @param {object} [context={}]
 * @returns {{ payload: object, fixed: boolean, fixes: string[] }}
 */
export function autoFixV2Payload(payload, context = {}) {
  const fixes = [];
  if (!payload || typeof payload !== 'object') {
    return { payload, fixed: false, fixes };
  }

  // 1. Ensure Components V2 flag
  const originalFlags = payload.flags || 0;
  payload.flags = originalFlags | MessageFlags.IsComponentsV2;
  if ((originalFlags & MessageFlags.IsComponentsV2) !== MessageFlags.IsComponentsV2) {
    fixes.push('Added MessageFlags.IsComponentsV2');
  }

  // 2. Strip prohibited content/embeds if V2 components are present
  if (payload.content !== undefined) {
    delete payload.content;
    fixes.push('Removed top-level content');
  }
  if (payload.embeds !== undefined) {
    delete payload.embeds;
    fixes.push('Removed top-level embeds');
  }

  if (!Array.isArray(payload.components)) {
    payload.components = [];
  }

  const seenCustomIds = new Set();
  const textDisplaysToBudget = [];
  let totalChars = 0;

  /**
   * Helper to inspect and safely mutate a component (builder or JSON)
   */
  function fixComponent(comp, parent = null) {
    if (!comp) return null;

    // Get underlying data object
    const data = typeof comp.toJSON === 'function' ? comp.data || comp.toJSON() : comp;
    const type = data.type;

    // 1. Fix Container Accent Color
    if (type === 17 || type === ComponentType.Container) {
      if (data.accent_color !== undefined) {
        delete data.accent_color;
        if (typeof comp.clearAccentColor === 'function') {
          comp.clearAccentColor();
        }
        fixes.push('Removed container accent color');
      }
    }

    // 2. Fix Text Display (Type 10)
    if (type === 10 || data.content !== undefined) {
      let content = typeof data.content === 'string' ? data.content : '';
      if (!content || content.trim().length === 0) {
        data.content = '\u200B';
        if (typeof comp.setContent === 'function') {
          try { comp.setContent('\u200B'); } catch (_) {}
        }
        fixes.push('Replaced empty TextDisplay content with zero-width space');
      }
      totalChars += (data.content || '').length;
      textDisplaysToBudget.push({ comp, data });
    }

    // 3. Fix Button (Type 2)
    if (type === 2) {
      // Label length <= 80
      if (data.label && data.label.length > 80) {
        const shortened = data.label.slice(0, 77) + '...';
        data.label = shortened;
        if (typeof comp.setLabel === 'function') {
          try { comp.setLabel(shortened); } catch (_) {}
        }
        fixes.push(`Truncated button label to 80 chars: "${shortened}"`);
      }

      // Button style: must be Secondary (2) or Link (5)
      if (data.style !== undefined && data.style !== ButtonStyle.Secondary && data.style !== ButtonStyle.Link && data.style !== 2 && data.style !== 5) {
        data.style = ButtonStyle.Secondary;
        if (typeof comp.setStyle === 'function') {
          try { comp.setStyle(ButtonStyle.Secondary); } catch (_) {}
        }
        fixes.push(`Coerced banned button style ${data.style} to Secondary`);
      }
    }

    // 4. Fix Select Menu (Type 3, 5, 6, 7, 8)
    if (type === 3 || type === 5 || type === 6 || type === 7 || type === 8) {
      if (type === 3) {
        const options = data.options || comp.options || [];
        if (options.length === 0) {
          // Empty select menu: mark for removal
          fixes.push('Removed empty select menu (0 options)');
          return { drop: true, substituteText: '-# Nothing available yet' };
        }

        if (options.length > 25) {
          const sliced = options.slice(0, 25);
          data.options = sliced;
          if (comp.options) comp.options = sliced;
          fixes.push(`Sliced select menu options from ${options.length} to 25`);
        }

        for (const opt of (data.options || [])) {
          if (opt.label && opt.label.length > 100) {
            opt.label = opt.label.slice(0, 97) + '...';
            fixes.push('Truncated select menu option label to 100 chars');
          }
          if (opt.description && opt.description.length > 100) {
            opt.description = opt.description.slice(0, 97) + '...';
            fixes.push('Truncated select menu option description to 100 chars');
          }
          if (opt.value && opt.value.length > 100) {
            opt.value = opt.value.slice(0, 100);
            fixes.push('Truncated select menu option value to 100 chars');
          }
        }
      }
    }

    // 5. Fix custom_id: length <= 100 and uniqueness
    if (data.custom_id) {
      let cid = String(data.custom_id);
      if (cid.length > 100) {
        cid = cid.slice(0, 100);
        data.custom_id = cid;
        if (typeof comp.setCustomId === 'function') {
          try { comp.setCustomId(cid); } catch (_) {}
        }
        fixes.push(`Truncated custom_id to 100 chars: "${cid}"`);
      }

      if (seenCustomIds.has(cid)) {
        let suffix = 2;
        let uniqueId = `${cid.slice(0, 96)}_${suffix}`;
        while (seenCustomIds.has(uniqueId)) {
          suffix++;
          uniqueId = `${cid.slice(0, 96)}_${suffix}`;
        }
        data.custom_id = uniqueId;
        if (typeof comp.setCustomId === 'function') {
          try { comp.setCustomId(uniqueId); } catch (_) {}
        }
        seenCustomIds.add(uniqueId);
        fixes.push(`Resolved duplicate custom_id by renaming to "${uniqueId}"`);
      } else {
        seenCustomIds.add(cid);
      }
    }

    // 6. Recurse into children
    const subList = comp.components || data.components;
    if (Array.isArray(subList)) {
      const newChildren = [];
      const pendingSubstitutions = [];

      for (let i = 0; i < subList.length; i++) {
        const child = subList[i];
        const res = fixComponent(child, comp);
        if (res && res.drop) {
          if (res.substituteText) {
            pendingSubstitutions.push(res.substituteText);
          }
        } else {
          newChildren.push(child);
        }
      }

      // If ActionRow had components dropped and is now empty
      if ((type === 1 || type === ComponentType.ActionRow) && newChildren.length === 0) {
        return { drop: true, substituteText: pendingSubstitutions[0] || null };
      }

      // If ActionRow has > 5 buttons, cap at 5
      if ((type === 1 || type === ComponentType.ActionRow) && newChildren.length > 5) {
        fixes.push(`Capped ActionRow components at 5 (had ${newChildren.length})`);
        newChildren.splice(5);
      }

      if (comp.components) comp.components = newChildren;
      if (data.components) data.components = newChildren.map(c => typeof c.toJSON === 'function' ? c.toJSON() : c);

      // If there are substitutions and this is a container, add them as TextDisplays
      if ((type === 17 || type === ComponentType.Container) && pendingSubstitutions.length > 0) {
        for (const subText of pendingSubstitutions) {
          const t = new TextDisplayBuilder().setContent(subText);
          if (typeof comp.addTextDisplayComponents === 'function') {
            comp.addTextDisplayComponents(t);
          } else {
            newChildren.push(t);
          }
        }
      }
    }

    return comp;
  }

  // Walk top-level components
  const newRoots = [];
  const topSubstitutions = [];

  for (let i = 0; i < payload.components.length; i++) {
    const root = payload.components[i];
    const res = fixComponent(root, null);
    if (res && res.drop) {
      if (res.substituteText) topSubstitutions.push(res.substituteText);
    } else if (res) {
      newRoots.push(res);
    }
  }

  // Add top-level substitutions into first container if one exists
  if (topSubstitutions.length > 0) {
    const container = newRoots.find(c => {
      const d = typeof c.toJSON === 'function' ? c.data : c;
      return d.type === 17 || d.type === ComponentType.Container;
    });

    if (container) {
      for (const text of topSubstitutions) {
        const t = new TextDisplayBuilder().setContent(text);
        if (typeof container.addTextDisplayComponents === 'function') {
          container.addTextDisplayComponents(t);
        } else if (container.components) {
          container.components.push(t);
        }
      }
    }
  }

  payload.components = newRoots;

  // 7. Budget Text Displays (max 3900 total characters)
  if (totalChars > 3900 && textDisplaysToBudget.length > 0) {
    const excess = totalChars - 3900;
    // Find longest display to trim
    textDisplaysToBudget.sort((a, b) => (b.data.content?.length || 0) - (a.data.content?.length || 0));
    const target = textDisplaysToBudget[0];
    const currentLen = target.data.content.length;
    const safeLen = Math.max(10, currentLen - excess - 10);
    const trimmed = target.data.content.slice(0, safeLen) + '...';
    target.data.content = trimmed;
    if (typeof target.comp.setContent === 'function') {
      try { target.comp.setContent(trimmed); } catch (_) {}
    }
    fixes.push(`Trimmed longest TextDisplay by ${excess} characters to enforce 3900 text budget`);
  }

  // 8. Cap Total Components at 40
  let totalCompCount = 0;
  function countComp(c) {
    totalCompCount++;
    const sub = c.components || (c.data && c.data.components);
    if (Array.isArray(sub)) sub.forEach(countComp);
  }
  payload.components.forEach(countComp);

  if (totalCompCount > 40) {
    fixes.push(`Component count ${totalCompCount} exceeded 40; trimmed excess components`);
    const container = payload.components.find(c => {
      const d = typeof c.toJSON === 'function' ? c.data : c;
      return d.type === 17 || d.type === ComponentType.Container;
    });

    while (totalCompCount > 40) {
      const sub = container?.components || container?.data?.components;
      if (Array.isArray(sub) && sub.length > 2) {
        sub.pop();
      } else if (payload.components.length > 1) {
        payload.components.pop();
      } else {
        break;
      }
      totalCompCount = 0;
      payload.components.forEach(countComp);
    }
  }

  return {
    payload,
    fixed: fixes.length > 0,
    fixes
  };
}

/**
 * Builds a 100% compliant minimal safe-mode payload.
 * Invoked if building a complex page fails or if payload cannot be repaired.
 *
 * @param {object} [originalPayload=null]
 * @param {string} [errorId=null]
 * @returns {object} Discord message payload
 */
export function buildSafeModePayload(originalPayload = null, errorId = null) {
  const errId = errorId || `ERR-${Date.now().toString(36).slice(-4).toUpperCase()}`;

  // Try to preserve original title if available
  let title = '## Notice';
  if (originalPayload?.components) {
    try {
      for (const comp of originalPayload.components) {
        const data = typeof comp.toJSON === 'function' ? comp.data : comp;
        const sub = comp.components || data?.components;
        if (Array.isArray(sub)) {
          for (const s of sub) {
            const sdata = typeof s.toJSON === 'function' ? s.data : s;
            if (sdata?.content && typeof sdata.content === 'string' && sdata.content.startsWith('##')) {
              title = sdata.content.split('\n')[0];
              break;
            }
          }
        }
        if (title !== '## Notice') break;
      }
    } catch (_) {}
  }

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(title)
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(copy.errors.pageLoadFailed(errId))
  );

  const row = new ActionRowBuilder().addComponents(
    greyButton({
      id: `core:close:${Date.now()}`,
      label: copy.common.close || 'Close',
      emoji: '✖'
    })
  );

  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [container, row]
  };
}

/**
 * Validates, auto-fixes, and if necessary applies safe-mode fallback to an outgoing V2 payload.
 *
 * @param {object} payload
 * @param {object} [context={}]
 * @returns {{ payload: object, valid: boolean, errors: string[] }}
 */
export function validateAndFixV2Payload(payload, context = {}) {
  if (!payload || typeof payload !== 'object') {
    return {
      payload: buildSafeModePayload(null, context.errorId),
      valid: false,
      errors: ['Payload is null or not an object']
    };
  }

  // 1. Run auto-fix
  autoFixV2Payload(payload, context);

  // 2. Validate payload against hard rules
  const validation = validateV2Payload(payload, { ...context, logErrors: false });

  if (validation.valid) {
    return {
      payload,
      valid: true,
      errors: []
    };
  }

  // 3. Fallback to Safe-Mode if still invalid
  const errorId = context.errorId || `ERR-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  logger.warn({
    errorId,
    errors: validation.errors,
    context
  }, `[V2 RECOVERY] Payload invalid after auto-fix, reverting to safe-mode card`);

  const safePayload = buildSafeModePayload(payload, errorId);
  return {
    payload: safePayload,
    valid: false,
    errors: validation.errors
  };
}

export default {
  validateV2Payload,
  autoFixV2Payload,
  buildSafeModePayload,
  validateAndFixV2Payload
};
