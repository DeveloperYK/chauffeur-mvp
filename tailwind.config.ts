import forms from '@tailwindcss/forms';
import type { Config } from 'tailwindcss';

/**
 * Atlassian Design System–inspired palette and scale.
 * Reference: https://atlassian.design/foundations/color-new
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces
        surface: {
          DEFAULT: '#FFFFFF',
          sunken: '#F7F8F9',
          raised: '#FFFFFF',
          overlay: '#FFFFFF',
        },
        // Borders
        border: {
          DEFAULT: '#DCDFE4',
          subtle: '#E9EBEE',
          bold: '#091E4224',
        },
        // Text
        ink: {
          DEFAULT: '#172B4D',
          subtle: '#44546F',
          muted: '#626F86',
          disabled: '#8590A2',
          inverse: '#FFFFFF',
        },
        // Brand blue
        brand: {
          50: '#E9F2FF',
          100: '#CCE0FF',
          200: '#85B8FF',
          300: '#579DFF',
          400: '#388BFF',
          500: '#1D7AFC',
          600: '#0C66E4',
          700: '#0055CC',
          800: '#09326C',
          900: '#082145',
        },
        // Status accents
        success: {
          50: '#DCFFF1',
          100: '#BAF3DB',
          500: '#22A06B',
          700: '#1F845A',
          900: '#164B35',
        },
        warning: {
          50: '#FFF7D6',
          100: '#F8E6A0',
          500: '#E2B203',
          700: '#946F00',
          900: '#533F04',
        },
        danger: {
          50: '#FFEDEB',
          100: '#FFD5D2',
          500: '#E2483D',
          700: '#C9372C',
          900: '#5D1F1A',
        },
        info: {
          50: '#E9F2FF',
          100: '#CCE0FF',
          500: '#1D7AFC',
          700: '#0055CC',
        },
        neutral: {
          50: '#F7F8F9',
          100: '#F1F2F4',
          200: '#DCDFE4',
          300: '#B3B9C4',
          400: '#8590A2',
          500: '#758195',
          600: '#626F86',
          700: '#44546F',
          800: '#2C3E5D',
          900: '#172B4D',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          '"Liberation Mono"',
          'monospace',
        ],
      },
      borderRadius: {
        sm: '3px',
        DEFAULT: '6px',
        md: '8px',
        lg: '12px',
      },
      boxShadow: {
        card: '0 1px 1px rgba(9,30,66,0.25), 0 0 1px rgba(9,30,66,0.31)',
        'card-hover': '0 4px 8px -2px rgba(9,30,66,0.25), 0 0 1px rgba(9,30,66,0.31)',
        overlay: '0 8px 12px rgba(9,30,66,0.15), 0 0 1px rgba(9,30,66,0.31)',
        focus: '0 0 0 2px #4C9AFF',
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
      },
    },
  },
  plugins: [forms({ strategy: 'class' })],
};

export default config;
