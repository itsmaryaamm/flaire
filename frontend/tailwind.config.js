/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        canvas: '#F7F7F5',
        ink: '#111411',
        brand: {
          DEFAULT: '#0F5132',
          dark: '#0B3D26',
          light: '#E6F4EC',
        },
        mint: {
          DEFAULT: '#B7F0C8',
          deep: '#1F7A4A',
        },
      },
      borderRadius: {
        card: '12px',
      },
    },
  },
  plugins: [],
}
