
// tslint:disable-next-line:missing-jsdoc
import * as Koa from 'koa'
import * as bodyParser from 'koa-bodyparser'
import * as Router from 'koa-router'
import * as logger from 'winston'
import { RPC } from './rpc'
import { cbor, RPCRequest, chainAliases } from 'in3'
import config from './config'
import { initConfig } from '../util/db'

export const app = new Koa()
const router = new Router()
let rpc: RPC = null

// handle cbor-encoding
app.use(async (ctx, next) => {
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
  try {
    const requests: RPCRequest[] = Array.isArray(ctx.request.body) ? ctx.request.body : [ctx.request.body]
    const result = await rpc.handle(requests)
    const res = requests.length && requests[0].in3 && requests[0].in3.useRef ? cbor.createRefs(result) : result
    ctx.body = Array.isArray(ctx.request.body) ? res : res[0]
  } catch (err) {
    ctx.status = err.status || 500
    ctx.body = err.message
    logger.error('Error handling ' + ctx.request.url + ' : (' + JSON.stringify(ctx.request.body, null, 2) + ') : ' + err + '\n' + err.stack + '\n' + 'sender headers: ' + JSON.stringify(ctx.request.headers, null, 2) + "\n sender ip " + ctx.request.ip)
    ctx.app.emit('error', err, ctx)
  }

})

router.get(/.*/, async ctx => {
  //  '/:chain/:method/:args'
  const path = ctx.path.split('/')
  try {
    if (path.length < 2) throw new Error('invalid path')
    let start = path.indexOf('api')
    if (start < 0)
      start = path.findIndex(_ => chainAliases[_] || _.startsWith('0x'))
    if (start < 0 || start > path.length - 3) throw new Error('invalid path ' + ctx.path)
    const [chain, method] = path.slice(start)
    const req = {
      id: 1,
      jsonrpc: '2.0',
      method,
      params: (path.slice(start + 2).join('/') || '').split(','),
      in3: {
        chainId: chainAliases[chain] || chain,
        ...ctx.query
      }
    }
    const [result] = await rpc.handle([req as any])
    ctx.status = result.error ? 500 : 200
    ctx.body = result.result || result.error

  } catch (err) {
    ctx.status = err.status || 500
    ctx.body = err.message
    logger.error('Error handling ' + ctx.request.url + ' : (' + JSON.stringify(ctx.request.body, null, 2) + ') : ' + err + '\n' + err.stack + '\n' + 'sender headers: ' + JSON.stringify(ctx.request.headers, null, 2) + "\n sender ip " + ctx.request.ip)
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

  // after starting the server, we should make sure our nodelist is up-to-date.
  setTimeout(() => rpc.init().catch(err => {
    console.error('Error initializing the server : ' + err.message)
    logger.error('Error initializing the server : ', err)
    process.exit(1)
  }))
}).catch(err => {
  console.error('Error starting the server : ' + err.message, config)
  logger.error('Error starting the server ' + err, config)
  process.exit(1)
})

