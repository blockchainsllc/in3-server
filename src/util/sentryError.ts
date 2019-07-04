const Sentry = require('@sentry/node');
Sentry.init({ dsn: 'https://1aca629ca89c42a6b5601fcce6499103@sentry.slock.it/5' });

export class SentryError extends Error {
    constructor(message, meta = {}) {
        super(message);

        Error.captureStackTrace(this,SentryError)
        this.meta = meta
        Sentry.captureException(this)
    }
}