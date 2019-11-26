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

import BaseHandler from './BaseHandler'
import { BlockData, util, serialize } from 'in3-common'
import { RPCRequest, RPCResponse, Signature, ServerList, IN3NodeConfig } from '../types/types'
import { keccak, pubToAddress, ecrecover, ecsign, ECDSASignature, privateToAddress, toChecksumAddress, } from 'ethereumjs-util'
import { callContract } from '../util/tx'
import { LRUCache } from '../util/cache'
import * as logger from '../util/logger'
import config, { getSafeMinBlockHeight } from '../server/config'
import { toBuffer } from 'in3-common/js/src/util/util';
import { SentryError } from '../util/sentryError'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const toHex = util.toHex
const toMinHex = util.toMinHex
const toNumber = util.toNumber
const bytes32 = serialize.bytes32
const address = serialize.address
const bytes = serialize.bytes


const cipherAlgorithm = 'aes-192-ofb'
export const signatureCaches: LRUCache = new LRUCache();
export interface PK {
  address: string
  sign(data: Buffer): ECDSASignature
}

export function createPK(pk: Buffer | string): PK {
  const decryptPW = randomBytes(24)
  const iv = randomBytes(16)
  const cipher = createCipheriv(cipherAlgorithm, decryptPW, iv)
  const encryptedKey = Buffer.concat([cipher.update(bytes32(pk)), cipher.final()])

  return {
    address: toChecksumAddress('0x' + privateToAddress(bytes32(pk)).toString('hex')),
    sign(hash: Buffer) {
      const key = createDecipheriv(cipherAlgorithm, decryptPW, iv).update(encryptedKey)
      const sig = ecsign(hash, key)
      key.fill(0, 0, 32) // clean the private key in memory
      return sig
    }
  }
}

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

  // checking for all the nodes that return a wrong block already and remove them from the nodeRegistry
  for (const convictInfo of handler.watcher.futureConvicts) {
    const convictedNode = nodes.nodes.find(_ => _.address.toLowerCase() === convictInfo.signer.toLowerCase())

    if (convictedNode) {
      const convictedNodeIndex = nodes.nodes.indexOf(convictedNode)

      if (convictedNodeIndex > -1)
        nodes.nodes.splice(convictedNodeIndex, 1)
    }
  }

  const uniqueAddresses = [...new Set(addresses.map(item => item))];
  return Promise.all(uniqueAddresses.slice(0, nodes.nodes.length).map(async adr => {
    // find the requested address in our list
    const config = nodes.nodes.find(_ => _.address.toLowerCase() === adr.toLowerCase())
    if (!config) { // TODO do we need to throw here or is it ok to simply not deliver the signature?

      Sentry.configureScope((scope) => {

        scope.setTag("NodeListFunction", "collectSignatures");
        scope.setTag("collectSignatures", "address not found");
        scope.setTag("nodeList-contract", nodes.registryId)
        scope.setExtra("nodes", nodes.nodes)
        scope.setExtra("requestedBlocks", requestedBlocks)
      });

      throw new Error('The address ' + adr + ' does not exist within the current registered active nodeList!')
    }
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
        Sentry.configureScope((scope) => {
          scope.setTag("signatures", "collectSignatures");
          scope.setExtra("address", adr)
          scope.setExtra("blocks", blocks)
          scope.setExtra("response", response)
        });
        Sentry.captureMessage('Could not get the signature')

        //sthrow new Error('Could not get the signature from ' + adr + ' for blocks ' + blocks.map(_ => _.blockNumber).join() + ':' + response.error)
        logger.error('Could not get the signature from ' + adr + ' for blocks ' + blocks.map(_ => _.blockNumber).join() + ':' + response.error)
        return null
      }
    } catch (error) {

      logger.error(error.toString())

      Sentry.configureScope((scope) => {
        scope.setTag("signatures", "collectSignatures");
        scope.setTag("collectSignatures", "could not get signature");
        scope.setExtra("addresses", addresses)
        scope.setExtra("requestedBlocks", requestedBlocks)
      });
      Sentry.captureException(error);

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

        if (process.env.SENTRY_ENABLE === 'true') {

          Sentry.addBreadcrumb({
            category: "convict",
            data: {
              singingNode: singingNode,
              signature: s,
              expected: expectedBlock,
              chainId: handler.chainId,
              registryRPC: handler.config.registryRPC || handler.config.rpcUrl,
            }
          })
        }

        Sentry.captureMessage(`detected wrong blockResponse`)

        const latestBlockNumber = handler.watcher.block.number
        const diffBlocks = toNumber(latestBlockNumber) - s.block
        const convictSignature: Buffer = keccak(Buffer.concat([bytes32(s.blockHash), address(singingNode.address), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))

        // checking whether the signer is already in the process of being convicted
        const foundAlready = handler.watcher.futureConvicts.find(_ =>
          _.signer.toLowerCase() === singingNode.address.toLowerCase()
        )
        if (foundAlready) return

        if (!handler.watcher.blockhashRegistry) {
          handler.watcher.blockhashRegistry = (await callContract(handler.config.rpcUrl, nodes.contract, 'blockRegistry():(address)', []))[0]
        }

        handler.watcher.futureConvicts.push({
          startTime: Date.now(),
          diffBlocks: diffBlocks,
          convictBlockNumber: 0,
          signer: singingNode.address,
          wrongBlockHash: s.blockHash,
          wrongBlockNumber: s.block,
          v: s.v,
          r: s.r,
          s: s.s,
          recreationDone: false,
          signingNode: singingNode,
          signature: convictSignature
        })

      }))

    return signatures
  })).then(a => a.filter(_ => _).reduce((p, c) => [...p, ...c], []))

}


export function sign(pk: PK, blocks: { blockNumber: number, hash: string, registryId: string }[]): Signature[] {
  if (!pk) throw new Error('Missing private key')
  return blocks.map(b => {
    const msgHash = keccak('0x' + toHex(b.hash).substr(2).padStart(64, '0') + toHex(b.blockNumber).substr(2).padStart(64, '0') + toHex(b.registryId).substr(2).padStart(64, '0'))
    const sig = pk.sign(msgHash)

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

  const blockHeight = handler.config.minBlockHeight === undefined ? getSafeMinBlockHeight(handler.chainId) : handler.config.minBlockHeight
  const tooYoungBlock = blockData.find(block => toNumber(blockNumber) - toNumber(block.number) < blockHeight)
  if (tooYoungBlock)
    throw new Error(' cannot sign for block ' + tooYoungBlock.number + ', because the blockHeight must be at least ' + blockHeight)

  return {
    id: request.id,
    jsonrpc: request.jsonrpc,
    result: sign((handler.config as any)._pk, blockData.map(b => ({ blockNumber: toNumber(b.number), hash: b.hash, registryId: (handler.nodeList as any).registryId })))
  }
}
