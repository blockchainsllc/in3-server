/*******************************************************************************
 * This file is part of the Incubed project.
 * Sources: https://github.com/slockit/in3-server
 * 
 * Copyright (C) 2018-2019 slock.it GmbH, Blockchains LLC
 * 
 * 
 * COMMERCIAL LICENSE USAGE
 * 
 * Licensees holding a valid commercial license may use this file in accordance 
 * with the commercial license agreement provided with the Software or, alternatively, 
 * in accordance with the terms contained in a written agreement between you and 
 * slock.it GmbH/Blockchains LLC. For licensing terms and conditions or further 
 * information please contact slock.it at in3@slock.it.
 * 	
 * Alternatively, this file may be used under the AGPL license as follows:
 *    
 * AGPL LICENSE USAGE
 * 
 * This program is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free Software 
 * Foundation, either version 3 of the License, or (at your option) any later version.
 *  
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY 
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A 
 * PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.
 * [Permissions of this strong copyleft license are conditioned on making available 
 * complete source code of licensed works and modifications, which include larger 
 * works using a licensed work, under the same license. Copyright and license notices 
 * must be preserved. Contributors provide an express grant of patent rights.]
 * You should have received a copy of the GNU Affero General Public License along 
 * with this program. If not, see <https://www.gnu.org/licenses/>.
 *******************************************************************************/



import { AppContext, RPCResponse } from '../types/types';

/**
 * creates a Error with the capability to report it to Sentry.
 * Whether the error is reported depends on the enviroment variable `SENTRY_ENABLE`.
 * 
 * For more details, see 
 * https://git.slock.it/documentation/developer-handbook/blob/master/docs/Error-handling-and-reporting-Sentry.md
 */
export class SentryError extends Error {
    constructor(message?: any, context?: AppContext, category_info?: string, breadcrumb_message?: string) {
        super(message);

        context?.hub?.addBreadcrumb({
            category: category_info,
            message: breadcrumb_message,
        })

        context?.hub?.captureException(this)
    }
}

export const RPCException = {
    PARSE_ERROR: -32_700,
    INVALID_REQUEST: -32_600,
    INVALID_METHOD: -32_601,
    INVALID_PARAMS: -32_602,
    INTERNAL_ERROR: -32_603,
    BLOCK_TOO_YOUNG: -16_001,
    BLOCK_MISMATCH: -32_001 // hard fork?
}

export class IncubedError extends Error {
    code: number
    data: any[]

    constructor(message: string, code: number = RPCException.INTERNAL_ERROR, data?: any[]) {
        super(message)

        this.code = code
        this.data = data

        // Set the prototype explicitly. This is because of this: https://github.com/Microsoft/TypeScript-wiki/blob/master/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
        Object.setPrototypeOf(this, IncubedError.prototype);
    }
}

export class SigningError extends IncubedError {
    sourceError: RPCResponse

    constructor(message: string, code?: number, data?: any[]) {
        super(message, code, data)

        // Set the prototype explicitly. This is because of this: https://github.com/Microsoft/TypeScript-wiki/blob/master/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
        Object.setPrototypeOf(this, SigningError.prototype);
    }
}

/**
 * creates a User-Error which will not be logged or send to sentry
 */
export class UserError extends IncubedError {
    constructor(message: string, code: number) {
        super(message, code);

        // Set the prototype explicitly. This is because of this: https://github.com/Microsoft/TypeScript-wiki/blob/master/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
        Object.setPrototypeOf(this, UserError.prototype);
    }
}
