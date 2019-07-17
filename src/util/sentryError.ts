const Sentry = require('@sentry/node');
/**
 * creates a Error with the capability to report it to Sentry.
 * Whether the error is reported depends on the enviroment variable `SENTRY_ENABLE`.
 * 
 * For more details, see 
 * https://git.slock.it/documentation/developer-handbook/blob/master/docs/Error-handling-and-reporting-Sentry.md
 */
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