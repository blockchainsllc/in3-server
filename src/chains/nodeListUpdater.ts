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

import { RPCHandler, HandlerTransport } from '../server/rpc'
import * as tx from '../util/tx'
import { createRandomIndexes, Transport, BlockData, util, storage, serialize } from 'in3-common'
import { Proof, ServerList, AccountProof, RPCRequest, IN3NodeConfig } from '../types/types'
import { toChecksumAddress, keccak256 } from 'ethereumjs-util'
import * as logger from '../util/logger'
import * as abi from 'ethereumjs-abi'


const toHex = util.toHex
const toBuffer = util.toBuffer
const bytes32 = serialize.bytes32

/** returns a nodelist filtered by the given params and proof. */
export async function getNodeList(handler: RPCHandler, nodeList: ServerList, includeProof = false, limit = 0, seed?: string, addresses: string[] = []): Promise<ServerList> {

  // TODO check blocknumber of last event.
  if (!nodeList.nodes)
    await updateNodeList(handler, nodeList)


  if (!nodeList.registryId || nodeList.registryId === '0x') {
    const registryIdRequest: RPCRequest = {
      jsonrpc: '2.0',
      id: 0,
      method: 'eth_call', params: [{
        to: nodeList.contract,
        data: '0x' + abi.simpleEncode('registryId()').toString('hex')
      },
        'latest']
    }


    const registryId = await handler.getFromServer(registryIdRequest).then(_ => _.result as string);
    if (registryId != undefined) nodeList.registryId = registryId
  }

  // if the client requires a portion of the list
  if (limit && limit < nodeList.nodes.length) {
    const nodes = nodeList.nodes

    // try to find the addresses in the node list
    const result = addresses.map(adr => nodes.findIndex(_ => _.address === adr))
    if (result.indexOf(-1) >= 0) throw new Error('The given addresses ' + addresses.join() + ' are not registered in the serverlist')

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
  const list: ServerList = { ...nodeList, proof: { ...nodeList.proof } }
  if (!includeProof) delete list.proof
  return list

}

/**
 * returns all storagekeys used to prove the storag of the registry
 * @param list 
 */
export function getStorageKeys(list: IN3NodeConfig[]) {
  // create the keys with the serverCount
  const keys: Buffer[] = [storage.getStorageArrayKey(0)]

  keys.push(storage.getStorageArrayKey(1))
  for (const n of list) {

    keys.push(storage.getStorageArrayKey(0, n.index, 5, 4))
  }
  return keys
}

/**
 * 
 * @param handler creates the proof for the storage of the registry
 * @param nodeList 
 */
export async function createNodeListProof(handler: RPCHandler, nodeList: ServerList) {

  // create the keys with the serverCount
  const keys: Buffer[] = getStorageKeys(nodeList.nodes)

  // TODO maybe we should use a block that is 6 blocks old since nobody would sign a blockhash for latest.
  const address = nodeList.contract
  const lastBlock = await handler.getFromServer({ method: 'eth_blockNumber', params: [] }).then(_ => parseInt(_.result))
  const blockNr = lastBlock ? '0x' + Math.max(nodeList.lastBlockNumber, lastBlock - (handler.config.minBlockHeight || 0)).toString(16) : 'latest'
  let req: any = ''

  // read the response,blockheader and trace from server
  const [blockResponse, proof] = await handler.getAllFromServer(req = [
    { method: 'eth_getBlockByNumber', params: [blockNr, false] },
    { method: 'eth_getProof', params: [toHex(address, 20), keys.map(_ => toHex(_, 32)), blockNr] }
  ])

  // console.log(proof.result.storageProof.map(_ => _.key + ' = ' + _.value).join('\n'))
  // error checking
  if (blockResponse.error) throw new Error('Could not get the block for ' + blockNr + ':' + JSON.stringify(blockResponse.error) + ' req: ' + JSON.stringify(req, null, 2))
  if (proof.error) throw new Error('Could not get the proof :' + JSON.stringify(proof.error, null, 2) + ' for request ' + JSON.stringify({ method: 'eth_getProof', params: [toHex(address, 20), keys.map(toHex), blockNr] }, null, 2))


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


  const start = Date.now()
  logger.info('updating nodelist ....')

  // first get the registry
  if (!list.contract) {
    list.contract = handler.config.registry
    //    const [owner, bootNodes, meta, registryContract, contractChain] = await tx.callContract(handler.config.registryRPC || handler.config.rpcUrl, handler.config.registry, 'chains(bytes32):(address,string,string,address,bytes32)', [handler.chainId])
    //    list.contract = toChecksumAddress('0x' + registryContract)
  }

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

    const registryId = await handler.getFromServer(registryIdRequest).then(_ => _.result as string);
    list.registryId = registryId

  }

  // number of registered servers
  const [serverCount] = await tx.callContract(handler.config.rpcUrl, list.contract, 'totalNodes():(uint)', [])
  list.lastBlockNumber = lastBlockNumber || parseInt(await handler.getFromServer({ method: 'eth_blockNumber', params: [] }).then(_ => _.result as string))
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
        'latest']
    })

  list.nodes = await handler.getAllFromServer(nodeRequests).then(all => all.map((n, i) => {
    // invalid requests must be filtered out
    if (n.error) return null
    const [url, deposit, timeout, registerTime, props, weight, signer, proofHash] = abi.simpleDecode('nodes(uint):(string,uint,uint64,uint64,uint128,uint64,address,bytes32)', toBuffer(n.result))

    return {
      url,
      address: toChecksumAddress(signer),
      index: i,
      deposit: deposit.toString(),
      props: props.toString(),
      chainIds: [handler.chainId],
      timeout: timeout.toString(),
      registerTime: registerTime.toString(),
      weight: weight.toString(),
      proofHash: (proofHash).toString('hex')
    } as IN3NodeConfig

  })).then(_ => _)

  // create the proof
  list.proof = await createNodeListProof(handler, list)
  logger.info('... finish updating nodelist execTime: ' + (Date.now() - start) + 'ms')
  //    delete (handler as any).isUpdating
  //    isUpdating.forEach(_ => _.res())

  //}
  //  catch (x) {
  //    delete (handler as any).isUpdating
  //    isUpdating.forEach(_ => _.rej(x))
  //  throw x
  //}

}

