const Sentry = require('@sentry/node');
Sentry.init({ dsn: 'https://1aca629ca89c42a6b5601fcce6499103@sentry.slock.it/5' });

export class SentryError extends Error {
    constructor(message? :string, tmp? :string,tmp_data? :string) {
        super(message);
        console.log(message)

        Sentry.addBreadcrumb({
            category: tmp,
            message: tmp_data,
        });

        Sentry.captureException(message)
    }
}