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

import BaseHandler from './BaseHandler'
import { BlockData, RPCRequest, RPCResponse, Signature, util, serialize } from 'in3'
import { keccak, pubToAddress, ecrecover, ecsign } from 'ethereumjs-util'
import { callContract } from '../util/tx'
import { LRUCache } from '../util/cache'

const toHex = util.toHex
const toMinHex = util.toMinHex
const toNumber = util.toNumber
const bytes32 = serialize.bytes32
const address = serialize.address
const bytes = serialize.bytes

export const signatureCaches: LRUCache = new LRUCache();

export async function collectSignatures(handler: BaseHandler, addresses: string[], requestedBlocks: { blockNumber: number, hash?: string }[], verifiedHashes: string[]): Promise<Signature[]> {
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
  const uniqueAddresses =   [...new Set(addresses.map(item => item))];
  return Promise.all(uniqueAddresses.slice(0, nodes.nodes.length).map(async adr => {
    // find the requested address in our list
    const config = nodes.nodes.find(_ => _.address.toLowerCase() === adr.toLowerCase())
    if (!config) // TODO do we need to throw here or is it ok to simply not deliver the signature?
      throw new Error('The requested signature ' + adr + ' does not exist within the current nodeList!')
    

    // get cache signatures and remaining blocks that have no signatures
    const cachedSignatures: Signature[] = []
    const blocksToRequest = blocks.filter(b => {
      const s = signatureCaches.get(b.hash) && false
      return s ? cachedSignatures.push(s) * 0 : true
    })

    // send the sign-request
    const response = (blocksToRequest.length ? await handler.transport.handle(config.url, { id: handler.counter++ || 1, jsonrpc: '2.0', method: 'in3_sign', params: blocksToRequest }) : { result: [] }) as RPCResponse
    if (response.error)
      throw new Error('Could not get the signature from ' + adr + ' for blocks ' + blocks.map(_ => _.blockNumber).join() + ':' + response.error)

    const signatures = [...cachedSignatures, ...response.result] as Signature[]

    // if there are signature, we only return the valid ones
    if (signatures && signatures.length)
      return Promise.all(signatures.map(async s => {

        // first check the signature
        const signatureMessageHash: Buffer = keccak(Buffer.concat([bytes32(s.blockHash), bytes32(s.block)]))
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


        // is the blockhash correct all is fine
        if (bytes32(s.blockHash).equals(bytes32(expectedBlock.hash))) {
          // add signature entry in cache
          if (!signatureCaches.has(expectedBlock.hash))
            signatureCaches.set(expectedBlock.hash, { ...s })

          return s
        }


        // so he signed the wrong blockhash and we have all data to convict him!
        const txHash = await callContract(handler.config.rpcUrl, nodes.contract, 'convict(uint,bytes32,uint,uint8,bytes32,bytes32)', [toNumber(singingNode.index), s.blockHash, s.block, s.v, s.r, s.s], {
          privateKey: handler.config.privateKey,
          gas: 300000,
          value: 0,
          confirm: false                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
        })
        return null
      }))

    return signatures
  })).then(a => a.filter(_ => _).reduce((p, c) => [...p, ...c], []))

}

export function sign(pk: string, blocks: { blockNumber: number, hash: string }[]): Signature[] {
  return blocks.map(b => {
    const msgHash = keccak('0x' + toHex(b.hash).substr(2).padStart(64, '0') + toHex(b.blockNumber).substr(2).padStart(64, '0'))
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
    result: sign(handler.config.privateKey, blockData.map(b => ({ blockNumber: toNumber(b.number), hash: b.hash })))
  }
}
