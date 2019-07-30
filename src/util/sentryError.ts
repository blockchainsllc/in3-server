/***********************************************************
* This file is part of the Slock.it IoT Layer.             *
* The Slock.it IoT Layer contains:                         *
*   - USN (Universal Sharing Network)                      *
*   - INCUBED (Trustless INcentivized remote Node Network) *
************************************************************
* Copyright (C) 2016 - 2018 Slock.it GmbH                  *
* All Rights Reserved.                                     *
************************************************************
* You may use, distribute and modify this code under the   *
* terms of the license contract you have concluded with    *
* Slock.it GmbH.                                           *
* For information about liability, maintenance etc. also   *
* refer to the contract concluded with Slock.it GmbH.      *
************************************************************
* For more information, please refer to https://slock.it   *
* For questions, please contact info@slock.it              *
***********************************************************/

const Sentry = require('@sentry/node')

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
            Sentry.addBreadcrumb({
                category: category_info,
                message: breadcrumb_message,
            })

            Sentry.captureException(message)
        }
    }
}