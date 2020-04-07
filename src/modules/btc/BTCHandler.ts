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


/**
 * handles BTC-Proofs
 */
export default class BTCHandler extends BaseHandler {

  constructor(config: IN3RPCHandlerConfig, transport?: Transport, nodeList?: ServerList) {
    super(config, transport, nodeList)
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
        return toRes(await this.getTransaction(request.params[0], request.params[1], request.in3 && request.in3.finality, request))
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
    const block = await this.getFromServer({ method: "getblockheader", params: [hash, json] }, r).then(asResult)
    const proof: any = {}
    if (finality) proof.final = await this.getFinalityBlocks(parseInt((json ? block : await this.getFromServer({ method: "getblockheader", params: [hash, true] }, r).then(asResult)).height), finality, r)
    return { result: block, in3: { proof } }
  }

  async getTransaction(hash: string, json: boolean = true, finality: number = 0, r: any) {
    if (json === undefined) json = true
    const tx = await this.getFromServer({ method: "getrawtransaction", params: [hash, true] }, r).then(asResult)
    if (!tx) throw new Error("Transaction not found")
    const [block, header] = await this.getAllFromServer([{ method: "getblock", params: [tx.blockhash, true] }, { method: "getblockheader", params: [tx.blockhash, false] }], r).then(a => a.map(asResult))
    const proof: any = { block: '0x' + header, merkleProof: '0x' + createMerkleProof(block.tx.map(_ => Buffer.from(_, 'hex')), Buffer.from(tx.hash, 'hex')).toString('hex') }
    if (finality) proof.final = await this.getFinalityBlocks(parseInt(block.height), finality, r)
    return { result: json ? tx : tx.hex, in3: { proof } }
  }

}

function asResult(res: RPCResponse): any {
  if (!res) throw new Error("No result")
  if (res.error)
    throw new Error((res.error as any).message || res.error + '')
  if (res.result === undefined) throw new Error("No result")
  return res.result

}