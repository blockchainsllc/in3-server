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

import { LogData, BlockData, ReceiptData, serialize, util, TransactionData, getSigner } from 'in3-common'
import { LogProof, RPCRequest, RPCResponse, Signature, Proof } from '../../types/types'
import { rlp, toChecksumAddress, keccak } from 'ethereumjs-util'
import * as Trie from 'merkle-patricia-tree'
import In3Trie from 'in3-trie'
import EthHandler from './EthHandler'
import { collectSignatures } from '../../chains/signatures'
import * as evm from './evm_trace'
import { in3ProtocolVersion } from '../../types/constants'
import { analyseCall, getFromCache, CacheAccount } from './evm_run'
import * as promClient from 'prom-client';
import { SentryError } from '../../util/sentryError'
import { toBuffer } from 'in3-common/js/src/util/util'
import { TransactionReceipt } from 'in3'


const histMerkleTreeTime = new promClient.Histogram({
  name: 'in3_merkle_tree_time',
  help: 'Time taken to generate merkle tree',
  labelNames: ["cached"],
  buckets: promClient.exponentialBuckets(1, 2, 20)
});

const histProofTime = new promClient.Histogram({
  name: 'in3_proof_time',
  help: 'Time taken to generate proofs',
  labelNames: ["type"],
  buckets: promClient.exponentialBuckets(1, 2, 20)
});

const ThreadPool = require('./threadPool')
const toHex = util.toHex
const toMinHex = util.toMinHex
const bytes32 = serialize.bytes32
const toNumber = util.toNumber

function createBlock(block: BlockData, verifiedHashes: string[]) {
//  if (verifiedHashes && verifiedHashes.indexOf(block.hash) >= 0)
//    return '' + parseInt(block.number as any)
//  else
    return serialize.blockToHex(block)
}

export async function addFinality(request: RPCRequest, response: RPCResponse, block: BlockData, handler: EthHandler) {
  const curBlock = handler.watcher.block
  if (block && request && request.in3 && request.in3.finality && response.in3 && response.in3.proof) {
    const validators = await handler.getAuthorities(toNumber(block.number))
    if (validators) {
      let bn = parseInt(block.number as any)
      const blocks = response.in3.proof.finalityBlocks = []
      const signers = [getSigner(new serialize.Block(block))]
      const minNumber = Math.ceil(Math.min(Math.max(request.in3.finality, 0), 100) * validators.length / 100)
      while (signers.length < minNumber) {
        bn = bn + 1
        if (curBlock && curBlock.number < bn) break
        const b = await handler.getFromServer({ method: 'eth_getBlockByNumber', params: ['0x' + bn.toString(16), false] }, request)
        if (!b || b.error || !b.result) break
        const s = getSigner(new serialize.Block(b.result))
        if (!signers.find(_ => _.equals(s)))
          signers.push(s)

        blocks.push(createBlock(b.result, request.in3.verifiedHashes))
      }
    }
  }
  if (response.in3 && curBlock && curBlock.number) response.in3.currentBlock = curBlock.number
  return response
}

/** creates the merkle-proof for a transation */
export async function createTransactionProof(block: BlockData, txHash: string, signatures: Signature[], verifiedHashes: string[], handler: EthHandler): Promise<Proof> {
  const startTime = Date.now();
  // we always need the txIndex, since this is used as path inside the merkle-tree
  const txIndex = block.transactions.findIndex(_ => _.hash === txHash)
  if (txIndex < 0) throw new Error('tx not found')

  const txProof = (await createMerkleProof(
    block.transactions.map((t, i) => ({
      key: rlp.encode(i),
      value: serialize.serialize(serialize.toTransaction(t))
    })),
    rlp.encode(txIndex),
    bytes32(block.transactionsRoot),
    handler
  )).map(toHex)

  histProofTime.labels("transaction").observe(Date.now() - startTime);
  // create prove
  return {
    type: 'transactionProof',
    block: createBlock(block, verifiedHashes),
    merkleProof: txProof,
    txIndex, signatures
  }
}

/** creates the merkle-proof for a transation */
export async function createTransactionFromBlockProof(block: BlockData, txIndex: number, signatures: Signature[], verifiedHashes: string[]): Promise<Proof> {
  const startTime = Date.now();

  // create trie
  const trie = new In3Trie()
  // fill in all transactions
  for (const tx of block.transactions)
    await trie.setValue(rlp.encode(parseInt(tx.transactionIndex)), serialize.serialize(serialize.toTransaction(tx)))

  // check roothash
  if (block.transactionsRoot !== '0x' + trie.root.toString('hex'))
    throw new Error('The transactionHash is wrong! : ' + block.transactionsRoot + '!==0x' + trie.root.toString('hex'))

  //create proof
  const proof: Proof = {
    type: 'transactionProof',
    block: createBlock(block, verifiedHashes),
    merkleProof: (await trie.getProof(rlp.encode(txIndex))).map(proof => {
      return toHex(proof).toString()
    }),
    txIndex,
    signatures
  }

  histProofTime.labels("transaction_from_block").observe(Date.now() - startTime);
  return proof
}

/** creates the merkle-proof for a transation */
export async function createTransactionReceiptProof(block: BlockData, receipts: ReceiptData[], txHash: string, signatures: Signature[], verifiedHashes: string[], handler: EthHandler, useFull = false): Promise<Proof> {
  const startTime = Date.now();

  let trie = (handler.cache && bytes32(block.receiptsRoot)) ? handler.cache.getTrie(toMinHex(bytes32(block.receiptsRoot))) : undefined

  // we always need the txIndex, since this is used as path inside the merkle-tree
  const txIndex = block.transactions.findIndex(_ => _.hash === txHash)
  if (txIndex < 0)
    throw new Error('tx not found')

  const [txProof, merkleProof, merkleProofPrev] = await Promise.all([
    createMerkleProof(
      block.transactions.map((t, i) => ({
        key: rlp.encode(i),
        value: serialize.serialize(serialize.toTransaction(t))
      })),
      rlp.encode(txIndex),
      bytes32(block.transactionsRoot),
      handler
    ),
    ( createMerkleProof(
      receipts && !trie ? receipts.map(r => ({
            key: rlp.encode(toNumber(r.transactionIndex)),
            value: serialize.serialize(serialize.toReceipt(r))
          })) : undefined,
          rlp.encode(txIndex),
          bytes32(block.receiptsRoot),
          handler
        )),
    // TOCDO performancewise this could be optimized, since we build the merkltree twice.
    useFull && txIndex > 0 && createMerkleProof(
      receipts.map(r => ({
        key: rlp.encode(toNumber(r.transactionIndex)),
        value: serialize.serialize(serialize.toReceipt(r))
      })),
      rlp.encode(txIndex - 1),
      bytes32(block.receiptsRoot),
      handler
    ),

  ]).then(a => a.map(_ => _ && _.map(toHex)))

  histProofTime.labels("transaction_receipt").observe(Date.now() - startTime);

  return {
    type: 'receiptProof',
    block: createBlock(block, verifiedHashes),
    txProof, merkleProof,
    txIndex, signatures,
    ...(merkleProofPrev ? {} : { merkleProofPrev })
  }
}



export async function createMerkleProof(values: { key: Buffer, value: Buffer }[], key: Buffer, expectedRoot: Buffer, handler: EthHandler) {

  const startTime = Date.now();
  let trie = (handler.cache && expectedRoot) ? handler.cache.getTrie(toMinHex(expectedRoot)) : undefined


  if (!trie) {

    if (handler.config.maxThreads) {
      try {
        const threadPool = new ThreadPool()
        const merkleProof = threadPool.getMerkleProof(values, key, expectedRoot)

        return await merkleProof.then(data => {
          let proof = new Array
          data.forEach(element => {
            let buffer = Buffer.alloc(element.length)
            let view = new Uint8Array(element)
            for (let i = 0; i < buffer.length; i++) {
              buffer[i] = view[i]
            }
            proof.push(buffer)
          });
          return proof
        })

      } catch (error) {
        throw new Error(error)
      }
    }
    else {
      trie = new Trie()
      await Promise.all(values.map(val => new Promise((resolve, reject) =>
        trie.put(Buffer.from(val.key), Buffer.from(val.value), error => error ? reject(error) : resolve(true))
      )))

      if (expectedRoot && !expectedRoot.equals(trie.root))
        throw new Error('The rootHash is wrong! : ' + toHex(expectedRoot) + '!==' + toHex(trie.root))

      if (handler.cache)
        handler.cache.putTrie(toMinHex(expectedRoot), trie)
    }
    histMerkleTreeTime.labels("false").observe(Date.now() - startTime);

  } else {
    histMerkleTreeTime.labels("true").observe(Date.now() - startTime);
  }

  return new Promise<Buffer[]>((resolve, reject) =>
    Trie.prove(trie, key, (err, prove) => {
      if (err) return reject(err)
      resolve(prove as Buffer[])
    })
  )

}

export async function handleBlock(handler: EthHandler, request: RPCRequest): Promise<RPCResponse> {

  // ask the server for the block with all transactions
  const response = await handler.getFromServer(
    request.method.indexOf('Count') > 0
      ? { id: request.id, method: 'eth_getBlockBy' + request.method.substr(30), params: [request.params[0], true] }
      : { ...request, params: [request.params[0], true] }, request)

  const blockData = response && response.result as BlockData

  // if we found the block....
  if (blockData && blockData.number) {

    // create the proof
    response.in3 = {
      proof: {
        type: 'blockProof',
        signatures: await collectSignatures(handler, request.in3.signers, [{ blockNumber: toNumber(blockData.number), hash: blockData.hash }], request.in3.verifiedHashes)
      },
      version: in3ProtocolVersion
    }

    if (request.in3.useFullProof && blockData.uncles && blockData.uncles.length)
      // we need to include all uncles
      response.in3.proof.uncles = await handler.getAllFromServer(blockData.uncles.map(b => ({ method: 'eth_getBlockByHash', params: [b, false] })), request).then(a => a.map(_ => serialize.blockToHex(_.result)))

    const transactions: TransactionData[] = blockData.transactions
    if (!request.params[1]) {
      const version = request.in3 && request.in3.version && request.in3.version.split('.').map(toNumber)
      // since we fetched the block with all transactions, but the request said, we only want hashes, we put the full ransactions in the proof and only the hashes in the result.
      response.in3.proof.transactions = (version && version[0] >= 2 && version[1] > 0)
        ? response.in3.proof.transactions = transactions.map(_ => toHex(_.raw || serialize.rlp.encode(serialize.toTransaction(_))))
        : response.in3.proof.transactions = transactions

      blockData.transactions = transactions.map(_ => _.hash)

      if (request.method.indexOf('Count') > 0) {
        (response.in3.proof as any).block = createBlock(blockData, request.in3.verifiedHashes)
        response.result = '0x' + blockData.transactions.length.toString(16)
      }
    }

    return addFinality(request, response, blockData, handler)
  }

  return response
}

function doesNotSupport(r: any) {
  if (r && r.error && ((r.error.code || 0) === -32601 || (r.error.code || 0) == -42405)) {
    supportsProofRPC = 0
    return true
  }
  return false
}

let supportsProofRPC: number = 1
export async function handeGetTransaction(handler: EthHandler, request: RPCRequest): Promise<RPCResponse> {
  let response: any = null
  let resp: any = supportsProofRPC
    ? await handler.getFromServer({ ...request, method: 'proof_getTransactionByHash', params: [request.params[0], true] }, request).then(_ => {
      if (doesNotSupport(_)) return null
      else if (_.error)
        throw new SentryError('invalid response ' + JSON.stringify(_.error))
      supportsProofRPC = 2
      return _.result
    }, err => {
      if (supportsProofRPC < 2) supportsProofRPC = 0
      throw err
    })
    : null

  if (supportsProofRPC) {
    // we can build the response from the one request
    response = {
      id: request.id,
      jsonrpc: '2.0',
      result: resp.transaction
    }
    if (resp.transaction) {
      response.in3 = {
        proof: {
          type: 'transactionProof',
          block: resp.blockHeader,
          merkleProof: resp.txProof,
          txIndex: parseInt(resp.transaction.transactionIndex),
          signatures: await collectSignatures(handler, request.in3.signers, [{ blockNumber: resp.transaction.blockNumber, hash: resp.transaction.blockHash }], request.in3.verifiedHashes)
        }
      }
      if (request.in3.finality) {
        const block = toBuffer(resp.blockHeader)
        block.number = resp.transaction.blockNumber
        return addFinality(request, response, block, handler)
      }
    }
  }
  else {
    // ask the server for the tx
    response = await handler.getFromServer(request, request)
    const tx = response && response.result as any
    // if we have a blocknumber, it is mined and we can provide a proof over the blockhash
    if (tx && tx.blockNumber) {
      // get the block including all transactions from the server
      const block = await handler.getFromServer({ method: 'eth_getBlockByNumber', params: [toMinHex(tx.blockNumber), true] }, request).then(_ => _ && _.result as any)
      if (block)
        // create the proof
        response.in3 = {
          proof: await createTransactionProof(block, request.params[0] as string,
            await collectSignatures(handler, request.in3.signers, [{ blockNumber: tx.blockNumber, hash: block.hash }], request.in3.verifiedHashes),
            request.in3.verifiedHashes, handler) as any,
          version: in3ProtocolVersion
        }
      return addFinality(request, response, block, handler)
    }

  }
  return response
}

export async function handeGetTransactionFromBlock(handler: EthHandler, request: RPCRequest): Promise<RPCResponse> {
  // if we have a blocknumber, it is mined and we can provide a proof over the blockhash
  let block

  if (request.method === "eth_getTransactionByBlockHashAndIndex")
    block = await handler.getFromServer({ method: 'eth_getBlockByHash', params: [request.params[0], true] }, request).then(_ => _ && _.result as any)
  else if (request.method === "eth_getTransactionByBlockNumberAndIndex")
    block = await handler.getFromServer({ method: 'eth_getBlockByNumber', params: [request.params[0], true] }, request).then(_ => _ && _.result as any)

  const response: RPCResponse = {
    jsonrpc: '2.0',
    id: request.id,
    result: null
  }

  // find the transaction in the block
  response.result = block.transactions[parseInt(request.params[1])] ? block.transactions[parseInt(request.params[1])] : null

  if (block) {
    // create the proof
    response.in3 = {
      proof: await createTransactionFromBlockProof(block, parseInt(request.params[1]),
        await collectSignatures(handler, request.in3.signers, [{ blockNumber: block.number, hash: block.hash }], request.in3.verifiedHashes),
        request.in3.verifiedHashes) as any,
      version: in3ProtocolVersion
    }
    return addFinality(request, response, block, handler)
  }
  return response
}


export async function handeGetTransactionReceipt(handler: EthHandler, request: RPCRequest): Promise<RPCResponse> {
  let response: any = null
  let resp: any = supportsProofRPC
    ? await handler.getFromServer({ ...request, method: 'proof_getTransactionReceipt', params: [request.params[0], true] }, request).then(_ => {
      if (doesNotSupport(_)) return null
      else if (_.error) throw new SentryError('invalid response ' + _.error)
      supportsProofRPC = 2
      return _.result
    }, err => {
      if (supportsProofRPC < 2) supportsProofRPC = 0
      throw err
    })
    : null

  if (supportsProofRPC) {
    // we can build the response from the one request
    response = {
      id: request.id,
      jsonrpc: '2.0',
      result: resp.receipt
    }
    if (resp.receipt) {
      response.in3 = {
        proof: {
          type: 'receiptProof',
          block: resp.blockHeader,
          merkleProof: resp.receiptProof,
          txProof: resp.txProof,
          txIndex: parseInt(resp.receipt.transactionIndex),
          signatures: await collectSignatures(handler, request.in3.signers, [{ blockNumber: resp.receipt.blockNumber, hash: resp.receipt.blockHash }], request.in3.verifiedHashes)
        }
      }
      if (request.in3 && request.in3.useFullProof && parseInt(resp.transaction.transactionIndex) > 0) {
        // TODO find previous 
        //        response.in3.proof.merkleProofPrev =
      }
      if (request.in3.finality) {
        const block = toBuffer(resp.blockHeader)
        block.number = resp.receipt.blockNumber
        return addFinality(request, response, block, handler)
      }
    }
  }
  else {



    // ask the server for the tx
    response = await handler.getFromServer(request, request)
    const tx = response && response.result as ReceiptData
    // if we have a blocknumber, it is mined and we can provide a proof over the blockhash
    if (tx && tx.blockNumber) {
      // get the block including all transactions from the server
      const block = await handler.getFromServer({ method: 'eth_getBlockByHash', params: [tx.blockHash, true] }, request).then(_ => _ && _.result as BlockData)
      if (block) {

        //first check if receit proof is alreay in cache
        let trie = (handler.cache && bytes32(block.receiptsRoot)) ? handler.cache.getTrie(toMinHex(bytes32(block.receiptsRoot))) : undefined

        const [signatures, receipts] = await Promise.all([
          // signatures for the block of the transaction
          collectSignatures(handler, request.in3.signers, [{ blockNumber: toNumber(tx.blockNumber), hash: block.hash }], request.in3.verifiedHashes),

          // get all receipts, because we need to build the MerkleTree if MerkleTree is not in cache
          ( !trie ? handler.getAllFromServer(block.transactions.map(_ => ({ method: 'eth_getTransactionReceipt', params: [_.hash] })), request)
            .then(a => a.map(_ => _.result as ReceiptData)) : undefined ),

          // get all txs to also proof the tx (in case of full proof)
          // request.in3.useFullProof && handler.getAllFromServer(block.transactions.map(_ => ({ method: 'eth_getTransactionReceipt', params: [_.hash] })))
          //  .then(a => a.map(_ => _.result as ReceiptData))
        ])

        // create the proof
        response.in3 = {
          proof: await createTransactionReceiptProof(
            block,
            receipts,
            request.params[0] as string,
            signatures,
            request.in3.verifiedHashes,
            handler
          ),
          version: in3ProtocolVersion
        }


        return addFinality(request, response, block, handler)
      }
    }
    // if we don't have a block, we will return nu result, since pending can not be proofed
    else
      return { ...response, result: null }
  }

  return response
}

async function handleLogsNethermind(handler: EthHandler, request: RPCRequest, logs: LogData[], response: RPCResponse, proof: LogProof): Promise<boolean> {
  const results = await handler.getAllFromServer(logs.map(_ => _.transactionHash).filter((hash, i, all) => all.indexOf(hash) === i).map(_ => ({ method: 'proof_getTransactionReceipt', params: [_, true] })), request).catch(err => {
    if (supportsProofRPC < 2) supportsProofRPC = 0;
    throw err
  })
  const receipts: {
    receipt: TransactionReceipt,
    txProof: string[],
    receiptProof: string[],
    blockHeader: string
  }[] = results.map(_ => {
    if (doesNotSupport(_)) return null
    else if (_.error) throw new SentryError('Error fetching receipts for eth_getLogs ' + JSON.stringify(_.error))
    supportsProofRPC = 2
    return _.result
  })
  if (!supportsProofRPC) return false

  const blocks = Object.keys(proof).map(_ => proof[_])

  // fetch signatures
  const signatures = (request.in3.signers && request.in3.signers.length)
    ? await collectSignatures(handler, request.in3.signers, blocks.map(b => ({ blockNumber: b.number, hash: (b as any).hash })), request.in3.verifiedHashes)
    : []

  for (const p of blocks) {
    for (const r of receipts) {
      if (!r.receipt || r.receipt.blockHash !== (p as any).hash) continue
      p.receipts[r.receipt.transactionHash] = {
        txHash: r.receipt.transactionHash,
        txIndex: parseInt(r.receipt.transactionIndex as any),
        proof: r.receiptProof,
        txProof: r.txProof
      }
      if (!p.block) p.block = r.blockHeader
    }
    delete (p as any).hash
    delete p.allReceipts
  }
  // attach prood to answer
  response.in3 = {
    proof: {
      type: 'logProof',
      logProof: proof,
      signatures
    },
    version: in3ProtocolVersion
  }


  return true

}

export async function handleLogs(handler: EthHandler, request: RPCRequest): Promise<RPCResponse> {
  // ask the server for the logs
  const startTime = Date.now();

  const response = await handler.getFromServer(request, request)
  const logs = response && response.result as LogData[]
  // if we have a blocknumber, it is mined and we can provide a proof over the blockhash
  if (logs && logs.length) {

    // find all needed blocks
    const proof: LogProof = {}
    logs.forEach(l => proof[toHex(l.blockNumber)] || (proof[toHex(l.blockNumber)] = { number: toNumber(l.blockNumber), hash: toHex(l.blockHash), receipts: {}, allReceipts: [] } as any))

    // try a shortcut to use nethermind for producing the proofs
    if (supportsProofRPC && await handleLogsNethermind(handler, request, logs, response, proof)) {
      histProofTime.labels("logs").observe(Date.now() - startTime);
      return response
    }


    // get the blocks from the server
    const blocks = await handler.getAllFromServer(Object.keys(proof).map(bn => ({ method: 'eth_getBlockByNumber', params: [toMinHex(bn), true] })), request).then(all => all.map(_ => _.result as BlockData))

    // fetch in parallel
    const [signatures] = await Promise.all([
      // collect signatures for all the blocks
      collectSignatures(handler, request.in3.signers, blocks.map(b => ({ blockNumber: parseInt(b.number as string), hash: b.hash })), request.in3.verifiedHashes),
      // and get all receipts in all blocks and afterwards reasign them to their block
      handler.getAllFromServer(
        blocks.map(_ => _.transactions).reduce((p, c) => [...p, ...c], []).map(t => ({ method: 'eth_getTransactionReceipt', params: [t.hash] })), request
      ).then(a => a.forEach(r => proof[toHex(r.result.blockNumber)].allReceipts.push(r.result)))
    ])

    // for geth we need to fic the missing transactionLogIndex
    logs.forEach(l => {
      if (l.transactionLogIndex === undefined) {
        // now we need to find which log this may be
        const p = proof[toHex(l.blockNumber)]
        const tr: ReceiptData = p && p.allReceipts.find(_ => _.transactionHash == l.transactionHash) || p.allReceipts[toNumber(l.transactionIndex)]
        if (tr) l.transactionLogIndex = toMinHex(Math.max(0, tr.logs.findIndex(ll => toNumber(ll.logIndex) === toNumber(l.logIndex))))
      }
    })

    // create the proof per block
    await Promise.all(blocks.map(b => {
      const blockProof = proof[toHex(b.number)]

      // add the blockheader
      blockProof.block = createBlock(b, request.in3.verifiedHashes)

      // we only need all receipts in order to create the full merkletree, but we do not return them all.
      const allReceipts = blockProof.allReceipts
      delete blockProof.allReceipts

      // find all the involved transactionshashes, we need to proof
      const toProof = logs.filter(_ => toHex(_.blockNumber) === toHex(b.number))
        .map(_ => _.transactionHash) // we only need the transaction hash
        .filter((th, i, a) => a.indexOf(th) === i) // there could be more than one event in one transaction, so make it unique

      // create receipt-proofs for all these transactions
      return Promise.all(toProof.map(th =>
        createTransactionReceiptProof(b, allReceipts, th, signatures, request.in3.verifiedHashes, handler)
          .then(p => blockProof.receipts[th] = {
            txHash: th,
            txIndex: parseInt(allReceipts.find(_ => _.transactionHash == th).transactionIndex),
            proof: p.merkleProof,
            txProof: p.txProof,
          })
      ))
    }))

    // attach prood to answer
    response.in3 = {
      proof: {
        type: 'logProof',
        logProof: proof,
        signatures
      },
      version: in3ProtocolVersion
    }
  }
  histProofTime.labels("logs").observe(Date.now() - startTime);
  return response
}
export function resetSupport() {
  useTrace = true
  supportsProofRPC = 1
}

let useTrace: boolean = true

export async function handleCall(handler: EthHandler, request: RPCRequest): Promise<RPCResponse> {
  const startTime = Date.now();

  if (request.params && request.params[0] && !request.params[0].value) request.params[0].value = '0x0'
  const tx: TransactionData = request.params[0]

  if (supportsProofRPC) {
    // TODO currently we only send the to and data, because nethermind has issues with from-properties
    // once fixed, remove the params here and take the original from the request
    const r = await handler.getFromServer({ ...request, method: 'proof_call', params: [{ data: request.params[0].data || '0x', to: request.params[0].to }, request.params[1]] }, request)
      .catch(err => {
        if (supportsProofRPC < 2) supportsProofRPC = 0
        throw err
      })
    if (doesNotSupport(r))
      supportsProofRPC = 0
    else if (r.error) throw new SentryError('Error fetich call from nethermind ' + JSON.stringify(request) + JSON.stringify(r.error))
    else {
      supportsProofRPC = 2

      // remove sysaccount
      if ((!tx.gasPrice || !toNumber(tx.gasPrice)) && !tx.from) r.result.accounts = r.result.accounts.filter(_ => _.address != '0xfffffffffffffffffffffffffffffffffffffffe')
      // fix storage keys
      r.result.accounts.forEach(ac => {
        ac.storageProof.forEach(s => {
          s.key = toMinHex(s.key)
        })
      })

      histProofTime.labels("call").observe(Date.now() - startTime);
      const block = toBuffer(r.result.blockHeaders[0])
      const header = new serialize.Block(block)
      const resp = {
        id: request.id,
        jsonrpc: '2.0',
        result: r.result.result,
        in3: {
          proof: {
            type: 'callProof',
            block: r.result.blockHeaders[0],
            signatures: (request.in3.signers && request.in3.signers.length) ? await collectSignatures(handler, request.in3.signers, [{ blockNumber: toNumber(header.number), hash: toHex(header.hash()) }], request.in3.verifiedHashes) : [],
            accounts: r.result.accounts.reduce((p, v) => { p[v.address] = v; return p }, {})
          },
          version: in3ProtocolVersion
        }
      }
      block.number = toNumber(header.number)

      // bundle the answer
      return addFinality(request, resp as any, block, handler)

    }
  }

  //    console.log('handle call', this.config)
  // read the response,blockheader and trace from server
  const [blockResponse, trace] = await handler.getAllFromServer([
    { method: 'eth_getBlockByNumber', params: [request.params[1] || 'latest', false] },
    useTrace ? { method: 'trace_call', params: [request.params[0], ['vmTrace'], request.params[1] || 'latest'] } : undefined
  ], request)

  // error checking
  if (blockResponse.error) throw new Error('Could not get the block for ' + request.params[1] + ':' + blockResponse.error)
  if (trace && trace.error) {
    if ((trace.error as any).code === -32601) useTrace = false
    else throw new Error('Could not get the trace :' + JSON.stringify(trace.error))
  }

  let response : RPCResponse = {jsonrpc: "2.0", id: request.id}
  // anaylse the transaction in order to find all needed storage
  const block = blockResponse.result as any
  let neededAccounts = []

  async function getFromGeth(): Promise<any> {
    for (let i = 0; i < 10; i++) {
      const neededProof = await analyseCall(request.params[0], request.params[1] || 'latest', handler.getFromServer.bind(handler))
      response.result = toHex(neededProof.result)
      neededAccounts = Object.keys(neededProof.accounts)
      const proof = await handler.getAllFromServer(neededAccounts.map(adr => (
        { method: 'eth_getProof', params: [toHex(adr, 20), Object.keys(neededProof.accounts[adr].storage).map(_ => toHex(_, 32)), block.number] }
      )), request)
      const error = proof.find(_ => _.error)
      if (error)
        throw new Error('Error getting proof from node : ' + ((error.error as any).message || error.error))
      let isValid = true
      neededAccounts.forEach((adr, i) => {
        const cache = getFromCache(adr)
        const a = neededProof.accounts[adr]
        const p = proof[i].result
        if (a.code && !keccak(util.toBuffer(a.code)).equals(util.toBuffer(p.codeHash, 32))) {
          delete cache.code
          isValid = false
        }
        if (a.balance != undefined && util.toMinHex(a.balance || '0x00') != util.toMinHex(p.balance)) {
          delete cache.balance
          isValid = false
        }
        Object.keys(a.storage || []).forEach((k, i) => {
          const val = util.toMinHex(a.storage[k])
          const proofedKey = p.storageProof.find(_ => util.toMinHex(_.key) === util.toMinHex(k))
          if (!proofedKey) {
            delete cache.storage[k]
            isValid = false
            return
          }
          if (util.toMinHex(proofedKey.value) != val) {
            delete cache.storage[k]
            isValid = false
          }
        })
      })
      if (isValid) return proof
    }
    throw new Error('max retries of getting all values for eth_call exceeded')
  }

  async function getFromParity() {
    if(trace.error)
      response.error = trace.error
    else 
      response.result = trace.result.output
    
    const neededProof = evm.analyse((trace.result as any).vmTrace, request.params[0].to)
    neededAccounts = Object.keys(neededProof.accounts)
    return await handler.getAllFromServer(Object.keys(neededProof.accounts).map(adr => (
      { method: 'eth_getProof', params: [toHex(adr, 20), Object.keys(neededProof.accounts[adr].storage).map(_ => toHex(_, 32)), block.number] }
    )), request)
  }

  const [accountProofs, signatures] = await Promise.all([
    useTrace ? getFromParity() : getFromGeth(),
    collectSignatures(handler, request.in3.signers, [{ blockNumber: block.number, hash: block.hash }], request.in3.verifiedHashes)
  ])

  // add the codes to the accounts
  if (request.in3.includeCode) {
    const accounts = accountProofs
      .filter(a => (a.result as any).codeHash !== '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
    const codes = await handler.getAllFromServer(accounts.map(a => ({ method: 'eth_getCode', params: [toHex((a.result as any).address, 20), request.params[1] || 'latest'] })), request)
    accounts.forEach((r, i) => (accounts[i].result as any).code = codes[i].result)
  }

  for (const ap of accountProofs) {
    // make sure we use minHex for the proof-keys
    if (ap.result && ap.result.storageProof)
      ap.result.storageProof.forEach(p => p.key = toMinHex(p.key))

  }



  histProofTime.labels("call").observe(Date.now() - startTime);

  // bundle the answer
  return addFinality(request,
    {
      ...response,
      in3: {
        proof: {
          type: 'callProof',
          block: createBlock(block, request.in3.verifiedHashes),
          signatures,
          accounts: neededAccounts.reduce((p, v, i) => { p[v] = accountProofs[i].result; return p }, {})
        },
        version: in3ProtocolVersion
      }
    }, block, handler)
}


/**
 * handle account-base requests.
 */
export async function handleAccount(handler: EthHandler, request: RPCRequest): Promise<RPCResponse> {

  const address = request.params[0] as string
  const blockNr = request.params[request.method === 'eth_getStorageAt' ? 2 : 1] || 'latest'
  const storage = request.method === 'eth_getStorageAt' ? [request.params[1]] : []

  // read the response,blockheader and trace from server
  const [blockResponse, proof, code] = await handler.getAllFromServer([
    { method: 'eth_getBlockByNumber', params: [blockNr, false] },
    { method: 'eth_getProof', params: [toHex(address, 20), storage.map(_ => toHex(_, 32)), blockNr] },
    request.method === 'eth_getCode' ? request : null
  ], request)

  // error checking
  if (blockResponse.error)
    throw new Error('Could not get the block for ' + request.params[1] + ':' + blockResponse.error)

  if (proof.error)
    throw new Error('Could not get the proof :' + JSON.stringify(proof.error, null, 2) + ' for request ' + JSON.stringify({ method: 'eth_getProof', params: [toHex(address, 20), storage.map(_ => toHex(_, 32)), blockNr] }, null, 2))


  // make sure we use minHex for the proof-keys
  if (proof.result && proof.result.storageProof)
    proof.result.storageProof.forEach(p => p.key = toMinHex(p.key))


  // anaylse the transaction in order to find all needed storage
  const block = blockResponse.result as any
  const account = proof.result as any
  let result;
  if (request.method === 'eth_getBalance')
    result = account.balance
  else if (request.method === 'eth_getCode')
    result = code.result
  else if (request.method === 'eth_getTransactionCount')
    result = account.nonce
  else if (request.method === 'eth_getStorageAt')
    result = account.storageProof[0].value

  // bundle the answer
  return addFinality(request,
    {
      id: request.id,
      jsonrpc: '2.0',
      result,
      in3: {
        proof: {
          type: 'accountProof',
          block: createBlock(block, request.in3.verifiedHashes),
          signatures: await collectSignatures(handler, request.in3.signers, [{ blockNumber: block.number, hash: block.hash }], request.in3.verifiedHashes),
          accounts: { [toChecksumAddress(address)]: proof.result }
        },
        version: in3ProtocolVersion
      }
    }, block, handler)
}
