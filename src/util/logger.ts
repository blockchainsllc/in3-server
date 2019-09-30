/*******************************************************************************
 * This file is part of the Incubed project.
 * Sources: https://github.com/slockit/in3-c
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



import { keccak } from 'ethereumjs-util'
// Setup logger
import * as winston from 'winston'
import * as memoryLogger from 'in3-common/js/test/util/memoryLogger'
import config from '../server/config'
import * as color from 'cli-color'


const nodeEnv: string = process.env.NODE_ENV || 'production'
const logLevel = config.logging && config.logging.level
const winstonLogger = winston.createLogger({
  levels: winston.config.syslog.levels,
  format: nodeEnv === 'production'
    ? winston.format.json()
    : winston.format.combine(winston.format.colorize(), winston.format.simple()),
  transports: [
    new winston.transports.Console({ level: logLevel || (nodeEnv === 'production' ? 'info' : 'debug') })
  ],
  exceptionHandlers: [
    new winston.transports.Console({ handleExceptions: true })
  ],
  exitOnError: false, // <--- set this to false
})



let impl = winstonLogger

export function setLogger(val: 'winston' | 'memory') {
  impl = ((val === 'winston') ? winstonLogger : memoryLogger) as any
}

export function log(level: string, message: string, ...data: any[]) {
  impl.log(level, message, ...data)
}
export function info(message: string, ...data: any[]): void {
  log('info', message, ...data)
}

export function debug(message: string, ...data: any[]) {
  log('debug', message, ...data)
}
export function trace(message: string, ...data: any[]) {
  log('debug', message, ...data)
}
export function error(message: string, ...data: any[]) {
  log('error', message, ...data)
}
