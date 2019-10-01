
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


import * as logger from '../util/logger'
import { SentryError } from '../util/sentryError'
//var njstrace = require('njstrace').inject();

// tslint:disable-next-line:missing-jsdoc
const Sentry = require('@sentry/node');

import * as Koa from 'koa'
import * as bodyParser from 'koa-bodyparser'
import * as Router from 'koa-router'
import { readCargs } from './config'
const config = readCargs()
import { RPC } from './rpc'
import { cbor, chainAliases } from 'in3-common'
import { RPCRequest } from '../types/types'
import { initConfig } from '../util/db'
import { encodeObject } from '../util/binjson'

if (process.env.SENTRY_ENABLE === 'true') {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: process.env.SENTRY_RELEASE || "v0.0.0",
    environment: process.env.SENTRY_ENVIRONMENT || "local"
  });
}

// Hook to nodeJs events
function handleExit(signal) {
  logger.info("Stopping in3-server gracefully...");
  process.exit(0);
}

process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);

process.on("uncaughtException", (err) => {
  logger.error("Unhandled error: " + err, { error: err });
  if (process.env.SENTRY_ENABLE === 'true') {
    Sentry.captureException(err);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error("Unhandled promise rejection at " + promise, { reason: reason, promise: promise });
  if (process.env.SENTRY_ENABLE === 'true') {
    Sentry.captureException(new Error("Unhandled promise rejection at " + promise));
  }
});

let AUTO_REGISTER_FLAG: boolean

if (config.chains[Object.keys(config.chains)[0]].autoRegistry)
  AUTO_REGISTER_FLAG = true
let INIT_ERROR = false;

export const app = new Koa()
const router = new Router()
let rpc: RPC = null

// Hook up sentry if enabled
if (process.env.SENTRY_ENABLE === 'true') {
  app.on('error', (err, ctx) => {
    Sentry.withScope(scope => {
      scope.addEventProcessor(event => Sentry.Handlers.parseRequest(event, ctx.request));
      Sentry.captureException(err);
    });
  });
}
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
  await next()
})


// handle json
app.use(bodyParser())

router.post(/.*/, async ctx => {

  if (INIT_ERROR) return initError(ctx)
  const start = Date.now()
  const requests: RPCRequest[] = Array.isArray(ctx.request.body) ? ctx.request.body : [ctx.request.body]

  try {
    const result = await rpc.handle(requests)
    const res = requests.length && requests[0].in3 && requests[0].in3.useRef ? cbor.createRefs(result) : result
    let body = Array.isArray(ctx.request.body) ? res : res[0]
    if (requests.length && requests[0].in3 && requests[0].in3.useBinary) {
      ctx.set('content-type', 'application/in3')
      ctx.body = encodeObject(body)
    }
    else
      ctx.body = body
    logger.debug('request ' + ((Date.now() - start) + '').padStart(6, ' ') + 'ms : ' + requests.map(_ => _.method + '(' + _.params.map(JSON.stringify as any).join() + ')'))
  } catch (err) {
    ctx.status = err.status || 500
    ctx.body = { jsonrpc: '2.0', error: { message: err.message } }
  }

})

router.get(/.*/, async ctx => {
  //  '/:chain/:method/:args'
  const path = ctx.path.split('/')

  if (path[path.length - 1] === 'health') return checkHealth(ctx)
  else if (path[path.length - 1] === 'version') return getVersion(ctx)
  else if (INIT_ERROR) return initError(ctx)
  try {
    if (path.length < 2) throw new SentryError('invalid path', 'input_error', "the path entered returned error:" + ctx.path)
    let start = path.indexOf('api')
    if (start < 0)
      start = path.findIndex(_ => chainAliases[_] || _.startsWith('0x'))
    if (start < 0 || start > path.length - 2) throw new SentryError('invalid path', 'input_error', "the path entered returned error:" + ctx.path)
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
    console.log(ctx.status)
  } catch (err) {
    ctx.status = err.status || 500
    ctx.body = err.message
    logger.error('Error handling ' + err.message + ' for ' + ctx.request.url, { reqBody: ctx.request.body, errStack: err.stack, reqHeaders: ctx.request.headers, peerIp: ctx.request.ip });
    ctx.app.emit('error', err, ctx)
  }

})

initConfig().then(() => {
  rpc = new RPC(config);
  (chainAliases as any).api = Object.keys(config.chains)[0]

  const doInit = (retryCount: number) => {
    if (retryCount <= 0) {
      logger.error('Error initializing the server : Maxed out retries')
      // throw new SentryError("server initialization error", "server_status", "maxed out retries")
      if (process.env.SENTRY_ENABLE === 'true') {
        Sentry.configureScope((scope) => {
          scope.setTag("server", "initConfig");
          scope.setTag("server_status", "Error initializing the server");
          scope.setExtra("config", config)

        });
        Sentry.captureException(new Error("Maxed out retries"));
      }
      INIT_ERROR = true
      return;
    }
    rpc.init().catch(err => {
      //console.error('Error initializing the server : ' + err.message)
      logger.error('Error initializing the server : ' + err.message, { errStack: err.stack });

      setTimeout(() => { doInit(retryCount - 1) }, 20000)

      if (process.env.SENTRY_ENABLE === 'true') {
        Sentry.configureScope((scope) => {
          scope.setTag("server", "initConfig");
          scope.setTag("server_status", "Error initializing the server");
          scope.setExtra("config", config)
        });
        Sentry.captureException(err);
      }
    })
  }

  // Getting node list and validator list before starting server
  logger.info('initializing in3-server...')
  doInit(3)

  logger.info('staring in3-server...')
  app
    .use(router.routes())
    .use(router.allowedMethods())
    .listen(config.port || 8500, () => logger.info(`http server listening on ${config.port || 8500}`))

}).catch(err => {
  //console.error('Error starting the server : ' + err.message, config)
  logger.error('Error starting the server ' + err.message, { in3Config: config, errStack: err.stack })
  // throw new SentryError(err, "server_status", "Error starting the server")
  if (process.env.SENTRY_ENABLE === 'true') {
    Sentry.configureScope((scope) => {
      scope.setTag("server", "initConfig");
      scope.setTag("server_status", "Error starting the server");
      scope.setExtra("config", config)
    });
    Sentry.captureException(err);
  }

  process.exit(1)
})

async function checkHealth(ctx: Router.IRouterContext) {

  //lies to the rancher that it is healthy to avoid restart loop
  if (INIT_ERROR && AUTO_REGISTER_FLAG) {
    ctx.body = { status: 'healthy' }
    ctx.status = 200
  }
  else if (INIT_ERROR) {
    ctx.body = { status: 'unhealthy', message: "server initialization error" }
    ctx.status = 500
    //  throw new SentryError("server initialization error", "server_status", "unhealthy")
    if (process.env.SENTRY_ENABLE === 'true') {
      Sentry.configureScope((scope) => {
        scope.setTag("server", "checkHealth");
        scope.setTag("unhealthy", "server initialization error");
        scope.setExtra("ctx", ctx)
      });
      Sentry.captureException(new Error("init error"));
    }
  }
  else {
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
  // throw new SentryError("server initialization error", "server_status", "unhealthy")
  if (process.env.SENTRY_ENABLE === 'true') {
    Sentry.configureScope((scope) => {
      scope.setTag("server", "initError");
      scope.setTag("server_status", "Server uninitialized");
      scope.setExtra("ctx", ctx)
    });
    Sentry.captureException(new Error("Server uninitialized"));
  }

}

async function getVersion(ctx: Router.IRouterContext) {

  if (process.env.VERSION_SHA) {
    ctx.body = process.env.VERSION_SHA
    ctx.status = 200
  }
  else {
    ctx.body = "Unknown Version"
    ctx.status = 500

    if (process.env.SENTRY_ENABLE === 'true') {
      Sentry.configureScope((scope) => {
        scope.setTag("server", "getVersion");
        scope.setTag("server_status", "unknown version");
        scope.setExtra("ctx", ctx)
      });
      Sentry.captureException(new Error("server unknown version"));
    }
  }
}

