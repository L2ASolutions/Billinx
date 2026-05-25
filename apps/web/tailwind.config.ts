import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        green: {
          DEFAULT: '#1D9E75',
          dark: '#0F6E56',
          light: '#E8F7F2',
          50: '#E8F7F2',
          100: '#C5EAD9',
          500: '#1D9E75',
          600: '#0F6E56',
          700: '#0A5040',
        },
        dark: {
          DEFAULT: '#1a1a2e',
          800: '#16213e',
          900: '#1a1a2e',
        },
        surface: '#F4F6F5',
        border: '#E2E8E5',
        muted: '#6B7B74',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
