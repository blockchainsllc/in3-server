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

import  { Transport, AxiosTransport, util } from 'in3-common'
import Client from 'in3'
import  {  RPCRequest, RPCResponse, IN3NodeConfig, IN3Config,  ServerList, IN3RPCHandlerConfig } from '../../src/model/types'

import * as logger from '../../src/util/logger'
import * as crypto from 'crypto'
import { sendTransaction, callContract } from '../../src/util/tx'
import axios from 'axios'
import { registerServers } from '../../src/util/registry'
import { RPC, RPCHandler } from '../../src/server/rpc'
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

  chainRegistry: string
  chainId: string


  nodeList: ServerList
  randomList: number[][]
  lastRandom: number
  injectedResponses: {
    request: Partial<RPCRequest>,
    response: Partial<RPCResponse> | ResponseModifier,
    url: string
  }[]

  constructor(count = 5, registry?: string, pks?: string[], handlerConfig?: Partial<IN3RPCHandlerConfig>) {
    this.chainId = '0x1'
    this.lastRandom = 0
    this.randomList = []
    this.handlers = {}
    this.injectedResponses = []
    const nodes: IN3NodeConfig[] = []
    this.nodeList = {
      nodes,
      contract: registry,
      lastBlockNumber: 0
    }
    for (let i = 0; i < count; i++) {
      const privateKey = pks ? pks[i] : '0x7c4aa055bcee97a7b3132a2bf5ef2ca1f219564388c1b622000000000000000' + i
      const url = '#' + (i + 1)
      nodes.push({
        address: util.getAddress(privateKey),
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
            watchInterval: -1,
            rpcUrl: getTestClient(),
            privateKey,
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
    const client = new Client({
      keepIn3: true,
      chainId: this.chainId,
      timeout: 9999999,
      loggerUrl: '',
      servers: {
        [this.chainId]: {
          contract: this.nodeList.contract || 'dummy',
          nodeList: this.nodeList.nodes
        }
      },
      ...(conf || {})
    }, this)
    await client.updateNodeList(client.defConfig.chainId, { proof: 'none' })
    return client
  }

  /** creates a random private key and transfers some ether to this address */
  async createAccount(seed?: string, eth = 100000): Promise<string> {
    const pkBuffer = seed
      ? seed.startsWith('0x')
        ? Buffer.from(seed.substr(2).padStart(64, '0'), 'hex')
        : Buffer.from(seed.padStart(64, '0'), 'hex')
      : crypto.randomBytes(32)

    const pk = '0x' + pkBuffer.toString('hex')
    const adr = getAddress(pk)

    if (eth)
      await sendTransaction(this.url, {
        privateKey: devPk,
        gas: 222000,
        to: adr,
        data: '',
        value: eth,
        confirm: true
      })

    return pk
  }

  async getServerFromContract(index: number) {
    const [url, owner, deposit, props, time, caller] = await callContract(this.url, this.nodeList.contract, 'servers(uint):(string,address,uint,uint,uint128,uint128,address)', [index])
    return { url, owner, deposit, props, time, caller }
  }

  async getServerCountFromContract() {
    const [count] = await callContract(this.url, this.nodeList.contract, 'totalServers():(uint)', [])
    //return util.toNumber(count)
    return count.toNumber()
  }

  getHandlerConfig(index: number): IN3RPCHandlerConfig {
    return this.handlers['#' + (index + 1)].getHandler().config
  }

  getHandler(index: number): RPCHandler {
    return this.handlers['#' + (index + 1)].getHandler()
  }

  static async createWithRegisteredServers(count: number) {
    const test = new TestTransport(1)

    const pks: string[] = []
    const servers: any[] = []

    // create accounts
    for (let i = 0; i < count; i++) {
      pks.push(await test.createAccount())
      servers.push({
        url: '#' + (i + 1),
        pk: pks[i],
        props: '0xffff',
        deposit: 10000
      })
    }

    //  register 1 server
    const registers = await registerServers(pks[0], null, servers, test.chainId, null, test.url, new LoggingAxiosTransport())

    const res = new TestTransport(count, registers.registry, pks)
    res.chainRegistry = registers.chainRegistry
    return res
  }



}


export class LoggingAxiosTransport extends AxiosTransport {
  async handle(url: string, data: RPCRequest | RPCRequest[], timeout?: number): Promise<RPCResponse | RPCResponse[]> {
    logger.debug('Request for ' + url + ' : ', data)
    try {
      const res = await super.handle(url, data, timeout)
      logger.debug('Result : ', res)
      return res
    }
    catch (ex) {
      logger.error('Error handling the request :', ex)
      throw ex
    }


  }

}