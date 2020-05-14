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
import { BTCBlock, serialize_blockheader } from './btc_serialize'
import { createMerkleProof } from './btc_merkle'
import { max } from 'bn.js'
import { hash } from 'in3-common/js/src/modules/eth/serialize'

interface DAP {
  dapnumber: number
  blockhash: string
  blockheader: string
  bits: string
  target: string
}

interface BTCCache {
  header: string
  txids?: string[]
  cbtx?: string
}


/**
 * handles BTC-Proofs
 */
export default class BTCHandler extends BaseHandler {

  blockCache: Map<number, BTCCache>

  constructor(config: IN3RPCHandlerConfig, transport?: Transport, nodeList?: ServerList) {
    super(config, transport, nodeList)
    this.blockCache = new Map()
  }


  /** main method to handle a request */
  async handle(request: RPCRequest): Promise<RPCResponse> {
    const toRes = (r: any) => ({ id: request.id, jsonrpc: '2.0', ...r }) as RPCResponse

    // handle special jspn-rpc
    switch (request.method) {

      case 'getblock':
        return toRes(await this.getBlock(request.params[0], request.params[1], request.in3 && request.in3.finality, request))
      case 'getblockheader':
        return toRes(await this.getBlockHeader(request.params[0], request.params[1], request.in3 && request.in3.finality, request))
      case 'gettransaction':
      case 'getrawtransaction':
        return toRes(await this.getTransaction(request.params[0], request.params[1], request.params[2], request.in3 && request.in3.finality, request))
      case 'getblockcount':
        return toRes(await this.getBlockCount(request.in3 && request.in3.finality, request))
      case 'getbesthash':
      case 'getbestblockhash':
        return toRes(await this.getBestBlockHash(request.in3 && request.in3.finality, request))
      case 'getdifficulty':
        return toRes(await this.getDifficulty(request.in3 && request.in3.finality, request))
      case 'in3_proofTarget':
        return toRes(await this.in3_proofTarget(parseInt(request.params[0]), request.params[1], request.params[2], request.params[3], request, request.in3 && request.in3.finality || 0, request.params[4]))
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
    const bn = []
    for (let n = blockNumber + 1; n <= blockNumber + finality; n++)
      bn.push({ method: 'getblockhash', params: [n] })

    // get all the hashes from the node
    const hashes = await this.getAllFromServer(bn, r).then(_ => _.map(asResult))

    // now we get the headers for those blocks
    const blocks = await this.getAllFromServer(hashes.map(_ => ({ method: 'getblockheader', params: [_, false] })), r).then(_ => _.map(asResult))

    // now we simply concate all headers
    return '0x' + blocks.join('')
  }

  async getBlock(hash: string, json: boolean = true, finality: number = 0, r: any) {
    if (json === undefined) json = true
    const block = await this.getFromServer({ method: "getblock", params: [hash, json] }, r).then(asResult)
    const proof: any = {}
    if (finality) proof.final = await this.getFinalityBlocks(parseInt((json ? block : await this.getFromServer({ method: "getblockheader", params: [hash, true] }, r).then(asResult)).height), finality, r)
    return { result: block, in3: { proof } }
  }

  async getBlockHeader(hash: string, json: boolean = true, finality: number = 0, r: any) {
    if (json === undefined) json = true
    const blockheader = await this.getFromServer({ method: "getblockheader", params: [hash, json] }, r).then(asResult)
    const proof: any = {}
    if (finality) proof.final = await this.getFinalityBlocks(parseInt((json ? blockheader : await this.getFromServer({ method: "getblockheader", params: [hash, true] }, r).then(asResult)).height), finality, r)

    // get coinbase transaction
    const block = await this.getFromServer({ method: "getblock", params: [hash] }, r).then(asResult);
    const cbtxhash = block.tx[0];
    proof.cbtx = '0x' + await this.getFromServer({ method: "getrawtransaction", params: hash ? [cbtxhash, false, hash] : [cbtxhash, false] }, r).then(asResult);
    // merkle proof for coinbase transaction
    proof.cbtxMerkleProof = '0x' + createMerkleProof(block.tx.map(_ => Buffer.from(_, 'hex')), Buffer.from(cbtxhash, 'hex')).toString('hex');

    return { result: blockheader, in3: { proof } }
  }

  async getTransaction(hash: string, json: boolean = true, blockhash: string = undefined, finality: number = 0, r: any) {
    if (json === undefined) json = true
    const tx = await this.getFromServer({ method: "getrawtransaction", params: blockhash ? [hash, true, blockhash] : [hash, true] }, r).then(asResult)
    console.log(tx)
    if (!tx) throw new Error("Transaction not found")
    if (blockhash && tx.blockhash != blockhash) throw new Error('invalid blockhash for tx')
    const [block, header] = await this.getAllFromServer([{ method: "getblock", params: [tx.blockhash, true] }, { method: "getblockheader", params: [tx.blockhash, false] }], r).then(a => a.map(asResult))

    const proof: any = {
      block: '0x' + header,
      txIndex: block.tx.indexOf(tx.txid),
      merkleProof: '0x' + createMerkleProof(block.tx.map(_ => Buffer.from(_, 'hex')), Buffer.from(tx.txid, 'hex')).toString('hex')
    }
    if (finality) proof.final = await this.getFinalityBlocks(parseInt(block.height), finality, r)

    // coinbase transaction
    const cbtxhash = block.tx[0];
    proof.cbtx = '0x' + await this.getFromServer({ method: "getrawtransaction", params: blockhash ? [cbtxhash, false, blockhash] : [cbtxhash, false] }, r).then(asResult);
    // merkle proof for coinbase transaction
    proof.cbtxMerkleProof = '0x' + createMerkleProof(block.tx.map(_ => Buffer.from(_, 'hex')), Buffer.from(cbtxhash, 'hex')).toString('hex');

    return { result: json ? tx : tx.hex, in3: { proof } }
  }

  async getBlockCount(finality: number = 0, r: any) {
    if (!finality) return null

    const blockNumber = await this.getFromServer( { method: "getblockcount", params: [] }, r).then(asResult) - finality; // substruct finality
    const blockhash = await this.getFromServer( { method: "getblockhash", params: [blockNumber] }, r).then(asResult) // get hash of blockNumber
    const block = await this.getFromServer({ method: "getblock", params: [blockhash] }, r).then(asResult) // get block
    const blockheader = await this.getFromServer({ method: "getblockheader", params: [blockhash, false] }, r).then(asResult) // get block header

    const proof: any = {}

    proof.block = '0x' + blockheader // add block header

    proof.final = await this.getFinalityBlocks(blockNumber, finality, r) // add finality headers

    const cbtxhash = block.tx[0]; // get coinbase tx 
    proof.cbtx = '0x' + await this.getFromServer({ method: "getrawtransaction", params: blockhash ? [cbtxhash, false, blockhash] : [cbtxhash, false] }, r).then(asResult); // add coinbase tx

    proof.cbtxMerkleProof = '0x' + createMerkleProof(block.tx.map(_ => Buffer.from(_, 'hex')), Buffer.from(cbtxhash, 'hex')).toString('hex'); // add merkle proof for coinbase tx

    return { result : blockNumber, in3: { proof } }
  }

  async getBestBlockHash(finality: number = 0, r: any) {
    if (!finality) return null

    const blockNumber = await this.getFromServer( { method: "getblockcount", params: [] }, r).then(asResult) - finality; // substruct finality
    const blockhash = await this.getFromServer( { method: "getblockhash", params: [blockNumber] }, r).then(asResult) // get hash of blockNumber
    const block = await this.getFromServer({ method: "getblock", params: [blockhash] }, r).then(asResult) // get block
    const blockheader = await this.getFromServer({ method: "getblockheader", params: [blockhash, false] }, r).then(asResult)

    const proof: any = {}

    proof.block = '0x' + blockheader // add block header

    proof.final = await this.getFinalityBlocks(blockNumber, finality, r) // add finality headers

    const cbtxhash = block.tx[0]; // get coinbase tx 
    proof.cbtx = '0x' + await this.getFromServer({ method: "getrawtransaction", params: blockhash ? [cbtxhash, false, blockhash] : [cbtxhash, false] }, r).then(asResult); // add coinbase tx

    proof.cbtxMerkleProof = '0x' + createMerkleProof(block.tx.map(_ => Buffer.from(_, 'hex')), Buffer.from(cbtxhash, 'hex')).toString('hex'); // add merkle proof for coinbase tx

    return { result : blockhash, in3: { proof } }
  }

  async getDifficulty(finality: number = 0, r: any) {
    if (!finality) return null

    const blockNumber = await this.getFromServer( { method: "getblockcount", params: [] }, r).then(asResult) - finality; // substruct finality
    const blockhash = await this.getFromServer( { method: "getblockhash", params: [blockNumber] }, r).then(asResult) // get hash of blockNumber
    const block = await this.getFromServer({ method: "getblock", params: [blockhash] }, r).then(asResult) // get block
    // need blockheader with verbosity true for difficulty and false for proof.block -> FUNCTION TO CONVERT?
    const blockheaderObj = await this.getFromServer({ method: "getblockheader", params: [blockhash, true] }, r).then(asResult)
    const blockheaderHex = await this.getFromServer({ method: "getblockheader", params: [blockhash, false] }, r).then(asResult)

    const difficulty = blockheaderObj.difficulty
    console.log(difficulty)
    const proof: any = {}

    proof.block = '0x' + blockheaderHex // add block header

    proof.final = await this.getFinalityBlocks(blockNumber, finality, r) // add finality headers

    const cbtxhash = block.tx[0]; // get coinbase tx 
    proof.cbtx = '0x' + await this.getFromServer({ method: "getrawtransaction", params: blockhash ? [cbtxhash, false, blockhash] : [cbtxhash, false] }, r).then(asResult); // add coinbase tx

    proof.cbtxMerkleProof = '0x' + createMerkleProof(block.tx.map(_ => Buffer.from(_, 'hex')), Buffer.from(cbtxhash, 'hex')).toString('hex'); // add merkle proof for coinbase tx

    return { result : difficulty, in3: { proof } }
  }

  async in3_proofTarget(targetDap: number, verifiedDap: number, maxDiff: number, maxDap: number, r: any, finality?: number, limit?: number) {

    if (limit === 0 || limit > 40 || limit === undefined) limit = 40 // prevent DoS (internal max_limit = 40)

    const bn = [] // array of block numbers

    // fill bn array with block numbers & dapNumbers array with dap number
    if (targetDap < verifiedDap) {
      // verified target is greater than target
      for(let i = verifiedDap; i >= targetDap; i--) {
        const n = i * 2016 // get block number of first block of the dap
        bn.push({ method: 'getblockhash', params: [n] })
      }
    } else {
      for(let i = verifiedDap; i <= targetDap; i++) {
        const n = i * 2016 // get block number of first block of the dap
        bn.push({ method: 'getblockhash', params: [n] })  
      }
    }

    let allDaps : DAP[] = await this.getDaps(bn, r) // get array of all dap-objects


    let resultDaps: DAP[] = [] // array of daps that are in the path
    let compare: DAP[] = [] // array to save 2 dap numbers to compare
    
    compare.push(allDaps[0]) // set first element to compare with (verifieddap)
    
    
    let prevDap: DAP = allDaps[0]
    let boolLimit, added = false
    let index: number

    while(!boolLimit) {
      
      index = allDaps.indexOf(compare[0]) + maxDap 
      if (index >= allDaps.length) {
        index = allDaps.length - 1 // if index is greater than length of array, then set index to index of last element
        boolLimit = true // last loop
      }
      compare.push(allDaps[index])
      added = false

      while (!added) {
        if(isWithinLimits(compare[0].target, compare[1].target, maxDiff)) {
          if (index < allDaps.length - 1) {
            resultDaps.push(compare[1]) // add element to result (if element is not targetdap)
          }
          compare.shift()
          added = true
          if (resultDaps.length === limit) boolLimit = true
        }  
        else {
          index --
          compare.shift()
          compare.push(allDaps[index])
        }
      }
    }

    console.log(resultDaps)

    const resultArray = await Promise.all(resultDaps.map(async val => {
      
      let resultobj: any = {} // result object will contain: dap, block, final, cbtx, cbtxMerkleProof

      let block = await this.getFromServer({ method: "getblock", params: [val.blockhash] }, r).then(asResult) // get block
      let cbtxhash = block.tx[0]; // get coinbase tx 

      resultobj.dap = val.dapnumber
      resultobj.block = '0x' + val.blockheader
      if (finality > 0) resultobj.final = await this.getFinalityBlocks(val.dapnumber * 2016, finality, r) // add finality headers 
      resultobj.cbtx = '0x' + await this.getFromServer({ method: "getrawtransaction", params: val.blockhash ? [cbtxhash, false, val.blockhash] : [cbtxhash, false] }, r).then(asResult); // add coinbase tx
      resultobj.cbtxMerkleProof =  '0x' + createMerkleProof(block.tx.map(_ => Buffer.from(_, 'hex')), Buffer.from(cbtxhash, 'hex')).toString('hex'); // add merkle proof for coinbase tx 

      return resultobj
    }))

    console.log(resultArray)

    return { resultArray }
  }

  async getDaps(bn: any, r: any): Promise<DAP[]> {
    const hashes: string[] = await this.getAllFromServer(bn, r).then(_ => _.map(asResult)) // get all hashes
    if (!hashes || hashes.findIndex(_=>!_)>=0) throw new Error("block not found") // error handling

    const blocks: string[] = await this.getAllFromServer(hashes.map(_ => ({ method: 'getblockheader', params: [_, false] })), r).then(_ => _.map(asResult)) // get all blocks
    if (!blocks || blocks.findIndex(_=>!_)>=0) throw new Error("block not found") // error handling
  
    let daps: DAP[] = [] // initialize array
    for(let i = 0; i < bn.length; i++) {
  
      let dapnumber = bn[i].params[0] / 2016; // get dap number
      let bits = reverseCopy(blocks[i].substr(144,8)) // get bits
      let length = parseInt(bits.substr(0,2), 16) // length = first 2 digits of bits-field parsed to integer
      let coefficient = bits.substr(2,6) // coefficient = last 6 digits of bits-field
      let target = (coefficient.padEnd(length * 2,'0')).padStart(64,'0') // pads the coefficient with 0 to the given length and calculates bigint
      
      // add new DAP to daps
      daps.push({dapnumber: dapnumber, blockhash: hashes[i], blockheader: blocks[i], bits: bits, target: target})
    }
    console.log(daps)
    return daps // return Array of DAPs
  }
}

// check if start + (max_diff/100)*start > dst
export function isWithinLimits(start: string, dst: string, max_diff: number): boolean {
  const limit = Buffer.from(start, 'hex')
  const value = Buffer.from(dst, 'hex')

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
        console.log('is NOT within limits')
        return false
      }
      if (value[i] < limit[i]) {
        console.log('is within limits')
        return true
      }
  }

  return true
}


function reverseCopy(val): string {
  let i = val.length
  let result = ''
  while(i > 0) {
    i-=2
    result += val.substr(i,2)
  }
  return result
}

function asResult(res: RPCResponse): any {
  if (!res) throw new Error("No result")
  if (res.error)
    throw new Error((res.error as any).message || res.error + '')
  if (res.result === undefined) throw new Error("No result")
  return res.result

}