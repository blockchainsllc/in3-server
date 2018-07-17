import { } from 'in3'
import { sha3 } from 'ethereumjs-util'

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

if (!config.logging) config.logging = { colors: true }
color.grey = color.blackBright
function colorize(level, msg) {
  if (!config.logging.colors) return msg
  if (level === 'debug') return color.grey(msg)
  if (level === 'error') return color.red(msg)
  if (level === 'silly') return color.grey(msg)
  if (level === 'warn') return color.cyan(msg)
  return msg
}

if (config.logging.file || config.logging.type)
  winston.remove(winston.transports.Console)


if (config.logging.file)
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

if (config.logging.type) {
  const firstChain = config.chains[Object.keys(config.chains)[0]]
  const id = (firstChain && sha3(firstChain.privateKey).toString('hex').replace('0x', '').substr(0, 4)) || 'in3-server'
  // tslint:disable-next-line:non-literal-require
  const lt = require(config.logging.type)
  winston.add(config.logging.name ? lt[config.logging.name] : lt, { programm: id, ...config.logging })
}