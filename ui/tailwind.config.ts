import animate from 'tailwindcss-animate'
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx,jsx,js}'],
  darkMode: ['class', ':root.dark'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        border: 'var(--border)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        accent: 'var(--accent)',
        'accent-2': 'var(--accent-2)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)'
      },
      borderRadius: {
        xl: 'var(--radius-lg)',
        lg: 'var(--radius-md)',
        md: 'var(--radius-sm)'
      },
      boxShadow: {
        soft: 'var(--shadow)'
      },
      backdropBlur: {
        md: 'var(--blur-md)',
        lg: 'var(--blur-lg)'
      },
      transitionTimingFunction: {
        elegant: 'var(--ease)'
      },
      transitionDuration: {
        fast: 'var(--dur-fast)',
        mid: 'var(--dur-mid)',
        slow: 'var(--dur-slow)'
      },
      fontFamily: {
        sans: [
          'Inter',
          'Noto Sans SC',
          'PingFang SC',
          'Microsoft YaHei',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif'
        ]
      }
    }
  },
  plugins: [animate]
}

export default config
