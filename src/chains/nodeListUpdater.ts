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

import { RPCHandler } from '../server/rpc'
import * as tx from '../util/tx'
import * as abi from 'ethereumjs-abi'
import { createRandomIndexes, Proof, ServerList, BlockData, AccountProof, RPCRequest, IN3NodeConfig, util, storage, serialize } from 'in3'
import { toChecksumAddress, keccak256 } from 'ethereumjs-util'

const toHex = util.toHex
const toBuffer = util.toBuffer
const bytes32 = serialize.bytes32

/** returns a nodelist filtered by the given params and proof. */
export async function getNodeList(handler: RPCHandler, nodeList: ServerList, includeProof = false, limit = 0, seed?: string, addresses: string[] = []): Promise<ServerList> {

  // TODO check blocknumber of last event.
  if (!nodeList.nodes)
    await updateNodeList(handler, nodeList)

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
      nodes: result.map(i => nodeList.nodes[i])
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

  for (const n of list) {
    for (let i = 0; i < 4; i++)
      keys.push(storage.getStorageArrayKey(0, n.index, 5, i))
    const urlKey = util.toBN(keccak256(keys[keys.length - 4]))
    if (n.url.length > 31) {
      for (let i = 0; i < n.url.length / 32; i++)
        keys.push(bytes32(urlKey.add(util.toBN(i))))
    }
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

  // read the response,blockheader and trace from server
  const [blockResponse, proof] = await handler.getAllFromServer([
    { method: 'eth_getBlockByNumber', params: [blockNr, false] },
    { method: 'eth_getProof', params: [toHex(address, 20), keys.map(_ => toHex(_, 32)), blockNr] }
  ])

  // console.log(proof.result.storageProof.map(_ => _.key + ' = ' + _.value).join('\n'))
  // error checking
  if (blockResponse.error) throw new Error('Could not get the block for ' + blockNr + ':' + blockResponse.error)
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

  // first get the registry
  if (!list.contract) {
    list.contract = handler.config.registry
    //    const [owner, bootNodes, meta, registryContract, contractChain] = await tx.callContract(handler.config.registryRPC || handler.config.rpcUrl, handler.config.registry, 'chains(bytes32):(address,string,string,address,bytes32)', [handler.chainId])
    //    list.contract = toChecksumAddress('0x' + registryContract)
  }

  // number of registered servers
  const [serverCount] = await tx.callContract(handler.config.rpcUrl, list.contract, 'totalServers():(uint)', [])
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
        data: '0x' + abi.simpleEncode('servers(uint)', toHex(i, 32)).toString('hex')
      },
        'latest']
    })

  list.nodes = await handler.getAllFromServer(nodeRequests).then(all => all.map((n, i) => {
    // invalid requests must be filtered out
    if (n.error) return null
    const [url, owner, timeout, deposit, props, unregisterTime] = abi.simpleDecode('servers(uint):(string,address,uint64,uint,uint,uint,address)', toBuffer(n.result))

    return {
      url,
      address: toChecksumAddress(owner),
      index: i,
      deposit: parseInt(deposit.toString()),
      props: props.toNumber(),
      chainIds: [handler.chainId],
      unregisterRequestTime: unregisterTime.toNumber()
    } as IN3NodeConfig

  })).then(_ => _)

  // create the proof
  list.proof = await createNodeListProof(handler, list)


}

