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



const Sentry = require('@sentry/node')
import * as logger from './logger'

/**
 * creates a Error with the capability to report it to Sentry.
 * Whether the error is reported depends on the enviroment variable `SENTRY_ENABLE`.
 * 
 * For more details, see 
 * https://git.slock.it/documentation/developer-handbook/blob/master/docs/Error-handling-and-reporting-Sentry.md
 */
export class SentryError extends Error {

    constructor(message?: any, category_info?: string, breadcrumb_message?: string) {
        super(message);
        if (process.env.SENTRY_ENABLE === 'true') {
            Sentry.addBreadcrumb({
                category: category_info,
                message: breadcrumb_message,
            })
            Sentry.captureException(this)
        }
    }
}

/**
 * creates a User-Error which will not be logged or send to sentry
 */
export class UserError extends Error {

    public static INVALID_REQUEST = -32600
    public static INVALID_METHOD = -32601
    public static INVALID_PARAMS = -32602
    public static INTERNAL_ERROR = -32603
    public static BLOCK_TOO_YOUNG = -16001

    code: number

    constructor(message: string, code: number) {
        super(message);
        this.code = code
    }

    toResponse(rpcId): any {
        return {
            id: rpcId || 1,
            jsonrpc: '2.0',
            error: {
                code: this.code,
                message: this.message
            },
            in3: {}
        }
    }

}

export let OP_ERROR = false; //operational error, if server encountered error during normal working

export function setOpError(err: Error) {
  if (err) {
    //mark flag true so /health endpoint responds with error state
    OP_ERROR = true;

    //logging error on console
    logger.error(" " + err.name + " " + err.message + " " + err.stack)

    //sending error to sentry
    if (process.env.SENTRY_ENABLE === 'true') {
      Sentry.configureScope((scope) => {
        scope.setTag("server", "checkHealth");
        scope.setTag("unhealthy", "server operation error");
        scope.setExtra("ctx", err.name + " " + err.message + " " + err.stack)
      });
      Sentry.captureException(new Error("operation error " + err.name + " " + err.message + " " + err.stack));
    }
  }
}
