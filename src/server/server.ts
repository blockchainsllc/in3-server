
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

// tslint:disable-next-line:missing-jsdoc
import * as Koa from 'koa'
import * as bodyParser from 'koa-bodyparser'
import * as Router from 'koa-router'
import * as winston from 'winston'
import { RPC } from './rpc'
import { cbor, RPCRequest, chainAliases } from 'in3'
import { readCargs } from './config'
import { initConfig } from '../util/db'
import { encodeObject } from '../util/binjson'

const config = readCargs()
let AUTO_REGISTER_FLAG: boolean

if (config.chains[Object.keys(config.chains)[0]].autoRegistry)
  AUTO_REGISTER_FLAG = true

// Setup logger
const nodeEnv: string = process.env.NODE_ENV || 'production';
const logger = winston.createLogger({
  levels: winston.config.syslog.levels,
  format: nodeEnv === 'production' ? winston.format.json() : winston.format.combine(winston.format.colorize(),winston.format.simple()),
  transports: [
    new winston.transports.Console(nodeEnv === 'production' ? { level: 'info' } : { level: 'debug' })
  ],
  exceptionHandlers: [
    new winston.transports.Console({ handleExceptions: true })
  ],
  exitOnError: false, // <--- set this to false
});

let INIT_ERROR = false;

export const app = new Koa()
const router = new Router()
let rpc: RPC = null

// handle cbor-encoding
app.use(async (ctx, next) => {


  //allow cross site scripting
  ctx.set('Access-Control-Allow-Origin', '*')
  ctx.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')

  if (ctx.request.method === 'OPTIONS') {
    ctx.body = ''
    ctx.status = 200
    return
  }

  const format = ctx.headers['content-type']
  if (format && format === 'application/cbor') {
    const body = await new Promise((res, rej) => {
      const bufs = []
      ctx.req.on('data', d => bufs.push(d))
      ctx.req.on('end', () => {
        res(ctx.request.body = cbor.decodeRequests(Buffer.concat(bufs)))
      })

    })
    await next()
    if ((ctx.status || 200) === 200) {
      ctx.set('content-type', 'application/cbor')
      ctx.body = cbor.encodeResponses(ctx.body)
    }
    return
  }
  await next()
})


// handle json
app.use(bodyParser())

router.post(/.*/, async ctx => {

  if (INIT_ERROR) return initError(ctx)

  try {
    const requests: RPCRequest[] = Array.isArray(ctx.request.body) ? ctx.request.body : [ctx.request.body]
    const result = await rpc.handle(requests)
    const res = requests.length && requests[0].in3 && requests[0].in3.useRef ? cbor.createRefs(result) : result
    let body = Array.isArray(ctx.request.body) ? res : res[0]
    if (requests.length && requests[0].in3 && requests[0].in3.useBinary) {
      ctx.set('content-type', 'application/in3')
      ctx.body = encodeObject(body)
    }
    else
      ctx.body = body
  } catch (err) {
    ctx.status = err.status || 500
    ctx.body = err.message
    //logger.error('Error handling ' + ctx.request.url + ' : (' + JSON.stringify(ctx.request.body, null, 2) + ') : ' + err + '\n' + err.stack + '\n' + 'sender headers: ' + JSON.stringify(ctx.request.headers, null, 2) + "\n sender ip " + ctx.request.ip)
    logger.error('Error handling ' + err.message + ' for ' + ctx.request.url, { reqBody: ctx.request.body, errStack: err.stack, reqHeaders: ctx.request.headers, peerIp: ctx.request.ip });
    ctx.app.emit('error', err, ctx)
  }

})

router.get(/.*/, async ctx => {
  //  '/:chain/:method/:args'
  const path = ctx.path.split('/')

  if (path[path.length - 1] === 'health') return checkHealth(ctx)
  else if (path[path.length - 1] === 'version') return getVersion(ctx)
  else if (INIT_ERROR) return initError(ctx)
  try {
    if (path.length < 2) throw new Error('invalid path')
    let start = path.indexOf('api')
    if (start < 0)
      start = path.findIndex(_ => chainAliases[_] || _.startsWith('0x'))
    if (start < 0 || start > path.length - 2) throw new Error('invalid path ' + ctx.path)
    const [chain, method] = path.slice(start)
    const req = rpc.getRequestFromPath(path.slice(start + 1), { chainId: chainAliases[chain] || chain, ...ctx.query }) || {
      id: 1,
      jsonrpc: '2.0',
      method,
      params: (path.slice(start + 2).join('/') || '').split(',').filter(_ => _).map(_ => _ === 'true' ? true : _ === 'false' ? false : _),
      in3: {
        chainId: chainAliases[chain] || chain,
        ...ctx.query
      }
    }
    if (ctx.request.headers && (ctx.request.headers.Referrer || ctx.request.headers.referrer || ctx.request.headers.Referer || ctx.request.headers.referer || '').indexOf('in3') >= 0)
      (req.in3 || (req.in3 = {})).noStats = true
    const [result] = await rpc.handle([req])
    ctx.status = result.error ? 500 : 200
    ctx.body = result.result || result.error

  } catch (err) {
    ctx.status = err.status || 500
    ctx.body = err.message
    //logger.error('Error handling ' + ctx.request.url + ' : (' + JSON.stringify(ctx.request.body, null, 2) + ') : ' + err + '\n' + err.stack + '\n' + 'sender headers: ' + JSON.stringify(ctx.request.headers, null, 2) + "\n sender ip " + ctx.request.ip)
    logger.error('Error handling ' + err.message + ' for ' + ctx.request.url, { reqBody: ctx.request.body, errStack: err.stack, reqHeaders: ctx.request.headers, peerIp: ctx.request.ip });
    ctx.app.emit('error', err, ctx)
  }

})

initConfig().then(() => {
  rpc = new RPC(config);
  (chainAliases as any).api = Object.keys(config.chains)[0]
  logger.info('staring in3-server...')
  app
    .use(router.routes())
    .use(router.allowedMethods())
    .listen(config.port || 8500, () => logger.info(`http server listening on ${config.port || 8500}`))

  const doInit = (retryCount: number) => {
    if(retryCount <= 0){
      logger.error('Error initializing the server : Maxed out retries')
      INIT_ERROR = true
      return;
    }
    rpc.init().catch(err => {
      //console.error('Error initializing the server : ' + err.message)
      logger.error('Error initializing the server : ' + err.message, { errStack: err.stack });
      setTimeout(() => {doInit(retryCount-1)}, 20000)
    })
  }

  // after starting the server, we should make sure our nodelist is up-to-date.
  doInit(3)
}).catch(err => {
  //console.error('Error starting the server : ' + err.message, config)
  logger.error('Error starting the server ' + err.message, { in3Config: config, errStack: err.stack })
  process.exit(1)
})

async function checkHealth(ctx: Router.IRouterContext) {

  //lies to the rancher that it is healthy to avoid restart loop
  if (INIT_ERROR && AUTO_REGISTER_FLAG) {
    ctx.body = { status: 'healthy' }
    ctx.status = 200
  }
  else if(INIT_ERROR) {
    ctx.body = { status: 'unhealthy', message: "server initialization error"}
    ctx.status = 500
  }
  else{
    await Promise.all(
      Object.keys(rpc.handlers).map(c => rpc.handlers[c].getFromServer({ id: 1, jsonrpc: '2.0', method: 'web3_clientVersion', params: [] })))
      .then(_ => {
        ctx.body = { status: 'healthy' }
        ctx.status = 200
      }, _ => {
        ctx.body = { status: 'unhealthy', message: _.message }
        ctx.status = 500
      })
  }

}

async function initError(ctx: Router.IRouterContext) {
  //lies to the rancher that it is healthy to avoid restart loop
  ctx.body = "Server uninitialized"
  ctx.status = 200
}

async function getVersion(ctx: Router.IRouterContext) {

  if (process.env.VERSION_SHA) {
    ctx.body = process.env.VERSION_SHA
    ctx.status = 200
  }
  else {
    ctx.body = "Unknown Version"
    ctx.status = 500
  }
}
