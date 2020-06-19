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
const Sentry = require('@sentry/node');

import { RPCHandler, HandlerTransport } from '../server/rpc'
import * as tx from '../util/tx'
import { createRandomIndexes, Transport, BlockData, util, storage, serialize } from 'in3-common'
import { Proof, ServerList, AccountProof, RPCRequest, IN3NodeConfig, WhiteList } from '../types/types'
import { toChecksumAddress, keccak256 } from 'ethereumjs-util'
import * as logger from '../util/logger'
import * as abi from 'ethereumjs-abi'
import { setOpError } from '../util/sentryError'
import axios from 'axios'


const toHex = util.toHex
const toBuffer = util.toBuffer
const bytes32 = serialize.bytes32


async function updateContractAdr(handler: RPCHandler, list: ServerList): Promise<boolean> {
  const nodeRegistryData: RPCRequest = {
    jsonrpc: '2.0',
    id: 0,
    method: 'eth_call', params: [{
      to: handler.config.registry,
      data: '0x' + abi.simpleEncode('nodeRegistryData()').toString('hex')
    },
      'latest']
  }

  if (process.env.SENTRY_ENABLE === 'true') {
    Sentry.addBreadcrumb({
      category: "nodeRegistryData request",
      data: nodeRegistryData
    })
  }

  let contractVersion2: boolean = false

  // we try to read the registryData-contract. If there is none, this is an old contract and we use the registry, but if there is, we use the data contract.
  list.contract = await handler.getFromServer(nodeRegistryData, nodeRegistryData, handler.config.registryRPC || handler.config.rpcUrl[0]).then(_ => {
    const r = _.result as string
    if (r === '0x' || _.error) return handler.config.registry // the error occurs on parity because the method does not exist.
    contractVersion2 = true
    return '0x' + r.substr(r.length - 40)
  })

  return contractVersion2
}

/** returns a nodelist filtered by the given params and proof. */
export async function getNodeList(handler: RPCHandler, nodeList: ServerList, includeProof = false, limit = 0, seed?: string, addresses: string[] = []): Promise<ServerList> {
  try {
    if (process.env.SENTRY_ENABLE === 'true') {
      Sentry.addBreadcrumb({
        category: "getNodeList",
        data: {
          includeProof: includeProof,
          limit: limit,
          seed: seed,
          addresses: addresses
        }
      })
    }
    // TODO check blocknumber of last event.
    if (!nodeList.nodes)
      await updateNodeList(handler, nodeList)


    if (!nodeList.registryId || nodeList.registryId === '0x') {
      await updateContractAdr(handler, nodeList)
      const registryIdRequest: RPCRequest = {
        jsonrpc: '2.0',
        id: 0,
        method: 'eth_call', params: [{
          to: nodeList.contract,
          data: '0x' + abi.simpleEncode('registryId()').toString('hex')
        },
          'latest']
      }

      if (process.env.SENTRY_ENABLE === 'true') {

        Sentry.addBreadcrumb({
          category: "registryId request",
          data: registryIdRequest
        })
      }
      const registryId = await handler.getFromServer(registryIdRequest).then(_ => _.result as string).catch(_ => {

        Sentry.configureScope((scope) => {
          scope.setTag("nodeListUpdater", "registryId");
          scope.setTag("NodeList-address", nodeList.contract)
          scope.setExtra("NodeList-response", _)
        });
        throw new Error(_)
      });
      if (registryId != undefined) nodeList.registryId = registryId
    }

    // if the client requires a portion of the list
    if (limit && limit < nodeList.nodes.length) {
      const nodes = nodeList.nodes

      // try to find the addresses in the node list
      const result = addresses.map(adr => nodes.findIndex(_ => _.address === adr))
      if (result.indexOf(-1) >= 0)// throw new Error('The given addresses ' + addresses.join() + ' are not registered in the serverlist', "getNodeList")
        throw new Error('The given addresses ' + addresses.join() + ' are not registered in the serverlist')
      createRandomIndexes(nodes.length, limit, bytes32(seed), result)

      const nl: ServerList = {
        totalServers: nodeList.totalServers,
        contract: nodeList.contract,
        lastBlockNumber: nodeList.lastBlockNumber,
        nodes: result.map(i => nodeList.nodes[i]),
        registryId: nodeList.registryId
      }

      if (includeProof) {
        const storageProof = nodeList.proof.accounts[nodeList.contract].storageProof
        nl.proof = {
          ...nodeList.proof,
          accounts: {
            [nodeList.contract]: {
              ...nodeList.proof.accounts[nodeList.contract],
              storageProof: getStorageKeys(nl.nodes).map(k => storageProof.find(_ => bytes32(_.key).equals(k)))
            }
          }
        }
      }

      return nl
    }

    // clone result
    const list: ServerList = { ...nodeList, nodes: [...nodeList.nodes.map(_ => ({ ..._ }))], proof: { ...nodeList.proof } }
    if (!includeProof) delete list.proof
    return list

  } catch (e) {
    //sending call to adapter
    setOpError(e);
  }
}

/**
 * returns all storagekeys used to prove the storag of the registry
 * @param list 
 */
export function getStorageKeys(list: IN3NodeConfig[]) {
  // create the keys with the serverCount
  const keys: Buffer[] = [
    storage.getStorageArrayKey(0),
    storage.getStorageArrayKey(1)
  ]
  for (const n of list.filter(_ => _)) {
    keys.push(storage.getStorageArrayKey(0, n.index, 5, 4))
  }
  return keys
}

/**
 * 
 * @param handler creates the proof for the storage of the registry
 * @param nodeList 
 */
export async function createNodeListProof(handler: RPCHandler, nodeList: ServerList | WhiteList, paramKeys?: string[], paramBlockNr?: number) {

  let keys: Buffer[] = []
  if (!paramKeys)
    // create the keys with the serverCount
    keys = getStorageKeys((nodeList as ServerList).nodes)

  // TODO maybe we should use a block that is 6 blocks old since nobody would sign a blockhash for latest.
  const address = nodeList.contract
  const lastBlock = paramBlockNr ? 0 : (await handler.getFromServer({ method: 'eth_blockNumber', params: [] }, undefined, handler.config.registryRPC).then(_ => parseInt(_.result))) //no need to see last block if paramBlockNr is alreay provided in params
  const blockNr = paramBlockNr ? toHex(paramBlockNr) : (lastBlock ? toHex(Math.max(nodeList.lastBlockNumber, lastBlock - (handler.config.minBlockHeight || 0))) : 'latest')
  let req: any = ''

  // read the response,blockheader and trace from server
  const [blockResponse, proof] = await handler.getAllFromServer(req = [
    { method: 'eth_getBlockByNumber', params: [blockNr, false] },
    { method: 'eth_getProof', params: [toHex(address, 20), paramKeys || keys.map(_ => toHex(_, 32)), blockNr] }
  ], undefined, handler.config.registryRPC)

  if (process.env.SENTRY_ENABLE === 'true') {
    Sentry.addBreadcrumb({
      category: "createNodeListProof",
      data: {
        blockResponse: blockResponse,
        proof: proof
      }
    })
  }

  // console.log(proof.result.storageProof.map(_ => _.key + ' = ' + _.value).join('\n'))
  // error checking
  if (blockResponse.error) {
    if (process.env.SENTRY_ENABLE === 'true') {

      Sentry.configureScope((scope) => {
        scope.setTag("nodeListUpdater", "createNodeListProof");
        scope.setTag("nodeList-contract", this.config.registry)
        scope.setExtra("params", blockNr)
        scope.setExtra("blockResponse", blockResponse)
      });
    }
    throw new Error('Could not get the block for ' + blockNr + ':' + JSON.stringify(blockResponse.error) + ' req: ' + JSON.stringify(req, null, 2))
  }
  if (proof.error) {

    if (process.env.SENTRY_ENABLE === 'true') {

      Sentry.configureScope((scope) => {
        scope.setTag("nodeListUpdater", "createNodeListProof");
        scope.setTag("nodeList-contract", this.config.registry)
        scope.setExtra("params", [toHex(address, 20), keys.map(_ => toHex(_, 32)), blockNr])
        scope.setExtra("proof", proof)
      });
    }
    throw new Error('Could not get the proof :' + JSON.stringify(proof.error, null, 2) + ' for request ' + JSON.stringify({ method: 'eth_getProof', params: [toHex(address, 20), keys.map(toHex), blockNr] }, null, 2))
  }

  // make sure we use minHex for the proof-keys
  if (proof.result && proof.result.storageProof)
    proof.result.storageProof.forEach(p => p.key = util.toMinHex(p.key))

  // anaylse the transaction in order to find all needed storage
  const block = blockResponse.result as BlockData
  const account = proof.result as AccountProof

  // bundle the answer
  return {
    type: 'accountProof',
    block: serialize.blockToHex(block),
    accounts: { [address]: account }
  } as Proof
}


/**
 * updates the given nodelist from the registry contract.
 */
export async function updateNodeList(handler: RPCHandler, list: ServerList, lastBlockNumber?: number) {
  //  let isUpdating: any[] = (handler as any).isUpdating
  //  if (isUpdating)
  //    return new Promise((res, rej) => { isUpdating.push({ res, rej }) });
  //  (handler as any).isUpdating = isUpdating = []

  //  try {
  

  const contractVersion2 = await updateContractAdr(handler, list)

  const start = Date.now()
  logger.info('updating nodelist ....')
  if (process.env.SENTRY_ENABLE === 'true') {
    Sentry.addBreadcrumb({
      category: "updateNodeList",
      data: {
        list: list,
        lastBlockNumber: lastBlockNumber,
        contract: handler.config.registry
      }
    })
  }

  // first get the registry
  //  if (!list.contract) {

  // let us find the data contract

  if (!list.registryId) {
    const registryIdRequest: RPCRequest = {
      jsonrpc: '2.0',
      id: 0,
      method: 'eth_call', params: [{
        to: list.contract,
        data: '0x' + abi.simpleEncode('registryId()').toString('hex')
      },
        'latest']
    }

    if (process.env.SENTRY_ENABLE === 'true') {
      Sentry.addBreadcrumb({
        category: "registryId request",
        data: registryIdRequest
      })
    }

    const registryId = await handler.getFromServer(registryIdRequest, registryIdRequest, handler.config.registryRPC).then(_ => _.result as string);
    list.registryId = registryId

  }

  const latestBlockNum = await handler.getFromServer({ method: 'eth_blockNumber', params: [] }, undefined, handler.config.registryRPC).then(_ => parseInt(_.result as string))
  const finalityBlockNum = handler.config.minBlockHeight ? (latestBlockNum - handler.config.minBlockHeight) : latestBlockNum
  // number of registered servers
  const [serverCount] = await tx.callContract(handler.config.registryRPC || handler.config.rpcUrl[0], list.contract, 'totalNodes():(uint)', [], undefined, undefined, finalityBlockNum)

  list.lastBlockNumber = (finalityBlockNum ? finalityBlockNum : latestBlockNum)
  list.totalServers = serverCount.toNumber()

  // build the requests per server-entry
  const nodeRequests: RPCRequest[] = []
  for (let i = 0; i < serverCount.toNumber(); i++)
    nodeRequests.push({
      jsonrpc: '2.0',
      id: i + 1,
      method: 'eth_call', params: [{
        to: list.contract,
        data: '0x' + abi.simpleEncode('nodes(uint)', toHex(i, 32)).toString('hex')
      },
      (finalityBlockNum ? toHex(finalityBlockNum) : 'latest')]
    })

  list.nodes = await handler.getAllFromServer(nodeRequests, undefined, handler.config.registryRPC).then(all => all.map((n, i) => {
    // invalid requests must be filtered out
    if (n.error) return null

    try {
      let url: string = '', deposit: any, timeout = 40 * 24 * 3600, registerTime: any, props: any, weight: any, signer: string, proofHash: any

      if (contractVersion2)
        [url, deposit, registerTime, props, weight, signer, proofHash] = abi.simpleDecode(
          'nodes(uint):(string,uint,uint64,uint192,uint64,address,bytes32)'
          , toBuffer(n.result))
      else
        [url, deposit, timeout, registerTime, props, weight, signer, proofHash] = abi.simpleDecode(
          'nodes(uint):(string,uint,uint64,uint64,uint128,uint64,address,bytes32)'
          , toBuffer(n.result))


      return {
        url,
        address: '0x' + signer.toLowerCase(),
        index: i,
        deposit: '0x' + deposit.toString(16),
        props: '0x' + props.toString(16),
        timeout: util.toNumber(timeout),
        registerTime: util.toNumber(registerTime),
        weight: util.toNumber(weight)
      } as any as IN3NodeConfig
    } catch (e) {
      if (process.env.SENTRY_ENABLE === 'true') {

        Sentry.configureScope((scope) => {
          scope.setTag("nodeListUpdater", "updateNodeList");
          scope.setTag("ABIError", "decode");
          scope.setTag("nodeList-contract", handler.config.registry)
          scope.setExtra("node", n.result)
        });
      }
      throw new Error(e)
    }

  })).then(_ => _)

  // create the proof and ensure proof is not null, in case it is always null after multiple attempts then mark server unhealthy
  let attempt: number = 1
  let proof: Proof = undefined
  do {
    proof = await createNodeListProof(handler, list).catch(err => {
      logger.error('... no proof created : attempt ' + attempt + ':' + err.message)
      return undefined
    })
    attempt++
  } while (!proof && attempt <= 5)

  if (!proof) {
    setOpError(new Error("Unable to prepare proof for nodelist."))
  }
  list.proof = proof

  logger.info('... finish updating nodelist execTime: ' + (Date.now() - start) + 'ms')
  //    delete (handler as any).isUpdating
  //    isUpdating.forEach(_ => _.res())

  //}
  //  catch (x) {
  //    delete (handler as any).isUpdating
  //    isUpdating.forEach(_ => _.rej(x))
  //  throw x
  //}
  updatePerformance(handler, list);

}

const healthInterval = 3600 * 1000
let isUpdating: any = null
let isChecking: boolean = false
function updatePerformance(handler: RPCHandler, list: ServerList) {
  const wasChecking = isChecking
  if (isUpdating) {
    clearTimeout(isUpdating)
    isUpdating = null
  }

  const next = () => {
    if (wasChecking) return
    isChecking = false
    isUpdating = setTimeout(updatePerformance, healthInterval, handler, list)
  }

  if (list.nodes && list.nodes.length && list.nodes.find(_ => !_.url.startsWith('#'))) {
    isChecking = true
    Promise.all(list.nodes.map(async n => {
      const start = Date.now()
      let healthy = await axios.get(n.url + '/health').then(_ => _.data && _.data.status === 'healthy', err => false)
      const p = n.performance || (n.performance = { count: 0, total: 0, last_failed: 0 })
      p.count++
      p.total += Date.now() - start
      p.last_failed = healthy ? 0 : start
    })).then(next, next)
  }





}