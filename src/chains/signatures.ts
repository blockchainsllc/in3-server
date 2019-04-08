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
import { BlockData, RPCRequest, RPCResponse, Signature, util, serialize, ServerList, IN3NodeConfig } from 'in3'
import { sha3, pubToAddress, ecrecover, ecsign } from 'ethereumjs-util'
import { callContract } from '../util/tx'
import { IN3ConfigDefinition } from 'in3/js/src/types/types';

const toHex = util.toHex
const toMinHex = util.toMinHex
const toNumber = util.toNumber
const bytes32 = serialize.bytes32
const address = serialize.address
const bytes = serialize.bytes

export async function collectSignatures(handler: BaseHandler, addresses: string[], requestedBlocks: { blockNumber: number, hash?: string }[], verifiedHashes: string[]): Promise<Signature[]> {
  // nothing to do?
  if (!addresses || !addresses.length || !requestedBlocks || !requestedBlocks.length) return []

  // make sure the 
  const blocks = await Promise.all(requestedBlocks.map(async b => ({
    blockNumber: toNumber(b.blockNumber),
    hash: toHex(b.hash || await handler.getFromServer({ method: 'eth_getBlockByNumber', params: [toMinHex(b.blockNumber), false] })
      .then(_ => _.result && _.result.hash), 32)
  }))).then(allBlocks => !verifiedHashes ? allBlocks : allBlocks.filter(_ => verifiedHashes.indexOf(_.hash) < 0))

  if (!blocks.length) return []

  // get our own nodeList
  const nodes = await handler.getNodeList(false)
  return Promise.all(addresses.map(async adr => {

    // find the requested address in our list
    const config = nodes.nodes.find(_ => _.address.toLowerCase() === adr.toLowerCase())
    if (!config) // TODO do we need to throw here or is it ok to simply not deliver the signature?
      throw new Error('The requested signature ' + adr + ' does not exist within the current nodeList!')

    // send the sign-request
    const response = await handler.transport.handle(config.url, { id: handler.counter++ || 1, jsonrpc: '2.0', method: 'in3_sign', params: [...blocks] }) as RPCResponse
    if (response.error)
      throw new Error('Could not get the signature from ' + adr + ' for blocks ' + blocks.map(_ => _.blockNumber).join() + ':' + response.error)

    const signatures = response.result as Signature[]

    // if there are signature, we only return the valid ones
    if (signatures && signatures.length)
      return Promise.all(signatures.map(async s => {

        // first check the signature
        const signatureMessageHash: Buffer = sha3(Buffer.concat([bytes32(s.blockHash), bytes32(s.block)]))
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
        if (bytes32(s.blockHash).equals(bytes32(expectedBlock.hash)))
          return s

        const latestBlockNumber = (await handler.getFromServer({ method: "eth_blockNumber", params: [] })).result


        const diffBlocks = toNumber(latestBlockNumber) - s.block


        if (diffBlocks < 255) {

          // so he signed the wrong blockhash and we have all data to convict him!
          const txHash = await callContract(handler.config.rpcUrl, nodes.contract, 'convict(uint,bytes32,uint,uint8,bytes32,bytes32)', [toNumber(singingNode.index), s.blockHash, s.block, s.v, s.r, s.s], {
            privateKey: handler.config.privateKey,
            gas: 300000,
            value: 0,
            confirm: false                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
          })
        }
        else {
          await handleRecreation(handler, nodes, singingNode, s, diffBlocks)
        }
        return null

      }))

    return signatures

    // merge all signatures
  })).then(a => a.filter(_ => _).reduce((p, c) => [...p, ...c], []))
}

export function sign(pk: string, blocks: { blockNumber: number, hash: string }[]): Signature[] {
  return blocks.map(b => {
    const msgHash = sha3('0x' + toHex(b.hash).substr(2).padStart(64, '0') + toHex(b.blockNumber).substr(2).padStart(64, '0'))
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

async function handleRecreation(handler: BaseHandler, nodes: ServerList, singingNode: IN3NodeConfig, s: Signature, diffBlocks: number): Promise<any> {
  // we have to find the blockHashRegistry
  const blockHashRegistry = "0x" + (await callContract(handler.config.rpcUrl, nodes.contract, 'blockRegistry():(address)', []))[0].toString("hex")

  // we have to calculate whether it's worth convicting a server
  const [url, owner, timeout, deposit, props, unregisterTime, unregisterDeposit, unregisterCaller] = await callContract(handler.config.rpcUrl, nodes.contract, 'servers(uint):(string,address,uint64,uint,uint,uint128,uint128,address)', [toNumber(singingNode.index)])
  const latestSS = toNumber((await callContract(handler.config.rpcUrl, blockHashRegistry, 'searchForAvailableBlock(uint,uint):(uint)', [s.block, diffBlocks]))[0])
  const costPerBlock = 86412400000000
  const blocksMissing = latestSS - s.block
  const costs = blocksMissing * costPerBlock * 1.25

  if (costs > (deposit / 2)) {
    //it's not worth it
    return null
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
      transactionArrays.push(serialzedBlocks.splice(0, 235));
    }

    let diffBlock = 0;


    for (const txArray of transactionArrays) {

      await callContract(handler.config.rpcUrl, blockHashRegistry, 'recreateBlockheaders(uint,bytes[])', [latestSS - diffBlock, txArray], {
        privateKey: handler.config.privateKey,
        gas: 8000000,
        value: 0,
        confirm: false                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
      })
      diffBlock += txArray.length
    }

    await callContract(handler.config.rpcUrl, nodes.contract, 'convict(uint,bytes32,uint,uint8,bytes32,bytes32)', [toNumber(singingNode.index), s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: handler.config.privateKey,
      gas: 300000,
      value: 0,
      confirm: false                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
    })

  }
}
