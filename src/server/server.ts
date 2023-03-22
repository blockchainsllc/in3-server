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
import axios from 'axios';
import { writeFileSync } from 'fs';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from 'koa-router';
import * as promClient from 'prom-client';
import { PK } from '../chains/signatures';
import { in3ProtocolVersion } from '../types/constants';
import { IN3RPCConfig, KoaContext, RPCRequest } from '../types/types';
import { encodeObject } from '../util/binjson';
import { initConfig } from '../util/db';
import HealthCheck from '../util/healthCheck';
import requestTime from '../util/koa/requestTime';
import * as logger from '../util/logger';
import { SentryError } from '../util/sentryError';
import { hookSentryKoa, HubWrapper, initSentry } from '../util/sentryWrapper';
import { aliases as chainAliases } from '../util/util';
import { checkBudget } from './clients';
import { readCargs } from './config';
import { RPC, submitRequestTime } from './rpc';

const config = readCargs()



//Hook up Sentry
initSentry()

// Hook up prometheus instrumentation
promClient.collectDefaultMetrics({ prefix: "in3_" });

// register top-level metrics
const ctError = new promClient.Counter({
  name: 'in3_errors',
  help: 'Counts the number of errors occured',
  labelNames: ['errtype']
});

const histRequestTime = new promClient.Histogram({
  name: 'in3_frontend_request_time',
  help: 'Total time requests take on the frontend',
  labelNames: ["http_method", "result", "user_agent", "internal"],
  buckets: promClient.exponentialBuckets(1, 2, 20)
});

const statsMetadata = new promClient.Gauge({
  name: 'in3_metadata',
  help: 'provides metadata',
  labelNames: ['address', 'name', 'comment', 'icon', 'version', 'deposit', 'props', 'registertime']
});

// Hook to nodeJs events
function handleExit() {
  logger.info("Stopping in3-server gracefully...");
  process.exit(0);
}

process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);

process.on("uncaughtException", (err) => {
  ctError.labels('uncaughtException').inc();
  logger.error("Unhandled error: " + err, { error: err });
});

process.on('unhandledRejection', (reason, promise) => {
  ctError.labels('unhandledRejection').inc();
  logger.error("Unhandled promise rejection at " + promise, { reason: reason, promise: promise });
});

let AUTO_REGISTER_FLAG: boolean

if (config.chains[Object.keys(config.chains)[0]].autoRegistry)
  AUTO_REGISTER_FLAG = true
let INIT_ERROR = false;

export const app = new Koa()
const router = new Router<Koa.DefaultState, KoaContext>()
let rpc: RPC = null

// Add 'x-Request-Time' to the header
app.use(requestTime(submitRequestTime))

// Hook up sentry if enabled
hookSentryKoa(app)

// handle cbor-encoding
app.use(async (ctx, next) => {

  //allow cross site scripting
  ctx.set('Access-Control-Allow-Origin', '*')
  ctx.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, User-Agent')

  if (ctx.request.method === 'OPTIONS') {
    ctx.body = ''
    ctx.status = 200
    return
  }
  await next()
})

// handle json
app.use(bodyParser())

router.get(config.basePath + '/metrics', async ctx => {
  ctx.set('Content-Type', promClient.register.contentType)
  ctx.body = promClient.register.metrics()
});
const asString = (s: string | string[]) => Array.isArray(s) ? s[0] : s
router.post(/.*/, async (ctx: KoaContext) => {
  if (INIT_ERROR) return initError(ctx)
  const start = Date.now()
  const requests: RPCRequest[] = Array.isArray(ctx.request.body) ? ctx.request.body : [ctx.request.body]
  const startTime = Date.now()

  // find ip
  const ip: string = asString(ctx.headers['x-origin-ip'] || ctx.ip || 'default')
  const ua: string = asString(ctx.headers['User-Agent'] || ctx.header['user-agent'] || 'no-ua')
  let responseData = null

  try {
    // check for valid req
    if ((!ctx.request.body || (typeof (ctx.request.body) === 'object' && !(ctx.request.body as any).method)) && (!ctx.headers['content-type'] || ctx.headers['content-type'].indexOf('application/json') !== 0))
      throw new Error('Request must contain header "Content-Type:application/json"')

    const stats = requests && requests.length && requests[0].in3 ? ((requests[0].in3 as any).stats === false ? false : ((requests[0].in3 as any).noStats ? false : true)) : true

    // DOS protection
    if (!checkBudget(ip, requests, config.maxPointsPerMinute, false)) {
      const res = requests.map(_ => ({ id: _.id, error: { code: - 32600, message: 'Too many requests from ' + ip }, jsonrpc: '2.0' }))
      ctx.status = 429
      ctx.body = Array.isArray(ctx.request.body) ? res : res[0]
      histRequestTime.labels("post", "dos_protect", ua, stats ? 'false' : 'true').observe(Date.now() - startTime);
      return
    }

    if (process.env.IN3TEST) {
      const json = JSON.stringify({
        request: requests[0],
        descr: process.env.IN3TEST,
        handler: rpc.handlers[Object.keys(rpc.handlers)[0]].config.handler || 'eth',
      })
      writeFileSync(process.env.IN3TEST, '[' + json.substr(0, json.length - 1) + ',"mock_responses":[', 'utf8')
    }

    // assign ip
    requests.forEach((request: any) => {
      request.ip = ip
      request.context = { hub: ctx.hub }
    })

    const result = await rpc.handle(requests)
    const res = result // requests.length && requests[0].in3 && requests[0].in3.useRef ? cbor.createRefs(result) : result
    responseData = Array.isArray(ctx.request.body) ? res : res[0]
    if (requests.length && requests[0].in3 && requests[0].in3.useBinary) {
      ctx.set('content-type', 'application/in3')
      ctx.body = encodeObject(responseData)
    }
    else
      ctx.body = responseData

    histRequestTime.labels("post", "ok", ua, stats ? 'false' : 'true').observe(Date.now() - startTime);

    logger.debug('request ' + ((Date.now() - start) + '').padStart(6, ' ') + 'ms : ' + requests.map(_ => _.method + '(' + (Array.isArray(_.params) ? _.params.map(JSON.stringify as any).join() : '-') + ')'))
  } catch (err) {
    histRequestTime.labels("post", "error", ua, '').observe(Date.now() - startTime);
    ctx.status = err.status || 500
    ctx.body = responseData = { jsonrpc: '2.0', error: { code: -32603, message: err.message } }
    ctx.hub?.captureError(err)
  }
  if (process.env.IN3TEST)
    writeFileSync(process.env.IN3TEST, '],"expected_result":' + JSON.stringify(responseData) + '}]', { encoding: 'utf8', flag: 'a' })
})

router.get(/.*/, async ctx => {
  if (ctx.path === '/favicon.ico') {
    ctx.status = 404
    return
  } // Some browsers ask for it -> prevent it

  //  '/:chain/:method/:args'
  const path = ctx.path.split('/')
  const ua = asString(ctx.headers['User-Agent'] || ctx.header['user-agent'] || 'no-ua')


  if (path[path.length - 1] === 'health') return checkHealth(ctx)
  else if (path[path.length - 1] === 'version') return getVersion(ctx)
  else if (INIT_ERROR) return initError(ctx)
  const startTime = Date.now();

  try {
    if (path.length < 2) throw new SentryError('invalid path', ctx, 'input_error', "the path entered returned error:" + ctx.path)
    let start = path.indexOf('api')
    if (start < 0)
      start = path.findIndex(_ => chainAliases[_] || _.startsWith('0x'))
    if (start < 0 || start > path.length - 2) throw new SentryError('invalid path', ctx, 'input_error', "the path entered returned error:" + ctx.path)
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
      ((req.in3 || (req.in3 = {})) as any).noStats = true

    const [result] = await rpc.handle([req])
    ctx.status = result.error ? 500 : 200
    ctx.body = result.result || result.error
    histRequestTime.labels("get", "ok", ua, 'true').observe(Date.now() - startTime);
  } catch (err) {
    histRequestTime.labels("get", "error", ua, 'true').observe(Date.now() - startTime);

    ctx.status = err.status || 500
    ctx.body = err.message
    logger.error('Error handling ' + err.message + ' for ' + ctx.request.url, { reqBody: ctx.request.body, errStack: err.stack, reqHeaders: ctx.request.headers, peerIp: ctx.request.ip });
    throw new SentryError(err, ctx, "request_status", (ctx.request as any).body)
  }
})

checkNodeSync(() =>
  initConfig().then(() => {
    let hub = new HubWrapper()
    rpc = new RPC(config, undefined, undefined, { hub }); // inject the hub
    (chainAliases as any).api = Object.keys(config.chains)[0]

    const doInit = (retryCount: number) => {
      if (retryCount <= 0) {
        logger.error('Error initializing the server : Maxed out retries')
        INIT_ERROR = true
        return;
      }
      rpc.init()
        .then(async () => {
          // set static metadata
          const version = process.env.SENTRY_RELEASE || "unknown";
          const handler = rpc.getHandler(Object.keys(config.chains)[0]);

          const signer: PK = (handler.config as any)._pk
          const address = signer ? signer.address : 'Keyless';


          const node = (await handler.getNodeList(false)).nodes.find(x => x.address.toLowerCase() === address.toLowerCase());

          let deposit = 0;
          let props = "";
          let registerTime = 0;

          if (node) {
            deposit = parseInt(node.deposit.toString()); // 
            props = node.props.toString(); // TODO: Replace with proper parser to get it human readable
            registerTime = (node as any).registerTime;
          }


          statsMetadata.labels(address, config.profile.name || 'Anonymous', config.profile.comment || '', config.profile.icon || '', version, deposit.toString(), props, registerTime.toString()).set(Date.now());


        })
        .catch(err => {
          //console.error('Error initializing the server : ' + err.message)
          logger.error('Error initializing the server : ' + err.message, { errStack: err.stack });

          setTimeout(() => { doInit(retryCount - 1) }, 20000)
        });

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
    process.exit(1)
  })
)
const startTime = Date.now()
async function checkHealth(ctx: KoaContext) {

  const version = process.env.VERSION || 'Unknown'
  const running = Math.floor((Date.now() - startTime) / 1000)
  const name = (rpc.conf.profile && rpc.conf.profile.name) || 'Anonymous'

  //lies to the rancher that it is healthy to avoid restart loop
  if (INIT_ERROR && AUTO_REGISTER_FLAG) {
    ctx.body = { status: 'healthy', version, running, name }
    ctx.status = 200
  }
  else if (HealthCheck.OP_ERROR > Date.now() - 1000 * 60 * 5) {  // we only keep an OP-Error for 5 min
    ctx.body = { status: 'unhealthy', message: "server error during operation", version, running, name }
    ctx.status = 500
  }
  else if (INIT_ERROR) {
    ctx.body = { status: 'unhealthy', message: "server initialization error", version, running, name }
    ctx.status = 500
    throw new SentryError("server initialization error", ctx, "server_status", "unhealthy")
  }
  else {
    const status = await Promise.all(Object.keys(rpc.handlers).map(_ => rpc.handlers[_].health())).then(_ => _.reduce((p, c) => c.status === 'healthy' ? p : c, { status: 'healthy' }))
    ctx.body = { version, running, name, ...status }
    ctx.status = status.status === 'healthy' ? 200 : 500
  }

}

async function initError(ctx: KoaContext) {
  //lies to the rancher that it is healthy to avoid restart loop
  ctx.body = "Server uninitialized"
  ctx.status = 200
  ctError.labels('initError').inc();
  throw new SentryError("server initialization error", ctx, "server_status", "unhealthy")

}

async function getVersion(ctx: Router.IRouterContext) {

  if (process.env.VERSION) {
    ctx.body = process.env.VERSION
    ctx.status = 200
  }
  if (process.env.VERSION_SHA) {
    ctx.body = process.env.VERSION_SHA
    ctx.status = 200
  }
  else {
    ctx.body = "Unknown Version"
    ctx.status = 500
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
      if (r.error == undefined &&
        (JSON.stringify(r.result) === "false" || parseInt(r.result.highestBlock || 1000) - parseInt(r.result.currentBlock || 0) < 10))
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
  const handlerConfig = config.chains[Object.keys(config.chains)[0]]
  const url = handlerConfig.registryRPC || handlerConfig.rpcUrl[0]

  return axios.post(url, request, { headers }).then(_ => _.data,
    err => {
      logger.error('   ... error ' + err.message + ' send ' + request.method + '(' + (request.params || []).map(JSON.stringify as any).join() + ')  to ' + url)
      throw new Error('Error ' + err.message + ' fetching request ' + JSON.stringify(request) + ' from ' + url)
    }).then(res => { return res })
}
