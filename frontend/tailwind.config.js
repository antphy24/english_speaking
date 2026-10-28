/** @type {import('tailwindcss').Config} */

// Colours come from CSS variables (see src/index.css) so the same class works in light and
// dark mode, e.g. `bg-surface text-ink border-line`. Values are "R G B" so opacity
// modifiers like `bg-brand/10` still work.
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        // Old screens use `slate-850`, which Tailwind does not have, so those borders never showed.
        slate: { 850: '#172033' },

        canvas: token('canvas'),          // page background
        surface: {
          DEFAULT: token('surface'),      // cards, sidebar
          muted: token('surface-muted'),  // subtle fills, table headers, recorder bar
        },
        line: {
          DEFAULT: token('line'),         // borders
          strong: token('line-strong'),   // input borders
        },
        ink: {
          DEFAULT: token('ink'),          // main text
          muted: token('ink-muted'),      // secondary text
          subtle: token('ink-subtle'),    // hints, captions
        },
        brand: {
          DEFAULT: token('brand'),        // buttons, active states
          hover: token('brand-hover'),
          tint: token('brand-tint'),      // selected backgrounds
          ink: token('brand-ink'),        // brand-coloured text
          ring: token('brand-ring'),      // focus ring
        },
        success: { DEFAULT: token('success'), tint: token('success-tint') },
        warning: { DEFAULT: token('warning'), tint: token('warning-tint') },
        danger: {
          DEFAULT: token('danger'),       // danger text and icons
          solid: token('danger-solid'),   // record button, destructive buttons
          tint: token('danger-tint'),
        },
      },
      boxShadow: {
        card: '0 1px 2px rgb(16 24 40 / 0.04)',
        pop: '0 12px 32px rgb(16 24 40 / 0.14)',
        mic: '0 6px 16px rgb(52 70 212 / 0.25)',
      },
      keyframes: {
        'mic-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(217 45 32 / 0.35)' },
          '100%': { boxShadow: '0 0 0 18px rgb(217 45 32 / 0)' },
        },
        'level-bar': {
          '0%, 100%': { transform: 'scaleY(0.3)' },
          '50%': { transform: 'scaleY(1)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'mic-ring': 'mic-ring 1.6s ease-out infinite',
        'level-bar': 'level-bar 1s ease-in-out infinite',
        'toast-in': 'toast-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
}
