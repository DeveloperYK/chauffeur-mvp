import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env().LOG_LEVEL,
  redact: {
    paths: [
      'password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      '*.password',
      '*.passwordHash',
      '*.token',
      'phone',
      '*.phone',
      'whatsappNumber',
      '*.whatsappNumber',
      'mobile',
      '*.mobile',
    ],
    censor: '[redacted]',
  },
  base: { service: 'chauffeur-mvp' },
});

export type Logger = typeof logger;
