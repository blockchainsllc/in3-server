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
// tslint:disable-next-line:missing-jsdoc
const Sentry = require('@sentry/node');

import * as logger from '../util/logger'
import { SentryError } from '../util/sentryError'
import * as Koa from 'koa'
import * as bodyParser from 'koa-bodyparser'
import * as Router from 'koa-router'
import { readCargs } from './config'
const config = readCargs()
import { RPC } from './rpc'
import { cbor, chainAliases } from 'in3-common'
import { RPCRequest, IN3RPCConfig } from '../types/types'
import { initConfig } from '../util/db'
import { encodeObject } from '../util/binjson'
import { checkBudget } from './clients'
import { in3ProtocolVersion } from '../types/constants'
import axios from 'axios'


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

    // find ip
    const ip = ctx.headers['x-origin-ip'] || ctx.ip || 'default'

    // DOS protection
    if (!checkBudget(ip, requests, config.maxPointsPerMinute, false)) {
      const res = requests.map(_ => ({ id: _.id, error: 'Too many requests from ' + ip, jsonrpc: '2.0' }))
      ctx.status = 429
      ctx.body = Array.isArray(ctx.request.body) ? res : res[0]
      return
    }

    // assign ip
    requests.forEach(_ => (_ as any).ip = ip)


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
  } catch (err) {
    ctx.status = err.status || 500
    ctx.body = err.message
    logger.error('Error handling ' + err.message + ' for ' + ctx.request.url, { reqBody: ctx.request.body, errStack: err.stack, reqHeaders: ctx.request.headers, peerIp: ctx.request.ip });
    throw new SentryError(err, "request_status", ctx.request.body)

  }

})

checkNodeSync(() =>
  initConfig().then(() => {
    rpc = new RPC(config);
    (chainAliases as any).api = Object.keys(config.chains)[0]

    const doInit = (retryCount: number) => {
      if (retryCount <= 0) {
        logger.error('Error initializing the server : Maxed out retries')
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

            if ((config as any).privateKey) {
              const tempConfig = config
              delete (tempConfig as any).privateKey
            } else {
              scope.setExtra("config", config)
            }
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
)

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

function checkNodeSync(_callback) {
  let rpcReq = {
    jsonrpc: '2.0',
    id: 0,
    method: 'eth_syncing', params: []
  } as RPCRequest

  const checkSync = () => sendToNode(config, rpcReq).then(
    r => {
      if (r.error == undefined && JSON.stringify(r.result) === "false")
        _callback()
      else {
        if (r.error) {
          logger.error("Unable to connect Server \\or Some Error occured " + r.error)
        }
        else if (r.result.startingBlock && r.result.currentBlock && r.result.highestBlock) {
          logger.info("Ethereum Node is still syncing. Current block:" + parseInt(r.result.currentBlock, 16) + " Highest block:" + parseInt(r.result.highestBlock, 16) + " ...")
        }
        setTimeout(checkSync, 10000);
      }
    },
    err => logger.error("Unable to connect to node", err)
  )

  setTimeout(checkSync, 1);

}

async function sendToNode(config: IN3RPCConfig, request: RPCRequest) {
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'in3-node/' + in3ProtocolVersion }
  const url = config.chains[Object.keys(config.chains)[0]].rpcUrl

  return axios.post(url, request, { headers }).then(_ => _.data,
    err => {
      logger.error('   ... error ' + err.message + ' send ' + request.method + '(' + (request.params || []).map(JSON.stringify as any).join() + ')  to ' + url)
      throw new Error('Error ' + err.message + ' fetching request ' + JSON.stringify(request) + ' from ' + url)
    }).then(res => { return res })
}
