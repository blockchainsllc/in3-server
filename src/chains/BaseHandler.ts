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
import { Transport, AxiosTransport, NoneRejectingAxiosTransport} from '../util/transport'
import * as serialize from'../modules/eth/serialize'
import * as in3Util  from '../util/util'
import { WhiteList, RPCRequest, RPCResponse, ServerList, IN3RPCHandlerConfig, AppContext } from '../types/types'
import axios from 'axios'
import { getNodeList, updateNodeList } from './nodeListUpdater'
import Watcher from './watch'
import { checkPrivateKey, checkRegistry } from './initHandler'
import { collectSignatures, handleSign, PK } from './signatures'
import { RPCHandler } from '../server/rpc'
import { SimpleCache } from '../util/cache'
import * as logger from '../util/logger'
import { toMinHex } from '../util/util'
import { in3ProtocolVersion, maxWatchBlockTimeout } from '../types/constants'
import WhiteListManager from './whiteListManager'
import * as promClient from 'prom-client';
import HealthCheck from '../util/healthCheck'
import {writeFileSync} from 'fs'

let firstTestRecord =true

const histRequestTime = new promClient.Histogram({
  name: 'in3_upstream_request_time',
  help: 'Total time requests take talking to the upstream',
  labelNames: ["rpc_method", "result", "type"],
  buckets: promClient.exponentialBuckets(1, 2, 20)
});


/**
 * handles eth_sign and eth_nodelist
 */
export default abstract class BaseHandler implements RPCHandler {
  openRequests: number
  counter: number
  config: IN3RPCHandlerConfig
  nodeList: ServerList
  transport: Transport
  chainId: string
  watcher: Watcher
  cache: SimpleCache
  whiteListMgr: WhiteListManager
  activeRPC: number
  healthCheck: HealthCheck
  resetRPCIndexTimer: any
  switchBackRPCTime: number
  context: AppContext

  constructor(config: IN3RPCHandlerConfig, transport?: Transport, nodeList?: ServerList, context?: AppContext) {
    this.config = config || {} as IN3RPCHandlerConfig
    this.transport = transport || new NoneRejectingAxiosTransport()
    this.nodeList = nodeList || { nodes: undefined }
    this.counter = 1
    this.openRequests = 0
    this.activeRPC = 0
    this.switchBackRPCTime = 300000 // after 5 min default first RPC will be used for all requests
    this.resetRPCIndexTimer = undefined
    this.context = context

    const interval = config.watchInterval || 5

    // check that we have a valid private key and if needed decode it
    checkPrivateKey(this.config)

    // create watcher checking the registry-contract for events
    this.watcher = new Watcher(this, interval, config.persistentFile || 'false', config.startBlock, this.context)

    //create health monitoring service
    const maxBlockTimeout = config.watchBlockTimeout ? config.watchBlockTimeout : maxWatchBlockTimeout
    this.healthCheck = new HealthCheck(maxBlockTimeout, this.watcher, this.config, undefined, this.context)
    this.watcher.on('newBlock', () => this.healthCheck.updateBlock())

    this.whiteListMgr = new WhiteListManager(this, config.maxWhiteListWatch, config.cacheWhiteList)
    this.watcher.on('newBlock', () => this.whiteListMgr.updateWhiteList())

    if((this.config as any).useCache != false){ // explicitly checking if it is not false then dnt use cache, so if undfined or true use cache
      this.cache = new SimpleCache()
      this.watcher.on('newBlock', () => this.cache.clear())
    }

  }

  handleWithCache(request: RPCRequest): Promise<RPCResponse> {
    return this.cache
      ? this.cache.getFromCache(request,
        this.handle.bind(this),
        (signers, blockNumbers, verifiedHashes) => collectSignatures(this, signers, blockNumbers.map(b => ({ blockNumber: b })), verifiedHashes, undefined, request))
      : this.handle(request)
  }

  handle(request: RPCRequest): Promise<RPCResponse> {
    if (request.method === 'in3_sign')
      return handleSign(this, request)
  }

  checkRegistry(): Promise<any> {
    return checkRegistry(this)
  }


  /** returns the result directly from the server */
  getFromServer(request: Partial<RPCRequest>, r?: any, rpc?: string): Promise<RPCResponse> {
    const startTime = Date.now()
    if (!request.id) request.id = this.counter++
    if (!request.jsonrpc) request.jsonrpc = '2.0'

    for (let i = 0; i < request.params.length; i++) {
      if (typeof request.params[i] === 'string' && request.params[i].startsWith("0x0")) {
        if (request.params[i].substr(2).length % 32 != 0 && request.params[i].substr(2).length % 20 != 0) {
          request.params[i] = toMinHex(request.params[i])
        }
      }
    }
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'in3-node/' + in3ProtocolVersion }
    let ip = "0.0.0.0"
    if (r && r.ip) {
      headers['X-Origin-IP'] = r.ip
      ip = r.ip;
    }

    if (process.env.IN3VERBOSERPC)
      logger.debug("Verbose. RPC: " + (rpc || this.config.rpcUrl[this.activeRPC]) + " Request: " + JSON.stringify(request))

    return axios.post(rpc || this.config.rpcUrl[this.activeRPC], this.toCleanRequest(request), { headers })
      .then(rsp => this.handleFauxSuccess(rsp))
      .then(_ => _.data, err => {

        if (typeof (err?.response?.data) === 'object' && err.response.data.error)
          err.message = err.response.data.error.message || err.response.data.error

        logger.error('   ... error ' + err.message + ' send ' + request.method + '(' + (request.params || []).map(JSON.stringify as any).join() + ')  to ' + this.config.rpcUrl[this.activeRPC] + ' in ' + ((Date.now() - startTime)) + 'ms')

        let sentryTags = { BaseHandler: "getFromServer", "nodeList-contract": this.config.registry }
        let sentryExtras = { request }

        request?.context?.hub?.configureScope(sentryTags, sentryExtras)

        histRequestTime.labels(request.method || "unknown", "error", "single").observe(Date.now() - startTime);
        //re attempt if request failed and if there are more then 1 RPC URLs are specified
        if ((err?.response?.status !== 200 || err?.message.toString().indexOf("ECONNREFUSED") != -1 || this.isProxyError(err?.code)) &&
          this.config.rpcUrl.length > 1 && this.activeRPC + 1 < this.config.rpcUrl.length && !rpc) {

          logger.error('Request failed for RPC URL ' + this.config.rpcUrl[this.activeRPC] + ' Error ' + err.message + ' fetching request ' + JSON.stringify(request) + 'Reattempting request on ' + this.config.rpcUrl[this.activeRPC + 1])
          this.activeRPC++
          this.switchBackToMainRPCTimer() //switch back to main RPC after 5 min
          return this.getFromServer(request, r)
        }
        else
          throw new Error('Error ' + err.message + ' fetching request ' + JSON.stringify(request) + ' from ' + this.config.rpcUrl[this.activeRPC])
      })
      .then(res => {
        logger.trace('   ... send ' + request.method + '(' + (request.params || []).map(JSON.stringify as any).join() + ')  to ' + this.config.rpcUrl[this.activeRPC] + ' in ' + ((Date.now() - startTime)) + 'ms')
        if (process.env.IN3TEST && (!rpc || rpc===this.config.rpcUrl[0])) {
          writeFileSync(process.env.IN3TEST,(firstTestRecord ? '':',')+JSON.stringify([request,fixResponse(request, res)]),{encoding:'utf8',flag:'a'})
          firstTestRecord=false
        }

        request?.context?.hub?.addBreadcrumb({
          category: "getFromServer",
          data: {
            request: request,
            response: res.result || res
          }
        })

        if (r) {
          // TODO : add prom hsitogram

          r.rpcTime = (r.rpcTime || 0) + (Date.now() - startTime)
          r.rpcCount = (r.rpcCount || 0) + 1
        }
        histRequestTime.labels(request.method || "unknown", "ok", "single").observe(Date.now() - startTime);
        return fixResponse(request, res)
      })
  }

  /** returns a array of requests from the server */
  getAllFromServer(request: Partial<RPCRequest>[], r?: any, rpc?: string): Promise<RPCResponse[]> {

    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'in3-node/' + in3ProtocolVersion }
    let ip = "0.0.0.0"
    if (r && r.ip) {
      headers['X-Origin-IP'] = r.ip
      ip = r.ip;
    }
    const startTime = Date.now()

    if (process.env.IN3VERBOSERPC)
      logger.debug("Verbose. RPC: " + (rpc || this.config.rpcUrl[this.activeRPC]) + " Request: " + JSON.stringify(request))

    return request.length
      ? axios.post(rpc || this.config.rpcUrl[this.activeRPC], request.filter(_ => _).map(_ => this.toCleanRequest({ id: this.counter++, jsonrpc: '2.0', ..._ })), { headers })
        .then(_ => _.data, err => {
          logger.error('   ... error ' + err.message + ' => ' + request.filter(_ => _).map(rq => rq.method + '(' + (rq.params || []).map(JSON.stringify as any).join() + ')').join('\n') + '  to ' + this.config.rpcUrl[this.activeRPC] + ' in ' + ((Date.now() - startTime)) + 'ms')

          histRequestTime.labels("bulk", "error", "bulk").observe(Date.now() - startTime);
          //re attempt if request failed and if there are more then 1 RPC URLs are specified
          if (this.isConnectionError(err) && this.hasFailoverRpc()) {
            logger.error('Request failed for RPC URL ' + this.config.rpcUrl[this.activeRPC] + 'Error ' + err.message + ' fetching request ' + JSON.stringify(request) + 'Reattempting request on ' + this.config.rpcUrl[this.activeRPC + 1])
            this.activeRPC++
            this.switchBackToMainRPCTimer() //switch back to main RPC after 5 min
            return this.getAllFromServer(request, r)
          }
          else
            throw new Error('Error ' + err.message + ' fetching requests ' + JSON.stringify(request) + ' from ' + this.config.rpcUrl[this.activeRPC])
        }).then(res => {
          logger.trace('   ... send ' + request.filter(_ => _).map(rq => rq.method + '(' + (rq.params || []).map(JSON.stringify as any).join() + ')').join('\n') + '  to ' + this.config.rpcUrl[this.activeRPC] + ' in ' + ((Date.now() - startTime)) + 'ms')

          request[0]?.context?.hub?.addBreadcrumb({
            category: "getAllFromServer response",
            data: {
              request: request,
              response: res.result || res
            }
          })

          if (r) {
            // TODO : add prom hsitogram

            r.rpcTime = (r.rpcTime || 0) + (Date.now() - startTime)
            r.rpcCount = (r.rpcCount || 0) + 1
          }
          histRequestTime.labels("bulk", "ok", "bulk").observe(Date.now() - startTime);
          if (Array.isArray(res))
            request.forEach((req, i) => fixResponse(req, res[i]))

            if (process.env.IN3TEST && (!rpc || rpc===this.config.rpcUrl[0])) {
              const json = JSON.stringify(request.map((r,i)=>[r,Array.isArray(res)?res[i]:res]))
              writeFileSync(process.env.IN3TEST,(firstTestRecord ? '':',')
              +json.substr(1,json.length-2),{encoding:'utf8',flag:'a'})
              firstTestRecord=false
            }

          return res
        })
      : Promise.resolve([])
  }

  switchBackToMainRPCTimer() {
    if (this.resetRPCIndexTimer == undefined) {
      this.resetRPCIndexTimer = setTimeout(function () {
        this.activeRPC = 0
        this.resetRPCIndexTimer = undefined
        logger.info("Switching back to first RPC URL " + this.config.rpcUrl[this.activeRPC])
      }, this.switchBackRPCTime)
    }
  }

  /** uses the updater to read the nodes from the contract */
  async updateNodeList(blockNumber: number): Promise<void> {
    await updateNodeList(this, this.nodeList, blockNumber, this.context)
  }

  /** get the current nodeList */
  async getNodeList(includeProof: boolean, limit = 0, seed?: string, addresses: string[] = [], signers?: string[], verifiedHashes?: string[], includePerformance?: boolean, sourceRequest?: RPCRequest): Promise<ServerList> {

    const nl = await getNodeList(this, this.nodeList, includeProof, limit, seed, addresses, sourceRequest?.context || this.context)
    if (nl.proof && signers && signers.length) {
      let blockNumber = nl.lastBlockNumber

      if (nl.proof.block)
        blockNumber = in3Util.toNumber(serialize.blockFromHex(nl.proof.block).number)
      nl.proof.signatures = await collectSignatures(this, signers, [{ blockNumber }], verifiedHashes, this.config.registryRPC, sourceRequest)
    }
    if (!includePerformance && nl.nodes) nl.nodes.forEach(_ => {
      delete _.performance
    })
    return nl
  }

  /** get the white list nodes */
  async getWhiteList(includeProof: boolean, whiteListContract: string, signers?: string[], verifiedHashes?: string[]): Promise<WhiteList> {
    const wl = await this.whiteListMgr.getWhiteList(includeProof, whiteListContract)

    if (wl.proof && signers && signers.length) {
      let blockNumber = wl.lastBlockNumber

      if (wl.proof.block)
        blockNumber = in3Util.toNumber(serialize.blockFromHex(wl.proof.block).number)
      wl.proof.signatures = await collectSignatures(this, signers, [{ blockNumber }], verifiedHashes, this.config.registryRPC)
    }
    return wl
  }

  getRequestFromPath(path: string[], in3: { chainId: string; }): RPCRequest {
    return null
  }

  toCleanRequest(request: Partial<RPCRequest>): RPCRequest {
    for (let i = 0; i < request.params.length; i++) {
      if (typeof request.params[i] === 'string' && request.params[i].startsWith("0x0")) {
        if (request.params[i].substr(2).length % 32 != 0 && request.params[i].substr(2).length % 20 != 0) {
          request.params[i] = toMinHex(request.params[i])
        }
      }
    }
    return {
      id: request.id,
      method: request.method,
      params: request.params,
      jsonrpc: request.jsonrpc
    }
  }

  toError(id: number | string, error: string): RPCResponse {
    return {
      id,
      error,
      jsonrpc: '2.0'
    }
  }
  toResult(id: number | string, result: any): RPCResponse {
    return {
      id,
      result,
      jsonrpc: '2.0'
    }
  }
  health(): Promise<{ status: string, message?: string }> {
    return this.getFromServer({ id: 1, jsonrpc: '2.0', method: 'web3_clientVersion', params: [] })
      .then(_ => ({ status: 'healthy' }), _ => ({ status: 'unhealthy', message: _.message }))
  }

  hasFailoverRpc(): boolean {
    return this.config.rpcUrl.length > 1 && this.activeRPC + 1 < this.config.rpcUrl.length
  }

  isConnectionError(err: any): boolean {
    return err?.response?.status !== 200 || err?.message?.toString().indexOf("ECONNREFUSED") != -1 || this.isProxyError(err?.data?.error?.code)
  }

  handleFauxSuccess(rsp: any): any {
    // If it has the error code, we can assume it has this structure, it has to match the one on the reject handler to not blow on the logger.
    return this.isProxyError(rsp?.data?.error?.code) ? Promise.reject(rsp.data.error) : Promise.resolve(rsp)
  }

  isProxyError(errCode: number) {
    const PROXY_ERROR_CODE = [-42004] // For now neither -42003, -42002 make sense to expect
    return PROXY_ERROR_CODE.includes(errCode)
  }
}


function fixResponse(req: Partial<RPCRequest>, res: RPCResponse) {
  if (!res || typeof (res.result) !== 'object') return res
  if (req && req.method === 'eth_getProof') fixAccount(res.result)
  if (req && req.method === 'proof_call' && Array.isArray(res.result.accounts)) res.result.accounts.forEach(fixAccount)
  if (res.result && res.result.transactions) res.result.transactions.forEach(fixTransaction)
  if (req && req.method.indexOf('eth_getTransactionBy') === 0) fixTransaction(res.result)
  return res
}

function fixTransaction(t) {
  if (typeof t !== 'object' || !t.r) return
  if (!t.input && t.data) {
    t.input = t.data
    delete t.data
  }
  //  delete t.creates
  delete t.condition
}

function fixAccount(ac) {
  if (ac.codeHash === null) ac.codeHash = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
  if (ac.storageHash === null) ac.storageHash = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421'
  if (ac.storageProof) ac.storageProof.forEach(s => {
    if (!s.value) s.value = "0x0000000000000000000000000000000000000000000000000000000000000000"
  })
}