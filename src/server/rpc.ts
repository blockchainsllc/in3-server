
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

import { RPCRequest, RPCResponse, Transport, IN3ResponseConfig, IN3RPCRequestConfig, util, ServerList, IN3RPCConfig, IN3RPCHandlerConfig } from 'in3'
import EthHandler from '../chains/EthHandler'
import Watcher from '../chains/watch';
import { getStats, currentHour } from './stats'
import IPFSHandler from '../chains/IPFSHandler'


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

      // update stats
      currentHour.update(r)


      if (r.method === 'in3_nodeList')
        return handler.getNodeList(
          in3Request.verification && in3Request.verification.startsWith('proof'),
          r.params[0] || 0,
          r.params[1],
          r.params[2] || [],
          in3Request.signatures,
          in3Request.verifiedHashes
        ).then(async result => {
          const res = {
            id: r.id,
            result: result as any,
            jsonrpc: r.jsonrpc,
            in3: { ...in3, execTime:Date.now()-start }
          }
          const proof = res.result.proof
          if (proof) {
            delete res.result.proof
            res.in3.proof = proof
          }
          return res as RPCResponse
        })

      if (r.method === 'in3_stats') {
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

      return Promise.all([
        handler.getNodeList(false).then(_ => in3.lastNodeList = _.lastBlockNumber),
        handler.handle(r).then(_=>{
          (in3 as any).execTime=Date.now()-start 
          return _
        })
      ])
        .then(_ => ({ ..._[1], in3: { ...(_[1].in3 || {}), ...in3 } }))
    }))
  }

  getRequestFromPath(path: string[], in3: { chainId:string}): RPCRequest {
    const handler = this.getHandler(in3.chainId)
    if (!handler) null
    return handler.getRequestFromPath(path,in3)
  }

  init() {
    return Promise.all(Object.keys(this.handlers).map(c =>
      this.handlers[c].getNodeList(true)
        .then(() => this.handlers[c].checkRegistry())
    ))
  }

  getHandler(chainId?: string) {
    return this.handlers[util.toMinHex(chainId || this.conf.defaultChain)]
  }

}



export interface RPCHandler {
  chainId: string
  handle(request: RPCRequest): Promise<RPCResponse>
  handleWithCache(request: RPCRequest): Promise<RPCResponse>
  getFromServer(request: Partial<RPCRequest>): Promise<RPCResponse>
  getAllFromServer(request: Partial<RPCRequest>[]): Promise<RPCResponse[]>
  getNodeList(includeProof: boolean, limit?: number, seed?: string, addresses?: string[], signers?: string[], verifiedHashes?: string[]): Promise<ServerList>
  updateNodeList(blockNumber: number): Promise<void>
  getRequestFromPath(path: string[], in3: { chainId:string}): RPCRequest
  checkRegistry(): Promise<any>
  config: IN3RPCHandlerConfig
  watcher?: Watcher
}
