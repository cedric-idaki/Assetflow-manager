/**
 * SECURITY FIX: Structured logger
 *
 * Replaces all console.log / console.error / console.warn calls throughout
 * the app. In production, debug/info logs are suppressed. Errors are
 * structured for easy ingestion by monitoring services (Sentry, Datadog, etc.)
 *
 * Usage:
 *   import { logger } from '../utils/logger';
 *   logger.info('Payment created', { paymentId, amount });
 *   logger.error('Payment failed', { error: err.message });
 *
 * HOW TO MIGRATE:
 *   console.log(...)      → logger.debug(...)
 *   console.warn(...)     → logger.warn(...)
 *   console.error(...)    → logger.error(...)
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

// Read log level from env; default to 'warn' in production, 'debug' in dev
const configuredLevel =
  import.meta.env?.VITE_LOG_LEVEL ||
  (import.meta.env.PROD ? 'warn' : 'debug');

const currentLevel = LOG_LEVELS[configuredLevel] ?? LOG_LEVELS.warn;

// Optional: hook into an external monitoring service
// Replace this with your actual Sentry / Datadog / LogRocket integration
const sendToMonitoring = (level, message, context) => {
  if (typeof window === 'undefined') return;

  // Example Sentry integration (uncomment when Sentry is installed):
  // if (level === 'error' && window.Sentry) {
  //   window.Sentry.captureMessage(message, { level, extra: context });
  // }
};

const formatEntry = (level, message, context) => ({
  timestamp: new Date().toISOString(),
  level,
  message,
  ...(context && Object.keys(context).length > 0 ? { context } : {}),
  env: import.meta.env.MODE,
});

const emit = (level, message, context = {}) => {
  if (LOG_LEVELS[level] < currentLevel) return;

  const entry = formatEntry(level, message, context);

  // In development use coloured console output for readability
  if (!import.meta.env.PROD) {
    const colours = {
      debug: '\x1b[36m',  // cyan
      info:  '\x1b[32m',  // green
      warn:  '\x1b[33m',  // yellow
      error: '\x1b[31m',  // red
    };
    const reset = '\x1b[0m';
    const prefix = `${colours[level]}[${level.toUpperCase()}]${reset}`;

    if (level === 'error') {
      // eslint-disable-next-line no-console
      console.error(prefix, message, context);
    } else if (level === 'warn') {
      // eslint-disable-next-line no-console
      console.warn(prefix, message, context);
    } else {
      // eslint-disable-next-line no-console
      console.log(prefix, message, context);
    }
  } else {
    // In production: output JSON only for error/warn so logs are parseable
    if (level === 'error' || level === 'warn') {
      // eslint-disable-next-line no-console
      console[level === 'error' ? 'error' : 'warn'](JSON.stringify(entry));
    }
    // debug/info are completely suppressed in production
  }

  // Always attempt to forward errors to monitoring
  sendToMonitoring(level, message, context);
};

export const logger = {
  debug: (message, context) => emit('debug', message, context),
  info:  (message, context) => emit('info',  message, context),
  warn:  (message, context) => emit('warn',  message, context),
  error: (message, context) => emit('error', message, context),
};

/**
 * logError — convenience wrapper used throughout services.
 * Identical to the old errorHandler.logError signature so existing
 * call-sites only need to update the import.
 *
 * @param {string} context - e.g. 'paymentsService.create'
 * @param {Error|object} error - the caught error object
 * @param {object} [extra] - any additional context to attach
 */
export const logError = (context, error, extra) => {
  logger.error(`[${context}]`, {
    message: error?.message ?? 'Unknown error',
    code:    error?.code   ?? null,
    ...(extra ? { extra } : {}),
  });
};

export default logger;
