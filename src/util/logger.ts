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

import { } from 'in3'
import { keccak } from 'ethereumjs-util'
// Setup logger
import * as winston from 'winston'
import * as memoryLogger from 'in3/js/test/util/memoryLogger'
import config from '../server/config'
import * as color from 'cli-color'


const Sentry = require('@sentry/node');
Sentry.init({dsn:'https://59ea79ac77004a62b60e283f03c97e0e@sentry.slock.it/2'});


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
  console.log("SENTRY SEND")
  Sentry.captureException(data[0]);

  log('error', message, ...data)
}
