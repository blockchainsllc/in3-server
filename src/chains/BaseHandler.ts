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

import { RPCRequest, RPCResponse, ServerList, Transport, AxiosTransport, IN3RPCHandlerConfig, serialize, util as in3Util }
  from 'in3'
import axios from 'axios'
import { getNodeList, updateNodeList } from './nodeListUpdater'
import Watcher from './watch'
import { checkPrivateKey, checkRegistry } from './initHandler'
import { collectSignatures, handleSign } from './signatures'
import { RPCHandler } from '../server/rpc'
import { SimpleCache } from '../util/cache'
import * as logger from '../util/logger'

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

  constructor(config: IN3RPCHandlerConfig, transport?: Transport, nodeList?: ServerList) {
    this.config = config || {} as IN3RPCHandlerConfig
    this.transport = transport || new AxiosTransport()
    this.nodeList = nodeList || { nodes: undefined }
    this.counter = 1
    this.openRequests = 0

    const interval = config.watchInterval || 5

    // check that we have a valid private key and if needed decode it
    checkPrivateKey(this.config)

    // create watcher checking the registry-contract for events
    this.watcher = new Watcher(this, interval, config.persistentFile || 'false', config.startBlock)

    // start the watcher in the background
    if (interval > 0 && (this.config as any).useCache) {
      this.cache = new SimpleCache()
      this.watcher.on('newBlock', () => this.cache.clear())
    }

  }

  handleWithCache(request: RPCRequest): Promise<RPCResponse> {
    return this.cache
      ? this.cache.getFromCache(request,
        this.handle.bind(this),
        (signers, blockNumbers, verifiedHashes) => collectSignatures(this, signers, blockNumbers.map(b => ({ blockNumber: b })), verifiedHashes))
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
  getFromServer(request: Partial<RPCRequest>, r?: any): Promise<RPCResponse> {
    const startTime = Date.now()
    if (!request.id) request.id = this.counter++
    if (!request.jsonrpc) request.jsonrpc = '2.0'
    return axios.post(this.config.rpcUrl, this.toCleanRequest(request), { headers: { 'Content-Type': 'application/json' } }).then(_ => _.data, err => {
      logger.error('   ... error ' + err.message + ' send ' + request.method + '(' + (request.params || []).map(JSON.stringify as any).join() + ')  to ' + this.config.rpcUrl + ' in ' + ((Date.now() - startTime)) + 'ms')
      throw new Error('Error ' + err.message + ' fetching request ' + JSON.stringify(request) + ' from ' + this.config.rpcUrl)
    }).then(res => {
      logger.trace('   ... send ' + request.method + '(' + (request.params || []).map(JSON.stringify as any).join() + ')  to ' + this.config.rpcUrl + ' in ' + ((Date.now() - startTime)) + 'ms')
      if (r) {
        r.rpcTime = (r.rpcTime || 0) + (Date.now() - startTime)
        r.rpcCount = (r.rpcCount || 0) + 1
      }
      return res
    })
  }

  /** returns a array of requests from the server */
  getAllFromServer(request: Partial<RPCRequest>[], r?: any): Promise<RPCResponse[]> {
    const startTime = Date.now()
    return request.length
      ? axios.post(this.config.rpcUrl, request.filter(_ => _).map(_ => this.toCleanRequest({ id: this.counter++, jsonrpc: '2.0', ..._ })), { headers: { 'Content-Type': 'application/json' } }).then(_ => _.data, err => {
        logger.error('   ... error ' + err.message + ' => ' + request.map(rq => rq.method + '(' + (rq.params || []).map(JSON.stringify as any).join() + ')').join('\n') + '  to ' + this.config.rpcUrl + ' in ' + ((Date.now() - startTime)) + 'ms')
        throw new Error('Error ' + err.message + ' fetching requests ' + JSON.stringify(request) + ' from ' + this.config.rpcUrl)
      }).then(res => {
        logger.trace('   ... send ' + request.map(rq => rq.method + '(' + (rq.params || []).map(JSON.stringify as any).join() + ')').join('\n') + '  to ' + this.config.rpcUrl + ' in ' + ((Date.now() - startTime)) + 'ms')
        if (r) {
          r.rpcTime = (r.rpcTime || 0) + (Date.now() - startTime)
          r.rpcCount = (r.rpcCount || 0) + 1
        }
        return res
      })
      : Promise.resolve([])
  }

  /** uses the updater to read the nodes from the contract */
  async updateNodeList(blockNumber: number): Promise<void> {
    await updateNodeList(this, this.nodeList, blockNumber)
  }

  /** get the current nodeList */
  async getNodeList(includeProof: boolean, limit = 0, seed?: string, addresses: string[] = [], signers?: string[], verifiedHashes?: string[]): Promise<ServerList> {
    const nl = await getNodeList(this, this.nodeList, includeProof, limit, seed, addresses)
    if (nl.proof && signers && signers.length) {
      let blockNumber = nl.lastBlockNumber

      if (nl.proof.block)
        blockNumber = in3Util.toNumber(serialize.blockFromHex(nl.proof.block).number)
      nl.proof.signatures = await collectSignatures(this, signers, [{ blockNumber }], verifiedHashes)
    }
    return nl
  }

  getRequestFromPath(path: string[], in3: { chainId: string; }): RPCRequest {
    return null
  }


  toCleanRequest(request: Partial<RPCRequest>): RPCRequest {
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
}
