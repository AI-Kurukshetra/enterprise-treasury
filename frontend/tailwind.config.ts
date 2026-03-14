import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './features/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))'
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))'
        },
        danger: {
          DEFAULT: 'hsl(var(--danger))',
          foreground: 'hsl(var(--danger-foreground))'
        },
        treasury: {
          ink: '#19212b',
          slate: '#313c49',
          mist: '#eef3f5',
          copper: '#a86a37',
          teal: '#0f766e',
          sand: '#d9c6aa'
        }
      },
      borderRadius: {
        xl: '1.25rem',
        '2xl': '1.75rem'
      },
      boxShadow: {
        panel: '0 18px 50px rgba(22, 29, 37, 0.08)',
        inset: 'inset 0 1px 0 rgba(255, 255, 255, 0.35)'
      },
      fontFamily: {
        sans: ['var(--font-plex-sans)'],
        serif: ['var(--font-instrument-serif)'],
        mono: ['var(--font-plex-mono)']
      },
      backgroundImage: {
        grid: 'linear-gradient(to right, rgba(29, 41, 56, 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(29, 41, 56, 0.08) 1px, transparent 1px)',
        'radial-panel': 'radial-gradient(circle at top left, rgba(168, 106, 55, 0.18), transparent 30%), radial-gradient(circle at top right, rgba(15, 118, 110, 0.12), transparent 28%)'
      },
      keyframes: {
        reveal: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        pulseLine: {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '1' }
        }
      },
      animation: {
        reveal: 'reveal 0.6s ease-out both',
        pulseLine: 'pulseLine 3.2s ease-in-out infinite'
      }
    }
  },
  plugins: []
};

export default config;
