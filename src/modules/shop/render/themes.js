/**
 * Curated theme definitions and color palettes for Shop Banners
 */
export const THEMES = {
  dark: {
    name: 'Dark Luxe',
    bgStart: '#0B0F19',
    bgEnd: '#1E1B4B',
    accent: '#6366F1',
    accentGlow: 'rgba(99, 102, 241, 0.35)',
    textColor: '#FFFFFF',
    textMuted: '#94A3B8',
    cardBg: 'rgba(255, 255, 255, 0.05)',
    cardBorder: 'rgba(255, 255, 255, 0.1)',
    badgeBg: 'rgba(99, 102, 241, 0.15)',
    dotColor: 'rgba(255, 255, 255, 0.04)'
  },
  light: {
    name: 'Clean Slate',
    bgStart: '#F8FAFC',
    bgEnd: '#E2E8F0',
    accent: '#4F46E5',
    accentGlow: 'rgba(79, 70, 229, 0.25)',
    textColor: '#0F172A',
    textMuted: '#64748B',
    cardBg: 'rgba(255, 255, 255, 0.8)',
    cardBorder: 'rgba(15, 23, 42, 0.08)',
    badgeBg: 'rgba(79, 70, 229, 0.1)',
    dotColor: 'rgba(15, 23, 42, 0.03)'
  },
  neon: {
    name: 'Cyberpunk Neon',
    bgStart: '#090014',
    bgEnd: '#240046',
    accent: '#FF007F',
    accentGlow: 'rgba(255, 0, 127, 0.45)',
    textColor: '#00F0FF',
    textMuted: '#E0AAFF',
    cardBg: 'rgba(255, 0, 127, 0.08)',
    cardBorder: 'rgba(0, 240, 255, 0.3)',
    badgeBg: 'rgba(0, 240, 255, 0.15)',
    dotColor: 'rgba(0, 240, 255, 0.05)'
  },
  minimal: {
    name: 'Carbon Minimal',
    bgStart: '#121214',
    bgEnd: '#1C1C21',
    accent: '#D4D4D8',
    accentGlow: 'rgba(212, 212, 216, 0.2)',
    textColor: '#FAFAFA',
    textMuted: '#A1A1AA',
    cardBg: 'rgba(255, 255, 255, 0.03)',
    cardBorder: 'rgba(255, 255, 255, 0.07)',
    badgeBg: 'rgba(255, 255, 255, 0.08)',
    dotColor: 'rgba(255, 255, 255, 0.02)'
  },
  ava: {
    name: 'AVA Pastel Pink',
    bgStart: '#1A0E18',
    bgEnd: '#33152B',
    accent: '#FFB7D5',
    accentGlow: 'rgba(255, 183, 213, 0.4)',
    textColor: '#FFF0F5',
    textMuted: '#C9B6FF',
    cardBg: 'rgba(255, 183, 213, 0.08)',
    cardBorder: 'rgba(255, 183, 213, 0.25)',
    badgeBg: 'rgba(255, 183, 213, 0.18)',
    dotColor: 'rgba(255, 183, 213, 0.06)'
  }
};

export const STATUS_COLORS = {
  IN_STOCK: {
    label: 'IN STOCK',
    bg: '#059669',
    text: '#FFFFFF'
  },
  LOW_STOCK: {
    label: 'LOW STOCK',
    bg: '#D97706',
    text: '#FFFFFF'
  },
  SOLD_OUT: {
    label: 'SOLD OUT',
    bg: '#DC2626',
    text: '#FFFFFF'
  },
  COMING_SOON: {
    label: 'COMING SOON',
    bg: '#2563EB',
    text: '#FFFFFF'
  },
  PAUSED: {
    label: 'PAUSED',
    bg: '#4B5563',
    text: '#FFFFFF'
  }
};

export function getTheme(themeName) {
  return THEMES[themeName?.toLowerCase()] || THEMES.dark;
}

export default {
  THEMES,
  STATUS_COLORS,
  getTheme
};
