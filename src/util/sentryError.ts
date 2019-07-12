const Sentry = require('@sentry/node');

export class SentryError extends Error {
    constructor(message?: string, category_info?: string, breadcrumb_message?: string) {
        super(message);
        if (process.env.SENTRY_ENABLE === 'true') {

            Sentry.init({dsn: process.env.SENTRY_DSN});

            Sentry.addBreadcrumb({
                category: category_info,
                message: breadcrumb_message,
            });

            Sentry.captureException(message)
        }
    }
}