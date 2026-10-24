import { THEME } from '../ui/theme.js';

/**
 * Central User-Facing Copy Registry
 * Strict rules:
 * - NO technology names (Components V2, Supabase, Postgres, discord.js, canvas)
 * - NO implementation terms (atomic, row locking, FOR UPDATE, SKIP LOCKED, concurrency guard, cache, RPC)
 * - NO heavy "Issue Encountered / Recommended Solution" blocks
 * - NO hardcoded bot names ("Argoni") - bot name is resolved dynamically via THEME.brand.name
 */

export const copy = {
  get botName() {
    return THEME.brand.name || 'Bot';
  },

  common: {
    back: 'Back',
    next: 'Next',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save Changes',
    close: 'Close',
    preview: 'Preview Banner',
    enabled: 'Enabled',
    disabled: 'Disabled',
    active: 'Active',
    inactive: 'Inactive',
    unlimited: 'Unlimited',
    none: 'None',
    custom: 'Custom...',
    loading: 'Processing...',
    selectChoice: 'Select an option...'
  },

  errors: {
    notYourPanel: (ownerId, cmd = '') => {
      const target = ownerId ? `<@${ownerId}>` : 'the user who opened it';
      const fallback = cmd ? `Run ${cmd} to open your own.` : 'Run the command to open your own.';
      return `Only ${target} can use this panel.\n-# ${fallback}`;
    },
    missingPermission: (perm = 'Manage Server') => `You need **${perm}** to perform this action.`,
    staffOnly: 'This action is restricted to server staff.',
    participantOnly: 'Only the customer or server staff can use these controls.',
    panelExpired: 'This interactive session expired. Run the command again to open a new one.',
    generic: (errorId) => errorId ? `Please try again. Error ID: \`${errorId}\`` : 'An unexpected error occurred. Please try again.',
    guildOnly: 'This command can only be used in a Discord server.',
    rateLimited: 'You are doing that too fast. Please wait a moment.'
  },

  shop: {
    wizard: {
      title: 'Shop Setup',
      step1: {
        subtitle: 'Step 1 of 8 · Turn your shop on or off',
        desc: 'Choose whether your shop is open for customers. You can change this at any time.',
        dropdownPlaceholder: 'Select shop status',
        statusText: (enabled) => `Status: **${enabled ? 'Enabled' : 'Disabled'}**`
      },
      step2: {
        subtitle: 'Step 2 of 8 · Product categories',
        desc: 'Select existing Discord categories where product channels should be created, or create a new one.',
        selectPlaceholder: 'Select Discord category',
        createOption: 'Create new category...'
      },
      step3: {
        subtitle: 'Step 3 of 8 · Store currency',
        desc: 'Select your preferred default currency for product pricing and checkouts.',
        dropdownPlaceholder: 'Select default currency'
      },
      step4: {
        subtitle: 'Step 4 of 8 · Payment methods',
        desc: 'Select accepted payment options for customer purchases.',
        dropdownPlaceholder: 'Choose accepted payment methods'
      },
      step5: {
        subtitle: 'Step 5 of 8 · Orders & ticket settings',
        desc: 'Configure order ticket channels, support roles, and automated order closure.',
        categoryPlaceholder: 'Select ticket category',
        rolesPlaceholder: 'Select staff support roles'
      },
      step6: {
        subtitle: 'Step 6 of 8 · Notification channels',
        desc: 'Select channels for order logs, delivered orders, customer reviews, and restocks.',
        ordersLogPlaceholder: 'Select orders log channel',
        deliveryLogPlaceholder: 'Select delivery log channel',
        vouchPlaceholder: 'Select vouch/reviews channel',
        restockPlaceholder: 'Select restock announcement channel'
      },
      step7: {
        subtitle: 'Step 7 of 8 · Banner appearance',
        desc: 'Customize banner themes, accent styles, and stock badge settings.',
        themePlaceholder: 'Select banner color theme',
        stockDisplayPlaceholder: 'Select stock display mode'
      },
      step8: {
        subtitle: 'Step 8 of 8 · Review & confirm setup',
        desc: 'Review your shop configuration. Click Confirm to activate your shop settings.',
        jumpDropdownPlaceholder: 'Jump to a step to edit...'
      }
    },
    add: {
      title: 'Add New Product',
      desc: 'Follow the steps to configure and publish a new product in your shop.',
      categoryPlaceholder: 'Select category for this product',
      stockTypePlaceholder: 'Select stock management type',
      deliveryModePlaceholder: 'Select delivery mode (automatic or manual)',
      limitPlaceholder: 'Select maximum items per order'
    },
    restock: {
      title: 'Restock Inventory',
      desc: 'Select a product to restock and enter new inventory details.',
      productPlaceholder: 'Choose a product to restock'
    },
    card: {
      inStock: 'IN STOCK',
      outOfStock: 'SOLD OUT',
      buyNow: 'Buy Now',
      details: 'Details / FAQ',
      price: (amount, symbol) => `**Price:** ${symbol}${amount}`,
      stock: (count, isUnlimited) => `**Stock:** ${isUnlimited ? '🟢 Available (Unlimited)' : (count > 0 ? `🟢 ${count} available` : '🔴 Sold Out')}`
    }
  },

  permify: {
    title: 'Role & Permissions Manager',
    desc: 'Configure staff role hierarchy, manager overrides, and administrative permissions.',
    dropdownPlaceholder: 'Select roles to manage'
  },

  antinuke: {
    title: 'Server Protection',
    desc: 'Configure automated anti-nuke triggers, action thresholds, and punishment actions.',
    statusPlaceholder: 'Protection status',
    punishmentPlaceholder: 'Select punishment action'
  },

  automod: {
    title: 'Automated Moderation',
    desc: 'Enable filters for spam, invites, mass mentions, and prohibited words.',
    rulesPlaceholder: 'Select moderation rules to enable'
  },

  tickets: {
    title: 'Support Tickets',
    desc: 'Configure support ticket categories, staff roles, and automated transcripts.',
    categoryPlaceholder: 'Select ticket category'
  }
};

export default copy;
