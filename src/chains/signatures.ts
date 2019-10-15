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

import BaseHandler from './BaseHandler'
import { BlockData, util, serialize } from 'in3-common'
import { RPCRequest, RPCResponse, Signature, ServerList, IN3NodeConfig } from '../types/types'
import { keccak, pubToAddress, ecrecover, ecsign } from 'ethereumjs-util'
import { callContract } from '../util/tx'
import { LRUCache } from '../util/cache'
import * as logger from '../util/logger'
import config from '../server/config'
import { toBuffer } from 'in3-common/js/src/util/util';
import { SentryError } from '../util/sentryError'


const toHex = util.toHex
const toMinHex = util.toMinHex
const toNumber = util.toNumber
const bytes32 = serialize.bytes32
const address = serialize.address
const bytes = serialize.bytes

export const signatureCaches: LRUCache = new LRUCache();

function checkBlockHash(hash: any, expected: any, s: any) {
  // is the blockhash correct all is fine
  if (bytes32(hash).equals(bytes32(expected))) {
    // add signature entry in cache
    if (!signatureCaches.has(expected))
      signatureCaches.set(expected, { ...s })
    return s
  }
  return null
}

export async function collectSignatures(handler: BaseHandler, addresses: string[], requestedBlocks: { blockNumber: number, hash?: string }[], verifiedHashes: string[]): Promise<Signature[]> {
  // DOS-Protection
  if (addresses && addresses.length > config.maxSignatures) throw new Error('Too many signatures requested!')
  if (requestedBlocks && requestedBlocks.length > config.maxBlocksSigned) throw new Error('Too many blocks to sign! Try to reduce the blockrange!')
  // nothing to do?
  if (!addresses || !addresses.length || !requestedBlocks || !requestedBlocks.length) return []

  // make sure the 
  let blocks = await Promise.all(requestedBlocks.map(async b => ({
    blockNumber: toNumber(b.blockNumber),
    hash: toHex(b.hash || await handler.getFromServer({ method: 'eth_getBlockByNumber', params: [toMinHex(b.blockNumber), false] })
      .then(_ => _.result && _.result.hash), 32)
  }))).then(allBlocks => !verifiedHashes ? allBlocks : allBlocks.filter(_ => verifiedHashes.indexOf(_.hash) < 0))


  if (!blocks.length) return []

  // get our own nodeList
  const nodes = await handler.getNodeList(false)
  const uniqueAddresses = [...new Set(addresses.map(item => item))];
  return Promise.all(uniqueAddresses.slice(0, nodes.nodes.length).map(async adr => {
    // find the requested address in our list
    const config = nodes.nodes.find(_ => _.address.toLowerCase() === adr.toLowerCase())
    if (!config) // TODO do we need to throw here or is it ok to simply not deliver the signature?
      throw new Error('The ' + adr + ' does not exist within the current registered active nodeList!')

    // get cache signatures and remaining blocks that have no signatures
    const cachedSignatures: Signature[] = []
    const blocksToRequest = blocks.filter(b => {
      const s = signatureCaches.get(b.hash) && false
      return s ? cachedSignatures.push(s) * 0 : true
    })

    // send the sign-request
    let response: RPCResponse
    try {
      response = (blocksToRequest.length
        ? await handler.transport.handle(config.url, { id: handler.counter++ || 1, jsonrpc: '2.0', method: 'in3_sign', params: blocksToRequest })
        : { result: [] }) as RPCResponse
      if (response.error) {
        //throw new Error('Could not get the signature from ' + adr + ' for blocks ' + blocks.map(_ => _.blockNumber).join() + ':' + response.error)
        logger.error('Could not get the signature from ' + adr + ' for blocks ' + blocks.map(_ => _.blockNumber).join() + ':' + response.error)
        return null
      }
    } catch (error) {
      logger.error(error.toString())
      return null
    }


    const signatures = [...cachedSignatures, ...response.result] as Signature[]


    // if there are signature, we only return the valid ones
    if (signatures && signatures.length)
      return Promise.all(signatures.map(async s => {

        // first check the signature
        const signatureMessageHash: Buffer = keccak(Buffer.concat([bytes32(s.blockHash), bytes32(s.block), bytes32((nodes as any).registryId)]))
        if (!bytes32(s.msgHash).equals(signatureMessageHash)) // the message hash is wrong and we don't know what he signed
          return null // can not use it to convict

        // recover the signer from the signature
        const signer: Buffer = pubToAddress(ecrecover(signatureMessageHash, toNumber(s.v), bytes(s.r), bytes(s.s)))
        const singingNode = signer.equals(address(adr))
          ? config
          : nodes.nodes.find(_ => address(_.address).equals(signer))

        if (!singingNode) return null // if we don't know the node, we can not convict anybody.

        const expectedBlock = blocks.find(_ => toNumber(_.blockNumber) === toNumber(s.block))
        if (!expectedBlock) {
          // hm... handler node signed a different block, then we expected, but the signature is valid.
          // TODO so at least we should check if the blockhash is incorrect, so we can convict him anyway
          return null
        }

        // did we expect this?
        if (checkBlockHash(s.blockHash, expectedBlock.hash, s)) return s

        // so we have a different hash, let's double check if got the wrong hash
        expectedBlock.hash = toHex(await handler.getFromServer({ method: 'eth_getBlockByNumber', params: [toMinHex(s.block), false] })
          .then(_ => _.result && _.result.hash), 32)

        // recheck again, if this is still wrong
        if (checkBlockHash(s.blockHash, expectedBlock.hash, s)) return s

        // ok still wrong, so we start convicting the node...
        logger.info("Trying to convict node(" + singingNode.address + ") " + singingNode.url + ' because it signed wrong blockhash  with ' + JSON.stringify(s) + ' but the correct hash should be ' + expectedBlock.hash)

        const latestBlockNumber = handler.watcher.block.number
        const diffBlocks = toNumber(latestBlockNumber) - s.block
        const convictSignature: Buffer = keccak(Buffer.concat([bytes32(s.blockHash), address(singingNode.address), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))

        if (diffBlocks < 255) {

          await callContract(handler.config.rpcUrl, nodes.contract, 'convict(bytes32)', [convictSignature], {
            privateKey: handler.config.privateKey,
            gas: 500000,
            value: 0,
            confirm: false                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
          })

          handler.watcher.futureConvicts.push({
            convictBlockNumber: latestBlockNumber,
            signer: singingNode.address,
            wrongBlockHash: s.blockHash,
            wrongBlockNumber: s.block,
            v: s.v,
            r: s.r,
            s: s.s,
            recreationDone: true
          })
        }
        else {
          await handleRecreation(handler, nodes, singingNode, s, diffBlocks)
        }
        return

      }))

    return signatures
  })).then(a => a.filter(_ => _).reduce((p, c) => [...p, ...c], []))

}

export function sign(pk: string, blocks: { blockNumber: number, hash: string, registryId: string }[]): Signature[] {
  return blocks.map(b => {
    const msgHash = keccak('0x' + toHex(b.hash).substr(2).padStart(64, '0') + toHex(b.blockNumber).substr(2).padStart(64, '0') + toHex(b.registryId).substr(2).padStart(64, '0'))
    const sig = ecsign(msgHash, bytes32(pk))

    return {
      blockHash: toHex(b.hash),
      block: toNumber(b.blockNumber),
      r: toHex(sig.r),
      s: toHex(sig.s),
      v: toNumber(sig.v),
      msgHash: toHex(msgHash)
    }
  })
}

export async function handleSign(handler: BaseHandler, request: RPCRequest): Promise<RPCResponse> {
  const blocks = request.params as { blockNumber: number, hash: string }[]
  const blockData = await handler.getAllFromServer([
    ...blocks.map(b => ({ method: 'eth_getBlockByNumber', params: [toMinHex(b.blockNumber), false] })),
    { method: 'eth_blockNumber', params: [] },
  ], request).then(a => a.map(_ => _.result as BlockData))
  const blockNumber = blockData.pop() as any as string // the first arg is just the current blockNumber

  if (!blockNumber) throw new Error('no current blocknumber detectable ')
  if (blockData.find(_ => !_)) throw new Error('requested block could not be found ')

  const blockHeight = handler.config.minBlockHeight === undefined ? 6 : handler.config.minBlockHeight
  const tooYoungBlock = blockData.find(block => toNumber(blockNumber) - toNumber(block.number) < blockHeight)
  if (tooYoungBlock)
    throw new Error(' cannot sign for block ' + tooYoungBlock.number + ', because the blockHeight must be at least ' + blockHeight)

  return {
    id: request.id,
    jsonrpc: request.jsonrpc,
    result: sign(handler.config.privateKey, blockData.map(b => ({ blockNumber: toNumber(b.number), hash: b.hash, registryId: (handler.nodeList as any).registryId })))
  }
}

async function handleRecreation(handler: BaseHandler, nodes: ServerList, singingNode: IN3NodeConfig, s: Signature, diffBlocks: number): Promise<any> {

  // we have to find the blockHashRegistry
  const blockHashRegistry = (await callContract(handler.config.rpcUrl, nodes.contract, 'blockRegistry():(address)', []))[0]

  // we have to calculate whether it's worth convicting a server
  const [, deposit, , , , , , ,] = await callContract(handler.config.rpcUrl, nodes.contract, 'nodes(uint):(string,uint,uint64,uint64,uint128,uint64,address,bytes32)', [toNumber(singingNode.index)])
  const latestSS = toNumber((await callContract(handler.config.rpcUrl, blockHashRegistry, 'searchForAvailableBlock(uint,uint):(uint)', [s.block, diffBlocks]))[0])
  const costPerBlock = 86412400000000
  const blocksMissing = latestSS - s.block
  const costs = blocksMissing * costPerBlock * 1.25

  if (costs > (deposit / 2)) {

    console.log("not worth it")
    //it's not worth it
    return
  }
  else {

    // it's worth convicting the server
    const blockrequest = []
    for (let i = 0; i < blocksMissing; i++) {
      blockrequest.push({
        jsonrpc: '2.0',
        id: i + 1,
        method: 'eth_getBlockByNumber', params: [
          toHex(latestSS - i), false
        ]
      })
    }

    const blockhashes = await handler.getAllFromServer(blockrequest)

    const serialzedBlocks = []
    for (const bresponse of blockhashes) {
      serialzedBlocks.push(new serialize.Block(bresponse.result as any).serializeHeader());
    }

    const transactionArrays = []

    // splitting the blocks in array with the size of 235 (sweet spot)
    while (serialzedBlocks.length) {
      transactionArrays.push(serialzedBlocks.splice(0, 45));
    }

    let diffBlock = 0;

    const convictSignature: Buffer = keccak(Buffer.concat([bytes32(s.blockHash), address(singingNode.address), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))

    try {
      await callContract(handler.config.rpcUrl, nodes.contract, 'convict(bytes32)', [convictSignature], {
        privateKey: handler.config.privateKey,
        gas: 500000,
        value: 0,
        confirm: false                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
      })
      handler.watcher.futureConvicts.push({
        convictBlockNumber: handler.watcher.block.number,
        signer: singingNode.address,
        wrongBlockHash: s.blockHash,
        wrongBlockNumber: s.block,
        v: s.v,
        r: s.r,
        s: s.s,
        recreationDone: false
      })

    } catch (e) {
      logger.error('Error trying to recreate blocks and convict : ' + e)
      // if we are here this means we failed to convict (maybe not enough balance)
      // so there is no point in recreating blocks now.
      // so we return
      throw new SentryError('Error trying to recreate blocks and convict : ', 'convict_failed', 'nodeToConvict:' + singingNode.url + ' signature: ' + JSON.stringify(s, null, 2) + '\n  internal error = ' + e)
    }

    for (const txArray of transactionArrays) {
      try {
        await callContract(handler.config.rpcUrl, blockHashRegistry, 'recreateBlockheaders(uint,bytes[])', [latestSS - diffBlock, txArray], {
          privateKey: handler.config.privateKey,
          gas: 8000000,
          value: 0,
          confirm: false                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
        })
        diffBlock += txArray.length
      } catch (e) {
        console.log(e)
      }
    }
    handler.watcher.futureConvicts.find(_ => (_.signer === singingNode.address && _.wrongBlockHash === s.blockHash)).recreationDone = true
  }
}
