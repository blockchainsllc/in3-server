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

import { Transport } from 'in3-common'
import { RPCRequest, RPCResponse, ServerList, IN3RPCHandlerConfig } from '../../types/types'
import axios from 'axios'
import BaseHandler from '../../chains/BaseHandler'
import { BTCBlock, serialize_blockheader, BTCBlockHeader } from './btc_serialize'
import { createMerkleProof } from './btc_merkle'
import { max } from 'bn.js'
import { hash } from 'in3-common/js/src/modules/eth/serialize'
import { toChecksumAddress } from 'ethereumjs-util'
import { BTCCache, Coinbase } from './btc_cache'
import { UserError } from '../../util/sentryError'

interface DAP {
  dapnumber: number
  blockhash: string
  blockheader: string
  bits: string
  target: string
}

/**
 * handles BTC-Proofs
 */
export default class BTCHandler extends BaseHandler {

  blockCache: BTCCache

  constructor(config: IN3RPCHandlerConfig, transport?: Transport, nodeList?: ServerList) {
    super(config, transport, nodeList)
    this.blockCache = new BTCCache(this)
  }


  /** main method to handle a request */
  async handle(request: RPCRequest): Promise<RPCResponse> {
    const toRes = (r: any) => ({ id: request.id, jsonrpc: '2.0', ...r }) as RPCResponse

    // handle special jspn-rpc
    switch (request.method) {

      case 'getblock':
        return toRes(await this.getBlock(request.params[0], verboseParam(request.params[1]), request.in3 && request.in3.finality, request))
      case 'getblockheader':
        return toRes(await this.getBlockHeader(request.params[0], verboseParam(request.params[1]), request.in3 && request.in3.finality, request))
      case 'gettransaction':
      case 'getrawtransaction':
        return toRes(await this.getTransaction(request.params[0], verboseParam(request.params[1]), request.params[2], request.in3 && request.in3.finality, request))
      case 'getblockcount':
        return toRes(await this.getBlockCount(request.in3 && request.in3.finality, request))
      case 'getbesthash':
      case 'getbestblockhash':
        return toRes(await this.getBestBlockHash(request.in3 && request.in3.finality, request))
      case 'getdifficulty':
        return toRes(await this.getDifficulty(request.params[0], request.in3 && request.in3.finality, request))
      case 'in3_proofTarget':
        return toRes(await this.in3_proofTarget(parseInt(request.params[0]), parseInt(request.params[1]), parseInt(request.params[2]),
          parseInt(request.params[3]), request, request.in3 && request.in3.finality || 0, parseInt(request.params[4])))
      case 'scantxoutset':
        // https://bitcoincore.org/en/doc/0.18.0/rpc/blockchain/scantxoutset/
        return this.getFromServer(request)
      case 'gettxout':
        // https://bitcoincore.org/en/doc/0.18.0/rpc/blockchain/gettxout/
        return this.getFromServer(request)

      default:
        return this.getFromServer(request)
    }
  }

  async getFinalityBlocks(blockNumber: number, finality: number, r?: any): Promise<string> {
    if (!finality) return null

    // if epoch changes within the finality headers, we are going to add more headers
    const startEpoch = Math.floor(blockNumber / 2016) // integer division
    const endEpoch = Math.floor((blockNumber + finality) / 2016)

    // epoch changed
    if (startEpoch != endEpoch) {
      finality += (2016 - (blockNumber % 2016)) // add amount of blocks to the next epoch to the finality
    }

    // we need to determine, what are the blockhashes of the next blocks.
    const numbers: string[] = []
    for (let n = blockNumber + 1; n <= blockNumber + finality; n++)
      numbers.push(n.toString())

    // get headers
    const headers: string[] = (await this.blockCache.getBlockHeaderByNumber(numbers, false)).map(_ => _.toString('hex'))

    // now we simply concate all headers
    return '0x' + headers.join('')
  }

  async getBlock(hash: string, json: number, finality: number = 0, r: any) {
    if (json === undefined) json = 1
  
    let [block, blockHeight] = await Promise.all([
      this.getFromServer({ method: "getblock", params: [hash, json] }, r).then(asResult),
      json ? undefined : this.blockCache.getBlockHeaderByHash([hash], true).then(_ => _.pop().height)
    ])

    if (json) this.blockCache.setBlock(block) // save block in cache

    if (blockHeight === undefined && block) blockHeight = block.height

    const proof: any = {}
    await Promise.all([
      (finality && block) ? this.getFinalityBlocks(parseInt(blockHeight), finality, r).then(_ => proof.final = _) : undefined,
      this.blockCache.getCoinbaseByHash([hash]).then(_ => {
        const cb: Coinbase = _.shift()
        proof.cbtx = '0x' + cb.cbtx.toString('hex')
        proof.cbtxMerkleProof = '0x' + createMerkleProof(cb.txids, cb.txids[0]).toString('hex')
      })
    ])

    return { result: block, in3: { proof } }
  }


  async getBlockHeader(hash: string, json: number = 1, finality: number = 0, r: any) {
    if (json === undefined) json = 1

    // get coinbase first so that the block is in the cache
    const cb: Coinbase = (await this.blockCache.getCoinbaseByHash([hash])).shift()

    let blockheader: any // can be json-object or hex-string (hex-string if always in the cache after fetching coinbase)
    json ? blockheader = (await this.blockCache.getBlockHeaderByHash([hash], !!json)).pop() : blockheader = ((await this.blockCache.getBlockHeaderByHash([hash], !!json)).pop()).toString('hex')

    // after fetching the coinbase the block number is ALWAYS in the cache
    const number = this.blockCache.data.get(hash).height

    const proof: any = {}
    if (finality) proof.final = await this.getFinalityBlocks(number, finality, r)

    proof.cbtx = '0x' + cb.cbtx.toString('hex')
    proof.cbtxMerkleProof = '0x' + createMerkleProof(cb.txids, cb.txids[0]).toString('hex');

    return { result: blockheader, in3: { proof } }
  }

  async getTransaction(hash: string, json: number = 1, blockhash: string = undefined, finality: number = 0, r: any) {
    if (json === undefined) json = 1
    // even for json==false we get it as json from server so we know the blockhash
    const tx = await this.getFromServer({ method: "getrawtransaction", params: blockhash ? [hash, true, blockhash] : [hash, true] }, r).then(asResult)
    if (!tx) throw new Error("Transaction not found")
    if (!blockhash) blockhash = tx.blockhash
    if (blockhash && tx.blockhash != blockhash) throw new Error('invalid blockhash for tx')
    const proof: any = {}

    // get coinbase first so that the block is in the cache
    const cb: Coinbase = (await this.blockCache.getCoinbaseByHash([blockhash])).shift()

    // after fetching the coinbase the block header and number are ALWAYS in the cache
    const blockheader = '0x' + this.blockCache.data.get(blockhash).header.toString('hex')
    const number = this.blockCache.data.get(blockhash).height

    proof.block = blockheader

    if (finality) proof.final = await this.getFinalityBlocks(number, finality, r)

    proof.txIndex = cb.txids.findIndex(_ => _.equals(Buffer.from(hash, 'hex'))) // get index of tx
    proof.merkleProof = '0x' + createMerkleProof(cb.txids, Buffer.from(hash, 'hex')).toString('hex');

    proof.cbtx = '0x' + cb.cbtx.toString('hex')
    proof.cbtxMerkleProof = '0x' + createMerkleProof(cb.txids, cb.txids[0]).toString('hex');

    return { result: json ? tx : tx.hex, in3: { proof } }
  }

  async getBlockCount(finality: number = 0, r: any) {
    if (!finality) return null

    // get latest block number
    const blocknumber = await this.getFromServer({ method: "getblockcount", params: [] }, r).then(asResult) - finality; // substruct finality

    // check cache for number
    let blockhash
    if (this.blockCache.data.has(blocknumber.toString())) {
      blockhash = this.blockCache.data.get(blocknumber.toString()).hash.toString('hex') // get hash out of cache 
      // no need to call a function here because cache will be filled anyways by "getCoinbaseByHash" later on
    } else {
      blockhash = await this.getFromServer({ method: "getblockhash", params: [blocknumber] }, r).then(asResult) // get hash of blockNumber
    }

    // after fetching coinbase, cache is filled with the BTCCacheValue-object we need
    const cb: Coinbase = (await this.blockCache.getCoinbaseByHash([blockhash])).shift()

    const proof: any = {}

    // fill proof
    proof.block = '0x' + this.blockCache.data.get(blockhash).header.toString('hex') // add block header
    proof.final = await this.getFinalityBlocks(blocknumber, finality, r) // add finality headers
    proof.cbtx = '0x' + cb.cbtx.toString('hex')
    proof.cbtxMerkleProof = '0x' + createMerkleProof(cb.txids, cb.txids[0]).toString('hex');

    return { result: blocknumber, in3: { proof } }
  }

  async getBestBlockHash(finality: number = 0, r: any) {
    if (!finality) return null

    // fetch latest block number and hash
    const blocknumber = await this.getFromServer({ method: "getblockcount", params: [] }, r).then(asResult) - finality; // substruct finality

    // check cache for number
    let blockhash
    if (this.blockCache.data.has(blocknumber.toString())) {
      blockhash = this.blockCache.data.get(blocknumber.toString()).hash.toString('hex') // get hash out of cache 
      // no need to call a function here because cache will be filled anyways by "getCoinbaseByHash" later on
    } else {
      blockhash = await this.getFromServer({ method: "getblockhash", params: [blocknumber] }, r).then(asResult) // get hash of blockNumber
    }

    // after fetching coinbase, cache is filled with the BTCCacheValue-object we need
    const cb: Coinbase = (await this.blockCache.getCoinbaseByHash([blockhash])).shift()

    const proof: any = {}

    // fill proof
    proof.block = '0x' + this.blockCache.data.get(blockhash).header.toString('hex') // add block header
    proof.final = await this.getFinalityBlocks(blocknumber, finality, r) // add finality headers
    proof.cbtx = '0x' + cb.cbtx.toString('hex')
    proof.cbtxMerkleProof = '0x' + createMerkleProof(cb.txids, cb.txids[0]).toString('hex');

    return { result: blockhash, in3: { proof } }
  }

  async getDifficulty(bn: string, finality: number = 0, r: any) {
    if (!finality) return null

    // always fetch latest block number
    const latestBlocknumber: number = await this.getFromServer({ method: "getblockcount", params: [] }, r).then(asResult)

    let blocknumber: number
    if (!bn || bn === 'latest' || bn === 'earliest' || bn === 'pending') {
      blocknumber = latestBlocknumber - finality; // latest block - finality
    } else {
      blocknumber = parseInt(bn)
      // we have to check if blocknumber + finality is already existing
      if (blocknumber + finality > latestBlocknumber) {
        throw new UserError("block is not final", -16001)
      }
    }

    const blockheader: BTCBlockHeader = (await this.blockCache.getBlockHeaderByNumber([blocknumber.toString()], true)).pop() // json-object
    const difficulty: number = blockheader.difficulty

    const proof: any = {}

    proof.block = '0x' + serialize_blockheader(blockheader).toString('hex') // add block header
    proof.final = await this.getFinalityBlocks(blocknumber, finality, r) // add finality headers

    const cb: Coinbase = (await this.blockCache.getCoinbaseByHash([blockheader.hash])).shift()

    proof.cbtx = '0x' + cb.cbtx.toString('hex')
    proof.cbtxMerkleProof = '0x' + createMerkleProof(cb.txids, cb.txids[0]).toString('hex');

    return { result: difficulty, in3: { proof } }
  }

  async in3_proofTarget(targetDap: number, verifiedDap: number, maxDiff: number, maxDap: number, r: any, finality?: number, limit?: number) {

    if (limit === 0 || limit > 40 || !limit) limit = 40 // prevent DoS (internal max_limit = 40)

    let resultDaps: DAP[] = [] // array of daps that are in the path
    let compare: DAP[] = [] // array to save 2 dap numbers to compare

    let boolLimit, added = false

    let start, end
    if (targetDap < verifiedDap) {
      start = targetDap
      end = verifiedDap
    } else {
      start = verifiedDap
      end = targetDap
    }

    compare.push(await this.getDap(start)) // set first element to compare with (verifiedDap)

    // add daps to resultDaps
    while (!boolLimit) {

      let nextdap: number = compare[0].dapnumber + maxDap // calculate dap to compare with

      if (nextdap >= end) {
        nextdap = end  // set next dap to one dap lower the end
        boolLimit = true // last loop
      }

      compare.push(await this.getDap(nextdap)) // push dap to compare array
      added = false

      // repeat as long as no dap was added to the result
      while (!added) {
        if (isWithinLimits(compare[0].target, compare[1].target, maxDiff)) {
          if (nextdap < end) resultDaps.push(compare[1]) // add to result if it's not the last dap
          compare.shift()
          added = true
          if (resultDaps.length === limit) boolLimit = true // check maximum limit of daps in result
        }
        else {
          // dap is not within limits -> try it with a different dap (nextdap--)
          compare.pop()
          nextdap--
          compare.push(await this.getDap(nextdap))
          if (JSON.stringify(compare[0]) === JSON.stringify(compare[1])) {
            // no dap found that is within the limits -> return result until now (prevent endless loop)
            boolLimit = true
            break
          }
        }
      }
    }

    // result array has to be in a reversed order if targetDap is smaller than verifiedDap (so that the path is in the right way)
    if (targetDap < verifiedDap) {
      resultDaps.reverse()
    }

    // build result (with proof data)
    const resultArray = await Promise.all(resultDaps.map(async val => {

      let resultobj: any = {} // result object will contain: dap, block, final, cbtx, cbtxMerkleProof

      const cb: Coinbase = (await this.blockCache.getCoinbaseByHash([val.blockhash])).shift()

      resultobj.dap = val.dapnumber
      resultobj.block = '0x' + val.blockheader
      if (finality > 0) resultobj.final = await this.getFinalityBlocks(val.dapnumber * 2016, finality, r) // add finality headers 
      resultobj.cbtx = '0x' + cb.cbtx.toString('hex')
      resultobj.cbtxMerkleProof = '0x' + createMerkleProof(cb.txids, cb.txids[0]).toString('hex');

      return resultobj
    }))

    return { resultArray }
  }

  async getDap(_dapnumber: number): Promise<DAP> {

    const blockheader: string = (await this.blockCache.getBlockHeaderByNumber([(_dapnumber * 2016).toString()], false)).pop().toString('hex')
    // cache is now filled with hash, header and height for this block

    const dapnumber = _dapnumber
    const blockhash = this.blockCache.data.get((_dapnumber * 2016).toString()).hash.toString('hex') // we can also hash the block header to get the hash (what's better?)
    const bits = reverseCopy(blockheader.substr(144, 8)) // get bits
    const length = parseInt(bits.substr(0, 2), 16) // length = first 2 digits of bits-field parsed to integer
    const coefficient = bits.substr(2, 6) // coefficient = last 6 digits of bits-field
    const target = (coefficient.padEnd(length * 2, '0')).padStart(64, '0') // pads the coefficient with 0 to the given length and calculates bigint

    return { dapnumber: dapnumber, blockhash: blockhash, blockheader: blockheader, bits: bits, target: target }
  }

  health(): Promise<{ status: string, message?: string }> {
    return this.getFromServer({ id: 1, jsonrpc: '2.0', method: 'getblockcount', params: [] })
      .then(_ => ({ status: 'healthy' }), _ => ({ status: 'unhealthy', message: _.message }))
  }

}

// ToDo: Add test
// check if start + (max_diff/100)*start > dst
export function isWithinLimits(start: string, dst: string, max_diff: number): boolean {

  let limit = Buffer.from(start, 'hex')
  let value = Buffer.from(dst, 'hex')
  /* 
  The compare() method compares two buffer objects and returns a number defining their differences:
    0 if they are equal
    1 if buf1 is higher than buf2
    -1 if buf1 is lower than buf2
  */
  if (Buffer.compare(limit, value) === -1) {
    // swap
    [limit, value] = [value, limit]
  }

  // multiply
  let s = 28
  for (let i = 31; i >= 0; i--) {
    if (limit[i]) {
      s = i - 3
      break
    }
  }

  let val = value.readUInt32BE(s)
  val += Math.floor((max_diff * val) / 100)
  value.writeUInt32BE(val, s)

  for (let i = 0; i < 32; i++) {
    if (value[i] > limit[i]) {

      return false
    }
    if (value[i] < limit[i]) {
      return true
    }
  }

  return true
}


function reverseCopy(val): string {
  let i = val.length
  let result = ''
  while (i > 0) {
    i -= 2
    result += val.substr(i, 2)
  }
  return result
}

function asResult(res: RPCResponse): any {
  if (!res) throw new Error("No result")
  if (res.error)
    throw new Error((res.error as any).message || res.error + '')
  if (res.result === undefined) throw new Error("No result")
  if (res.result === null) throw new Error("No result")
  return res.result
}

function verboseParam(arg: any): number {
  if (arg === undefined) return arg
  if (arg === true) return 1
  if (arg === false) return 0
  return parseInt(arg)
}
