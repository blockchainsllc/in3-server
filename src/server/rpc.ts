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


import { Transport, AxiosTransport, util } from 'in3-common'
import { RPCRequest, RPCResponse, IN3ResponseConfig, IN3RPCRequestConfig, ServerList, IN3RPCConfig, IN3RPCHandlerConfig } from '../types/types'
import axios from 'axios'
import Watcher from '../chains/watch';
import { getStats, currentHour } from './stats'

import IPFSHandler from '../modules/ipfs/IPFSHandler'
import EthHandler from '../modules/eth/EthHandler'
import { getValidatorHistory, HistoryEntry, updateValidatorHistory } from './poa'
import {SentryError} from '../util/sentryError'
import { in3ProtocolVersion } from '../types/constants'


export class RPC {
  conf: IN3RPCConfig
  handlers: { [chain: string]: RPCHandler }

  constructor(conf: IN3RPCConfig, transport?: Transport, nodeList?: ServerList) {
    this.handlers = {}

    // register Handlers
    this.initHandlers(conf, transport, nodeList)

    this.conf = conf
  }

  private initHandlers(conf, transport, nodeList) {
    for (const c of Object.keys(conf.chains)) {
      let h: RPCHandler
      const rpcConf = conf.chains[c]
      switch (rpcConf.handler || 'eth') {
        case 'eth':
          h = new EthHandler({ ...rpcConf }, transport, nodeList)
          break
        case 'ipfs':
          h = new IPFSHandler({ ...rpcConf }, transport, nodeList)
          break
        // TODO implement other handlers later
        default:
          h = new EthHandler({ ...rpcConf }, transport, nodeList)
          break
      }
      this.handlers[h.chainId = util.toMinHex(c)] = h
      if (!conf.defaultChain)
        conf.defaultChain = h.chainId
    }
  }

  async  handle(request: RPCRequest[]): Promise<RPCResponse[]> {
    return Promise.all(request.map(r => {
      
      const in3Request: IN3RPCRequestConfig = r.in3 || {} as any
      const handler = this.handlers[in3Request.chainId = util.toMinHex(in3Request.chainId || this.conf.defaultChain)]
      const in3: IN3ResponseConfig = {} as any
      const start = Date.now()

      if (!handler)
        throw new Error("Unable to connect Ethereum and/or invalid chainId give.")

      // update stats
      currentHour.update(r)

      //check if requested in3 protocol version is same as server is serving
      if(in3Request.version && !(in3Request.version === in3ProtocolVersion)){
        //throw new Error("Unable to serve request for protocol level "+in3Request.version+" Currently Server is at IN3 Protocol Version "+in3ProtocolVersion)
        const res = {
          id: r.id,
          error: "Unable to serve request for protocol level "+in3Request.version+" currently Server is at IN3 Protocol Version "+in3ProtocolVersion,
          jsonrpc: r.jsonrpc,
          in3: { ...in3, 
            execTime: Date.now() - start,   
            rpcTime : (r as any).rpcTime || 0,
            rpcCount : (r as any).rpcCount || 0,
            currentBlock : handler.watcher && handler.watcher.block && handler.watcher.block.number,
            version : in3ProtocolVersion }
        }
        return res as RPCResponse
      }

      if (r.method === 'in3_nodeList')
        return manageRequest(handler, Promise.all([handler.getNodeList(
          in3Request.verification && in3Request.verification.startsWith('proof'),
          r.params[0] || 0,
          r.params[1],
          r.params[2] || [],
          in3Request.signers || in3Request.signatures,
          in3Request.verifiedHashes
        ),
        getValidatorHistory(handler)]).then(async ([result, validators]) => {
          const res = {
            id: r.id,
            result: result as any,
            jsonrpc: r.jsonrpc,
            in3: { ...in3, execTime: Date.now() - start, lastValidatorChange: validators.lastValidatorChange }
          }
          const proof = res.result.proof
          if (proof) {
            delete res.result.proof
            res.in3.proof = proof
          }
          return res as RPCResponse
        }))

      else if (r.method === 'in3_validatorList' || r.method === 'in3_validatorlist') // 'in3_validatorlist' is only supported for legacy, but deprecated
        return manageRequest(handler, getValidatorHistory(handler)).then(async (result) => {

          const startIndex: number = (r.params && r.params.length > 0) ? util.toNumber(r.params[0]) : 0
          const limit: number = (r.params && r.params.length > 1) ? util.toNumber(r.params[1]) : 0

          return ({
            id: r.id,
            result: {
              states: limit ? result.states.slice(startIndex, startIndex + limit) : result.states.slice(startIndex),
              lastCheckedBlock: result.lastCheckedBlock
            },
            jsonrpc: r.jsonrpc,
            in3: { ...in3, lastValidatorChange: result.lastValidatorChange, execTime: Date.now() - start }
          })
        })

      else if (r.method === 'in3_stats') {
        const p = this.conf.profile || {}
        return {
          id: r.id,
          jsonrpc: r.jsonrpc,
          result: {
            profile: p,
            ...(p.noStats ? {} : { stats: getStats() })
          }
        } as RPCResponse
      }

      return manageRequest(handler, Promise.all([
        handler.getNodeList(false).then(_ => in3.lastNodeList = _.lastBlockNumber),
        getValidatorHistory(handler).then(_ => in3.lastValidatorChange = _.lastValidatorChange),
        handler.handle(r).then(_ => {
          (in3 as any).execTime = Date.now() - start;
          (in3 as any).rpcTime = (r as any).rpcTime || 0;
          (in3 as any).rpcCount = (r as any).rpcCount || 0;
          (in3 as any).currentBlock = handler.watcher && handler.watcher.block && handler.watcher.block.number;
          (in3 as any).version = in3ProtocolVersion
          return _
        })
      ])
        .then(_ => ({ ..._[2], in3: { ...(_[2].in3 || {}), ...in3 } })))
    }))
  }

  getRequestFromPath(path: string[], in3: { chainId: string }): RPCRequest {
    const handler = this.getHandler(in3.chainId)
    if (!handler) null
    return handler.getRequestFromPath(path, in3)
  }

  init() {
    return Promise.all(Object.keys(this.handlers).map(c =>
      Promise.all([
        this.handlers[c].getNodeList(true)
          .then(() => this.handlers[c].checkRegistry()),
        updateValidatorHistory(this.handlers[c])
      ]).then(() => {
        const watcher = this.handlers[c].watcher
        // start the watcher
        if (watcher && watcher.interval > 0) watcher.check()
      })
    ))
  }

  getHandler(chainId?: string) {
    return this.handlers[util.toMinHex(chainId || this.conf.defaultChain)]
  }

}

function manageRequest<T>(handler: RPCHandler, p: Promise<T>): Promise<T> {
  handler.openRequests++
  return p.then((r: T) => {
    handler.openRequests--
    return r
  }, err => {
    handler.openRequests--
    throw err
  })
}

export interface RPCHandler {
  openRequests: number
  chainId: string
  handle(request: RPCRequest): Promise<RPCResponse>
  handleWithCache(request: RPCRequest): Promise<RPCResponse>
  getFromServer(request: Partial<RPCRequest>, r?: any): Promise<RPCResponse>
  getAllFromServer(request: Partial<RPCRequest>[], r?: any): Promise<RPCResponse[]>
  getNodeList(includeProof: boolean, limit?: number, seed?: string, addresses?: string[], signers?: string[], verifiedHashes?: string[]): Promise<ServerList>
  updateNodeList(blockNumber: number): Promise<void>
  getRequestFromPath(path: string[], in3: { chainId: string }): RPCRequest
  checkRegistry(): Promise<any>
  config: IN3RPCHandlerConfig
  watcher?: Watcher
}

/**
 * helper class creating a Transport which uses the rpc handler.
 */
export class HandlerTransport extends AxiosTransport {

  handler: RPCHandler

  constructor(h: RPCHandler) {
    super()
    this.handler = h
  }

  async handle(url: string, data: RPCRequest | RPCRequest[], timeout?: number): Promise<RPCResponse | RPCResponse[]> {
    // convertto array
    const requests = Array.isArray(data) ? data : [data]
    if (url === this.handler.config.rpcUrl) return this.handler.getAllFromServer(requests).then(_ => Array.isArray(data) ? _ : _[0])

    // add cbor-config
    const conf = { headers: { 'Content-Type': 'application/json' } }
    // execute request
    try {
      const res = await axios.post(url, requests, { headers: { 'Content-Type': 'application/json' } })

      // throw if the status is an error
      if (res.status > 200) throw new SentryError('Invalid status', 'status_error', res.status.toString())

      // if this was not given as array, we need to convert it back to a single object
      return Array.isArray(data) ? res.data : res.data[0]
    } catch (err) {
      throw new SentryError(err, 'status_error', 'Invalid response from ' + url + '(' + JSON.stringify(requests, null, 2) + ')' + ' : ' + err.message + (err.response ? (err.response.data || err.response.statusText) : ''))
    }
  }


}