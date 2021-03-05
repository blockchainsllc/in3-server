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

import { Transport } from '../../util/transport'
import { RPCRequest, RPCResponse, ServerList, IN3RPCHandlerConfig, AppContext } from '../../types/types'
import axios from 'axios'
import BaseHandler from '../../chains/BaseHandler'
import { BTCBlock, serialize_blockheader, BTCBlockHeader } from './btc_serialize'
import { createMerkleProof } from './btc_merkle'
import { max } from 'bn.js'
import { hash } from '../eth/serialize'
import { toChecksumAddress } from 'ethereumjs-util'
import { BTCCache, Coinbase } from './btc_cache'
import { UserError, RPCException } from '../../util/sentryError'

interface DAP {
  dapnumber: number
  blockhash: string
  blockheader: string
  bits: string
  target: string
}

/* the verification of old blocks (height < 227836) is based on checkpoints
   the creation of the checkpoints and the verification process can be found here:
   https://in3.readthedocs.io/en/develop/bitcoin.html#creation-of-the-checkpoints */
const DISTANCE_BETWEEN_CHECKPOINTS = 200

/*  BIP-34:  After block number 227,835 all blocks must include the block height in their coinbase transaction.
    block 227,836 is the first one with the height in the coinbase transaction
    every block with height < 227,836 is missing the height in the coinbase transaction */ 
const HEIGHT_BIP34 = 227836

/**
 * handles BTC-Proofs
 */
export default class BTCHandler extends BaseHandler {

  blockCache: BTCCache

  constructor(config: IN3RPCHandlerConfig, transport?: Transport, nodeList?: ServerList, globalContext?: AppContext) {
    super(config, transport, nodeList, globalContext)
    this.blockCache = new BTCCache(this)
  }


  /** main method to handle a request */
  async handle(request: RPCRequest): Promise<RPCResponse> {
    const toRes = (r: any) => ({ id: request.id, jsonrpc: '2.0', ...r }) as RPCResponse

    // handle special json-rpc
    switch (request.method) {

      case 'getblock':
        return toRes(await this.getBlock(request.params[0], verboseParam(request.params[1]), request.in3?.finality, request.in3?.verification, request.in3?.preBIP34, request))
      case 'getblockheader':
        return toRes(await this.getBlockHeader(request.params[0], verboseParam(request.params[1]), request.in3?.finality, request.in3?.verification, request.in3?.preBIP34, request))
      case 'gettransaction':
      case 'getrawtransaction':
        return toRes(await this.getTransaction(request.params[0], verboseParam(request.params[1]), request.params[2], request.in3?.finality, request.in3?.verification, request.in3?.preBIP34, request))
      case 'getblockcount':
        return toRes(await this.getBlockCount(request.in3?.finality, request.in3?.verification, request))
      case 'getbesthash':
      case 'getbestblockhash':
        return toRes(await this.getBestBlockHash(request.in3?.finality, request.in3?.verification, request))
      case 'getdifficulty':
        return toRes(await this.getDifficulty(request.params[0], request.in3?.finality, request.in3?.verification, request.in3?.preBIP34, request))
      case 'btc_proofTarget':
        return toRes(await this.btc_proofTarget(parseInt(request.params[0]), parseInt(request.params[1]), parseInt(request.params[2]),
          parseInt(request.params[3]), request.in3?.preBIP34, request, request.in3?.finality || 0, parseInt(request.params[4])))
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

  async getFinalityBlocks(blockNumber: number, finality: number, preBIP34?: boolean): Promise<string> {
    if (!finality) return "0x"

    // if epoch changes within the finality headers, we are going to add more headers
    const startEpoch = Math.floor(blockNumber / 2016) // integer division
    const endEpoch = Math.floor((blockNumber + finality) / 2016)

    // epoch changed
    if (startEpoch != endEpoch) {
      finality += (2016 - (blockNumber % 2016)) // add amount of blocks to the next epoch to the finality
    }

    const numbers: string[] = []
    if (blockNumber < HEIGHT_BIP34 && preBIP34) {
      // we need to determine the numbers of the blocks up to the next checkpoint
      // next checkpoint is the next multiple of 200 after blockNumber
      if (blockNumber % DISTANCE_BETWEEN_CHECKPOINTS === 0) return "0x" // edge-case: requested block is a ceckpoint (return no further headers)
      let checkpoint = blockNumber + (DISTANCE_BETWEEN_CHECKPOINTS - (blockNumber % DISTANCE_BETWEEN_CHECKPOINTS)) 
      for (let n = blockNumber + 1; n <= checkpoint; n++) {
        numbers.push(n.toString())
      }
    } else {
      // we need to determine the numbers of the next blocks.
      for (let n = blockNumber + 1; n <= blockNumber + finality; n++) {
        numbers.push(n.toString())
      }
    }
    
    // get headers
    const headers: string[] = (await this.blockCache.getBlockHeaderByNumber(numbers, false)).map(_ => _.toString('hex'))
    
    // now we simply concate all headers
    return '0x' + headers.join('')
  }

  async getBlock(hash: string, json: number = 1, finality: number = 0, verification: string = "never", preBIP34: boolean = false, r: any) {

    let [block, blockHeight] = await Promise.all([
      this.getFromServer({ method: "getblock", params: [hash, json] }, r).then(asResult),
      json ? undefined : this.blockCache.getBlockHeaderByHash([hash], true).then(_ => _.pop().height)
    ])

    if (blockHeight === undefined && block) blockHeight = block.height

    if (verification === "never") 
      return { result: block } // return result without a proof 

    const proof: any = {}

    proof.final = await this.getFinalityBlocks(parseInt(blockHeight), finality, preBIP34)

    if (blockHeight < HEIGHT_BIP34) {
      if (preBIP34) proof.height = blockHeight
    } else {
      const cb = (await this.blockCache.getCoinbaseByHash([hash])).shift()
      proof.cbtx = asHex(cb.cbtx)
      proof.cbtxMerkleProof = asHex(createMerkleProof(cb.txids, cb.txids[0]))
    }

    if (!!json && blockHeight !== 0) this.blockCache.setBlock(block)// save block in cache (does not work for genesis block, previousblockhash is not existing)
      
    return { result: block, in3: { proof } }
  }


  async getBlockHeader(hash: string, json: number = 1, finality: number = 0, verification: string = "never", preBIP34: boolean = false, r: any) {
  
    let blockheader: any // can be json-object or hex-string
    json ? blockheader = (await this.blockCache.getBlockHeaderByHash([hash], !!json)).pop() : blockheader = ((await this.blockCache.getBlockHeaderByHash([hash], !!json)).pop()).toString('hex')

    if (verification === "never") 
      return { result: blockheader } // return result without a proof 

    const number = this.blockCache.data.get(hash).height
    const proof: any = {}

    proof.final = await this.getFinalityBlocks(number, finality, preBIP34)

    // check for bip34
    if (number < HEIGHT_BIP34) {
      if (preBIP34) proof.height = number
    } else {
      const cb: Coinbase = (await this.blockCache.getCoinbaseByHash([hash])).shift()
      proof.cbtx = asHex(cb.cbtx)
      proof.cbtxMerkleProof = asHex(createMerkleProof(cb.txids, cb.txids[0]))
    }

    return { result: blockheader, in3: { proof } }
  }

  async getTransaction(hash: string, json: number = 0, blockhash: string = undefined, finality: number = 0, verification: string = "never", preBIP34: boolean = false, r: any) {

    // even for json==false we get it as json from server so we know the blockhash
    const tx = await this.getFromServer({ method: "getrawtransaction", params: blockhash ? [hash, true, blockhash] : [hash, true] }, r).then(asResult)
    if (!tx) throw new Error("Transaction not found")
    if (!blockhash) blockhash = tx.blockhash
    if (blockhash && tx.blockhash != blockhash) throw new Error('invalid blockhash for tx')

    if (verification === "never")
      return { result: json ? tx : tx.hex } // return result without a proof 

    const proof: any = {}

    const cb: Coinbase = (await this.blockCache.getCoinbaseByHash([blockhash])).shift()

    // after fetching the coinbase the block header and number are ALWAYS in the cache
    const number = this.blockCache.data.get(blockhash).height

    proof.block = asHex(this.blockCache.data.get(blockhash).header)

    proof.final = await this.getFinalityBlocks(number, finality, preBIP34)

    proof.txIndex = cb.txids.findIndex(_ => _.equals(Buffer.from(hash, 'hex'))) // get index of tx
    proof.merkleProof = asHex(createMerkleProof(cb.txids, Buffer.from(hash, 'hex')))

    // check for bip34
    if (number < HEIGHT_BIP34) {
      if (preBIP34) proof.height = number
    } else {
      proof.cbtx = asHex(cb.cbtx)
      proof.cbtxMerkleProof = asHex(createMerkleProof(cb.txids, cb.txids[0]))
    }

    return { result: json ? tx : tx.hex, in3: { proof } }
  }

  async getBlockCount(finality: number = 0, verification: string = "never", r: any) {

    if (verification === "never")
      // return latest block number without a proof (finality is not subtracted since there will no proof anyway)
      return { result: await this.getFromServer({ method: "getblockcount", params: [] }, r).then(asResult) } 
    

    // get latest block number (latest always means actual latest number minus finality)
    const blocknumber = await this.getFromServer({ method: "getblockcount", params: [] }, r).then(asResult) - finality; // subtract finality

    const proof: any = {}

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

    // fill proof
    proof.block = asHex(this.blockCache.data.get(blockhash).header) // add block header
    proof.final = await this.getFinalityBlocks(blocknumber, finality, r) // add finality headers
    proof.cbtx = asHex(cb.cbtx)
    proof.cbtxMerkleProof = asHex(createMerkleProof(cb.txids, cb.txids[0]))

    return { result: blocknumber, in3: { proof } }
  }

  async getBestBlockHash(finality: number = 0, verification: string = "never", r: any) {

    let blocknumber =  await this.getFromServer({ method: "getblockcount", params: [] }, r).then(asResult)
    if (verification === "proof") blocknumber -= finality // subtract finality

    // check cache for number
    let blockhash
    if (this.blockCache.data.has(blocknumber.toString())) {
      blockhash = this.blockCache.data.get(blocknumber.toString()).hash.toString('hex') // get hash out of cache 
      // no need to call a function here because cache will be filled anyways by "getCoinbaseByHash" later on
    } else {
      blockhash = await this.getFromServer({ method: "getblockhash", params: [blocknumber] }, r).then(asResult) // get hash of blockNumber
    }

    if (verification === "never")
      return { result: blockhash } // return result without a proof 

    const proof: any = {}

    // after fetching coinbase, cache is filled with the BTCCacheValue-object we need
    const cb: Coinbase = (await this.blockCache.getCoinbaseByHash([blockhash])).shift()

    // fill proof
    proof.block = asHex(this.blockCache.data.get(blockhash).header) // add block header
    proof.final = await this.getFinalityBlocks(blocknumber, finality, r) // add finality headers
    proof.cbtx = asHex(cb.cbtx)
    proof.cbtxMerkleProof = asHex(createMerkleProof(cb.txids, cb.txids[0]))

    return { result: blockhash, in3: { proof } }
  }

  async getDifficulty(bn: string, finality: number = 0, verification: string = "never", preBIP34: boolean = false, r: any) {

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

    if (verification === "never")
      return { result: blockheader.difficulty } // return result without a proof

    const proof: any = {}

    proof.block = asHex(serialize_blockheader(blockheader)) // add block header
    proof.final = await this.getFinalityBlocks(blocknumber, finality, preBIP34) // add finality headers

    // check for bip34
    if (blockheader.height < HEIGHT_BIP34) {
      if (preBIP34) proof.height = blockheader.height
    } else {
      const cb: Coinbase = (await this.blockCache.getCoinbaseByHash([blockheader.hash])).shift()
      proof.cbtx = asHex(cb.cbtx)
      proof.cbtxMerkleProof = asHex(createMerkleProof(cb.txids, cb.txids[0]))
    }

    return { result: blockheader.difficulty, in3: { proof } }
  }

  async btc_proofTarget(targetDap: number, verifiedDap: number, maxDiff: number, maxDap: number, preBIP34: boolean = false, r: any, finality?: number, limit?: number) {

    if (maxDap === 0) throw new UserError("number of daps between two daps has to be greater than 0", RPCException.INVALID_PARAMS)

    if (limit === 0 || limit > 40 || !limit) limit = 40 // prevent DoS (internal max_limit = 40)

    if (finality * limit > 1000 ) throw new UserError("maximum amount of finality headers per request is 1000", RPCException.INVALID_PARAMS)

    if (targetDap === 0 || verifiedDap === 0) throw new UserError("verified and target dap can't be genesis dap", RPCException.INVALID_PARAMS)

    const bn: number = await this.getFromServer({ method: "getblockcount", params: [] }, r).then(asResult)
    const currentDap = Math.floor(bn / 2016)

    if ((targetDap > currentDap) || (verifiedDap > currentDap)) throw new UserError("given dap isn't existing yet", RPCException.BLOCK_TOO_YOUNG)

    if ((targetDap === verifiedDap) || (Math.abs(verifiedDap - targetDap) === 1)) {
      return { result: [] } // return an empty array
    }

    if (maxDiff === 0) maxDap = 1 // all daps between verified and target have to be in the result
                                  // to avoid many loop passes, maxDap is set to 1

    let path: DAP[] = [] // array of daps that are in the path
    let compare: DAP[] = [] // array to save 2 daps to compare

    let boolLimit, added = false
    let nextdap: number

    let past: boolean = targetDap < verifiedDap

    compare.push(await this.getDap(verifiedDap))

    while(!boolLimit) {
      past ? nextdap = compare[0].dapnumber - maxDap : nextdap = compare[0].dapnumber + maxDap // calculate dap to compare with

      if ((past && nextdap <= targetDap) || (!past && nextdap >= targetDap)) {
        nextdap = targetDap
        boolLimit = true
      } 

      compare.push(await this.getDap(nextdap))
      added = false

      while(!added) {
        // add dap to path when
        // target decreased OR daps are next to each other OR they are within given limits
        if ((compare[0].target > compare[1].target) || ((Math.abs(compare[0].dapnumber - compare[1].dapnumber) === 1)) || (isWithinLimits(compare[0].target, compare[1].target, maxDiff))) {
          if (nextdap != targetDap)
            path.push(compare[1]) // add to path (if it's not the target dap)
          compare.shift()
          added = true
          if (path.length === limit) boolLimit = true
        } else {
          // dap doesn't fulfill conditions from above - try with a different dap
          compare.pop()
          past ? nextdap++ : nextdap--
          compare.push(await this.getDap(nextdap))
        }
      }
    }

    // build result (with proof data)
    const result = await Promise.all(path.map(async val => {

      let resultobj: any = {} // result object will contain: dap, block, final, cbtx, cbtxMerkleProof

      resultobj.dap = val.dapnumber
      resultobj.block = '0x' + val.blockheader
      resultobj.final = await this.getFinalityBlocks(val.dapnumber * 2016, finality, preBIP34)

      if ((val.dapnumber * 2016) < HEIGHT_BIP34) {
        if (preBIP34) resultobj.height = val.dapnumber * 2016
      } else {
        const cb: Coinbase = (await this.blockCache.getCoinbaseByHash([val.blockhash])).shift()
        resultobj.cbtx = asHex(cb.cbtx)
        resultobj.cbtxMerkleProof = asHex(createMerkleProof(cb.txids, cb.txids[0]))
      }

      return resultobj
    }))

    return { result }
  }

  async getDap(dapnum: number): Promise<DAP> {

    const blockheader: string = (await this.blockCache.getBlockHeaderByNumber([(dapnum * 2016).toString()], false)).pop().toString('hex')
    // cache is now filled with hash, header and height for this block

    const blockhash = this.blockCache.data.get((dapnum * 2016).toString()).hash.toString('hex') // we can also hash the block header to get the hash (what's better?)
    const bits = reverseCopy(blockheader.substr(144, 8)) // get bits
    const length = parseInt(bits.substr(0, 2), 16) // length = first 2 digits of bits-field parsed to integer
    const coefficient = bits.substr(2, 6) // coefficient = last 6 digits of bits-field
    const target = (coefficient.padEnd(length * 2, '0')).padStart(64, '0') // pads the coefficient with 0 to the given length

    return { dapnumber: dapnum, blockhash: blockhash, blockheader: blockheader, bits: bits, target: target }
  }

  health(): Promise<{ status: string, message?: string }> {
    return this.getFromServer({ id: 1, jsonrpc: '2.0', method: 'getblockcount', params: [] })
      .then(_ => ({ status: 'healthy' }), _ => ({ status: 'unhealthy', message: _.message }))
  }

}

export function isWithinLimits(start: string, dst: string, max_diff: number): boolean {

  let value = Buffer.from(start, 'hex')
  let limit = Buffer.from(dst, 'hex')

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
 
  /* The compare() method compares two buffer objects and returns a number defining their differences:
    0 if they are equal
    1 if buf1 is higher than buf2
    -1 if buf1 is lower than buf2 */
  if (Buffer.compare(value, limit) >= 0 ) return true

  return false
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


function asHex(x: Buffer) {
  return '0x' + x.toString('hex')
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
