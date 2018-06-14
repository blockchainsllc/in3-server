import { } from 'in3'

import * as logger from 'in3/js/test/util/memoryLogger'
import * as winston from 'winston'
import config from '../server/config'
import * as color from 'cli-color'

let impl = winston

export function setLogger(val: 'winston' | 'memory') {
  impl = ((val === 'winston') ? winston : logger) as any
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
export function error(message: string, ...data: any[]) {
  log('error', message, ...data)
}

if (!config.logging) config.logging = { file: 'in3.log', colors: true }
color.grey = color.blackBright
function colorize(level, msg) {
  if (!config.logging.colors) return msg
  if (level === 'debug') return color.grey(msg)
  if (level === 'error') return color.red(msg)
  if (level === 'silly') return color.grey(msg)
  if (level === 'warn') return color.cyan(msg)
  return msg
}

if (config.logging.file) {
  winston.remove(winston.transports.Console)
  winston.add(winston.transports.File, {
    filename: config.logging.file,
    json: false,
    level: config.logging.level,
    timestamp: () => new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString(),
    formatter: options =>
      color.grey(options.timestamp() + ' ' + options.level.toUpperCase()) + ' ' +
      (options.message ? colorize(options.level, options.message) : '') +
      (options.meta && Object.keys(options.meta).length ? '\n' +
        color.grey(options.meta.stack ? options.meta.stack : JSON.stringify(options.meta, null, 2)) : '')
  })

}
