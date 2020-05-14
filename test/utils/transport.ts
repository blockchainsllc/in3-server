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
import Client from 'in3'
import { RPCRequest, RPCResponse, IN3NodeConfig, IN3Config, ServerList, IN3RPCHandlerConfig } from '../../src/types/types'

import * as logger from '../../src/util/logger'
import * as crypto from 'crypto'
import { sendTransaction, callContract } from '../../src/util/tx'
import axios from 'axios'
import { registerNodes } from '../../src/util/registry'
import { RPC, RPCHandler } from '../../src/server/rpc'
import { in3ProtocolVersion } from '../../src/types/constants';
import { createPK, PK } from '../../src/chains/signatures'
import { toBN, toUtf8, toMinHex } from 'in3-common/js/src/util/util';
import { BigNumber } from 'ethers/utils';
logger.setLogger('memory')

let testClient = (process && process.env && process.env.RPCURL) || 'http://localhost:8545'
if (process && process.argv) {
  const urlIndex = process.argv.findIndex(_ => _.startsWith('--rpcUrl'))
  if (urlIndex >= 0)
    testClient = process.argv[urlIndex].startsWith('-rpcUrl=') ? process.argv[urlIndex].substr(9).trim() : process.argv[urlIndex + 1]
}

export function getTestClient() {
  return testClient
}



const getAddress = util.getAddress

export type ResponseModifier = (RPCRequest, RPCResponse, url?: string) => RPCResponse

export const devPk = '0x4d5db4107d237df6a3d58ee5f70ae63d73d7658d4026f2eefd2f204c81682cb7'
export class TestTransport implements Transport {
  handlers: {
    [url: string]: RPC
  }
  url: string

  chainId: string
  registryId: string
  registryContract: string

  nodeList: ServerList
  randomList: number[][]
  lastRandom: number
  injectedResponses: {
    request: Partial<RPCRequest>,
    response: Partial<RPCResponse> | ResponseModifier,
    url: string
  }[]

  constructor(count = 5, registry?: string, pks?: PK[], handlerConfig?: Partial<IN3RPCHandlerConfig>, handlerType?: string) {
    this.chainId = '0x1'
    this.lastRandom = 0
    this.randomList = []
    this.handlers = {}
    this.injectedResponses = []
    const nodes: IN3NodeConfig[] = []
    this.registryContract = registry
    this.nodeList = {
      nodes,
      contract: registry,
      lastBlockNumber: 0,
      registryId: '0x'
    } as any
    for (let i = 0; i < count; i++) {
      const privateKey = pks ? pks[i] : createPK('0x7c4aa055bcee97a7b3132a2bf5ef2ca1f219564388c1b622000000000000000' + i)
      const url = '#' + (i + 1)
      nodes.push({
        address: privateKey.address,
        url: url,
        chainIds: [this.chainId],
        deposit: i,
        props: 255,
        index: i
      })
      this.handlers['#' + (i + 1)] = new RPC({
        port: 0,
        chains: {
          [this.chainId]: {
            handler: (handlerType as any),
            watchInterval: -1,
            rpcUrl: [getTestClient()],
            privateKey: privateKey as any,
            registry,
            minBlockHeight: 0,
            ...handlerConfig
          }
        }
      }, this, this.nodeList)
    }
    this.url = getTestClient()
  }
  injectRandom(randomVals: number[]) {
    this.randomList.push(randomVals)
  }
  injectResponse(request: Partial<RPCRequest>, response: (Partial<RPCResponse> | ResponseModifier), url = '') {
    this.injectedResponses.push({
      request, response, url
    })
  }

  isOnline(): Promise<boolean> {
    return Promise.resolve(true)
  }
  async mustFail(p: Promise<any>): Promise<any> {
    return p.then(_ => Promise.reject(new Error('Must have failed')), err => true)
  }

  defineGetFromServer(url: string, chain: string) {

    (this.handlers[url].handlers[chain] as any).getFromServer = 
    (request: Partial<RPCRequest>, r?: any, rpc?: string): Promise<RPCResponse> => {

      //console.log(JSON.stringify(request))
      for (const ir of this.injectedResponses) {
        if ( ir.request.method !== request.method && ir.request.params !== request.params) continue
        
        logger.debug('Response (injected in local getfromserver) : ', { id: request.id, ...ir.response })
        return Promise.resolve( ir.response as RPCResponse )
      }
  }; 

    (this.handlers[url].handlers[chain] as any).getAllFromServer = 
    (requests: Partial<RPCRequest>[], r?: any, rpc?: string): Promise<RPCResponse[]> => {

      //console.log(JSON.stringify(requests))
      let res: RPCResponse[]
      requests.forEach(request => {
        for (const ir of this.injectedResponses) {
          if ( ir.request.method !== request.method && ir.request.params !== request.params) continue
          
          logger.debug('Response (injected in local getfromserver) : ', { id: request.id, ...ir.response })
          res.push( ir.response as RPCResponse )
        }
      });
    return Promise.resolve(res)
  }; 
    
  }


  detectFraud(client: Client, method: string, params: any[], conf: Partial<IN3Config>, fn: (req: RPCRequest, res: RPCResponse) => any | RPCResponse, mustFail = true): Promise<any> {

    this.clearInjectedResponsed()
    // now manipulate the result
    this.injectResponse({ method }, (req, res) => fn(req, res) || res)
    return client.sendRPC(method, params)
      .then(() => {
        if (mustFail)
          throw new Error('This rpc-call ' + method + ' must fail because it was manipulated, but did not')

      }, () => {
        if (!mustFail)
          throw new Error('This rpc-call ' + method + ' must not fail even though it was manipulated, but did')
      })
  }


  clearInjectedResponsed() {
    this.injectedResponses.length = 0
  }

  async getFromServer(method: string, ...params: any[]) {

    for (let i = 0; i < params.length; i++) {
      if (typeof params[i] === 'string' && params[i].startsWith("0x0")) {
        if (params[i].substr(2).length % 32 != 0 && params[i].substr(2).length % 20 != 0) {
          params[i] = toMinHex(params[i])
        }
      }
    }

    const res = await axios.post(this.url, { id: 1, jsonrpc: '2.0', method, params }, { headers: { 'Content-Type': 'application/json' } })
    if (res.status !== 200) throw new Error('Wrong status! Error getting ' + method + ' ' + JSON.stringify(params))
    if (!res.data) throw new Error('No response! Error getting ' + method + ' ' + JSON.stringify(params))
    if (res.data.error) throw new Error('Error getting ' + method + ' ' + JSON.stringify(params) + ' : ' + JSON.stringify(res.data.error))
    return res.data.result
  }

  async handle(url: string, data: RPCRequest | RPCRequest[], timeout?: number): Promise<RPCResponse | RPCResponse[]> {
    const requests = Array.isArray(data) ? data : [data]
    const results = await Promise.all(requests.map(_ => this.handleRequest(_, this.handlers[url], url)))
    return Array.isArray(data) ? results : results[0]
  }

  async handleRequest(r: RPCRequest, handler: RPC, url: string): Promise<RPCResponse> {
    logger.debug('Request for ' + url + ' : ', r)

    const responseModifiers: ResponseModifier[] = []

    for (const ir of this.injectedResponses) {
      if (ir.url && ir.url !== url) continue
      if (ir.request && ir.request.method !== r.method) continue
      if (ir.request && ir.request.params && JSON.stringify(ir.request.params) != JSON.stringify(r.params)) continue
      if (typeof ir.response === 'function')
        responseModifiers.push(ir.response)
      else {
        logger.debug('Response (injected) : ', { id: r.id, ...ir.response })
        return { jsonrpc: '2.0', id: r.id, ...ir.response }
      }
    }

    // execute the request
    const [res] = await handler.handle([r])

    logger.debug('Response  : ', res)
    return responseModifiers.reduce((p, m) => m(r, p, url), res)
  }

  nextRandom() {
    this.lastRandom += 0.2
    if (this.lastRandom >= 1) this.lastRandom -= 1
    return this.lastRandom
  }


  random(count: number): number[] {
    const result = this.randomList.pop() || []
    for (let i = result.length; i < count; i++)
      result.push(this.nextRandom())
    return result
  }

  async createClient(conf?: Partial<IN3Config>): Promise<Client> {
    const cache = {}
    const client = new Client({
      keepIn3: true,
      chainId: this.chainId,
      timeout: 9999999,
      loggerUrl: '',
      cacheStorage: {
        setItem(k: string, v: string) {
          cache[k] = v
        },
        getItem(k: string) {
          return cache[k]
        }
      },
      servers: {
        [this.chainId]: {
          contract: this.nodeList.contract || 'dummy',
          nodeList: this.nodeList.nodes,
          registryId: this.registryId || '0x'
        } as any
      },
      ...(conf || {})
    }, this)
    await client.updateNodeList(client.defConfig.chainId, { proof: 'none' })
    return client
  }

  /** creates a random private key and transfers some ether to this address */
  async createAccount(seed?: string, eth: any = toBN('50000000000000000000')): Promise<PK> {
    const pkBuffer = seed
      ? seed.startsWith('0x')
        ? Buffer.from(seed.substr(2).padStart(64, '0'), 'hex')
        : Buffer.from(seed.padStart(64, '0'), 'hex')
      : crypto.randomBytes(32)

    const pk = '0x' + pkBuffer.toString('hex')
    const adr = getAddress(pk)

    if (eth)
      await sendTransaction(this.url, {
        privateKey: createPK(devPk),
        gas: 222000,
        to: adr,
        data: '',
        value: eth,
        confirm: true
      })

    return createPK(pk)
  }

  async getNodeFromContract(index: number) {
    const [url, deposit, timeout, registerTime, props, weight, signer, proofHash] = await callContract(this.url, this.nodeList.contract, 'nodes(uint):(string,uint,uint64,uint64,uint128,uint64,address,bytes32)', [index])
    return { url, deposit, timeout, registerTime, props, weight, signer, proofHash }
  }

  async getNodeCountFromContract() {
    const [count] = await callContract(this.url, this.nodeList.contract, 'totalNodes():(uint)', [])
    return util.toNumber(count)
  }

  getHandlerPK(index: number): PK {
    return (this.handlers['#' + (index + 1)].getHandler().config as any)._pk
  }

  getHandlerConfig(index: number): IN3RPCHandlerConfig {
    return this.handlers['#' + (index + 1)].getHandler().config
  }

  getHandler(index: number): RPCHandler {
    return this.handlers['#' + (index + 1)].getHandler()
  }

  async getErrorReason(txHash?: string): Promise<string> {

    const clientVersion = await this.getFromServer('web3_clientVersion')

    if (!txHash) {
      txHash = (await this.getFromServer('eth_getBlockByNumber', 'latest', false)).transactions[0]
    }

    if (clientVersion.includes("Parity")) {
      const trace = await this.getFromServer('trace_replayTransaction', txHash, ['trace'])
      return toUtf8(trace.output)
    }
    if (clientVersion.includes("Geth")) {
      const trace = await this.getFromServer('debug_traceTransaction', txHash)
      return toUtf8("0x" + trace.returnValue)
    }
  }

  static async createWithRegisteredNodes(count: number) {
    const test = new TestTransport(1)

    const pks: PK[] = []
    const servers: any[] = []

    // create accounts
    for (let i = 0; i < count; i++) {

      pks.push(await test.createAccount(null, toBN('5000000000000000000')))
      servers.push({
        url: '#' + (i + 1),
        pk: pks[i],
        props: '0xffff',
        deposit: toBN('10000000000000000'),
        timeout: 3600
      })
    }

    //  register 1 server
    const registers = await registerNodes(pks[0], null, servers, test.chainId, test.url, new LoggingAxiosTransport())
    const res = new TestTransport(count, registers.registry, pks)
    res.registryId = registers.regId
    res.registryContract = registers.registry
    res.nodeList.contract = registers.regData
    return res
  }

  async increaseTime(secondsToIncrease) {
    await axios.post(this.url, { id: 1, jsonrpc: '2.0', method: 'evm_increaseTime', params: [secondsToIncrease] }, { headers: { 'Content-Type': 'application/json' } })
  }

}


export class LoggingAxiosTransport extends AxiosTransport {
  async handle(url: string, data: RPCRequest | RPCRequest[], timeout?: number): Promise<RPCResponse | RPCResponse[]> {
    logger.debug('Request for ' + url + ' : ', data)
    try {
      const res = await super.handle(url, data, timeout)
      logger.debug('Result : ', res)
      return (res && Array.isArray(res)) ? (<RPCResponse[]>res) : (res as RPCResponse)
    }
    catch (ex) {
      logger.error('Error handling the request :', ex)
      throw ex
    }


  }

}