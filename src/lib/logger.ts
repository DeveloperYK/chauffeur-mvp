import pino from 'pino';
import { env } from './env';
import { PINO_REDACT_PATHS, REDACTED } from './redaction';

export const logger = pino({
  level: env().LOG_LEVEL,
  redact: {
    paths: PINO_REDACT_PATHS,
    censor: REDACTED,
  },
  base: { service: 'chauffeur-mvp' },
});

export type Logger = typeof logger;
