/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        canvas: '#FBFAFD',
        ink: '#1A0B33',
        line: {
          DEFAULT: '#E8E3F0',
          strong: '#E0D8EC',
        },
        brand: {
          DEFAULT: '#7B2FF2',
          dark: '#6A22E0',
          deep: '#2A0066',
          light: '#F1E8FD',
          tint: '#F3EFFA',
        },
        lavender: {
          DEFAULT: '#F7F4FB',
          deep: '#F1EDF7',
        },
        magenta: '#B145F0',
        mint: {
          DEFAULT: '#E3F6EA',
          deep: '#0E9F4F',
        },
        success: {
          DEFAULT: '#0E9F4F',
          tint: '#E3F6EA',
        },
        danger: {
          DEFAULT: '#E0313A',
          tint: '#FDE6E6',
        },
        warn: {
          DEFAULT: '#8A5A00',
          tint: '#FDF0D5',
        },
        // Neutral scale re-mapped onto the violet-grey text and surface tokens so
        // existing text-neutral-* / border-neutral-* classes pick up the new theme.
        neutral: {
          50: '#FBFAFD',
          100: '#F7F4FB',
          200: '#E8E3F0',
          300: '#E0D8EC',
          400: '#8A80A0',
          500: '#8A80A0',
          600: '#4A3D63',
          700: '#4A3D63',
          800: '#2A1F45',
          900: '#1A0B33',
        },
        red: {
          50: '#FDE6E6',
          100: '#FDE6E6',
          200: '#F7C4C6',
          300: '#F0A0A4',
          500: '#E0313A',
          600: '#E0313A',
          700: '#B3242B',
        },
        amber: {
          50: '#FDF0D5',
          100: '#FDF0D5',
          300: '#F2D28A',
          500: '#C98A00',
          600: '#A86F00',
          700: '#8A5A00',
          800: '#8A5A00',
          900: '#6B4600',
        },
      },
      borderRadius: {
        card: '18px',
        'card-lg': '20px',
        input: '10px',
        pill: '999px',
      },
      boxShadow: {
        primary: '0 12px 28px -14px rgba(123,47,242,.8)',
        card: '0 1px 2px rgba(26,11,51,.04)',
      },
      letterSpacing: {
        tightest: '-0.03em',
      },
    },
  },
  plugins: [],
}
