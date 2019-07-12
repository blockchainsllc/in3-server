const Sentry = require('@sentry/node');
Sentry.init({ dsn: 'https://59ea79ac77004a62b60e283f03c97e0e@sentry.slock.it/2' });

export class SentryError extends Error {
    constructor(message? :string, category_info? :string, breadcrumb_message? :string) {
        super(message);

        Sentry.addBreadcrumb({
            category: category_info,
            message: breadcrumb_message,
        });

        Sentry.captureException(message)
        return
    }
}