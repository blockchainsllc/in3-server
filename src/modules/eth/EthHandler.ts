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

import { toHex, toNumber } from '../../util/util'
import { Transport} from '../../util/transport'
import * as  serialize  from './serialize'
import { RPCRequest, RPCResponse, ServerList, IN3RPCHandlerConfig, ChainSpec, AppContext } from '../../types/types'
import { handeGetTransaction, handeGetTransactionFromBlock, handeGetTransactionReceipt, handleAccount, handleBlock, handleCall, handleLogs } from './proof'
import BaseHandler from '../../chains/BaseHandler'
import { handleSign } from '../../chains/signatures';
import { getValidatorHistory } from '../../server/poa'
import { TxRequest, LogFilter } from './api';
import * as tx from '../../../src/util/tx'
import { IncubedError, UserError, RPCException } from '../../util/sentryError'
import * as clientConf from './defaultConfig.json'

/**
 * handles EVM-Calls
 */
export default class EthHandler extends BaseHandler {

  constructor(config: IN3RPCHandlerConfig, transport?: Transport, nodeList?: ServerList, globalContext?: AppContext) {

    super(config, transport, nodeList, globalContext)

  }

  /** main method to handle a request */
  async handle(request: RPCRequest): Promise<RPCResponse> {
    // replace the latest BlockNumber
    if (request.in3 && request.in3.latestBlock && Array.isArray(request.params)) {
      const i = request.params.indexOf('latest')
      if (i >= 0){
        request.params[i] = toHex((![0, -1].includes(this.watcher.block.number) ? this.watcher.block.number : await this.getFromServer({ method: 'eth_blockNumber', params: [] }, request).then(_ => toNumber(_.result))) - request.in3.latestBlock)
      }
    }

    // make sure the in3 params are set
    if (!request.in3)
      request.in3 = { verification: 'never', chainId: this.chainId }

    if (!request.in3.verification)
      request.in3.verification = 'never'

    // execute it
    try {
      const result = await this.handleRPCMethod(request)
      if ((request as any).convert)
        (request as any).convert(result)
      return result
    }
    catch (error) {
      return this.toError(request, error)
    }
  }

  private checkPerformanceLimits(request: RPCRequest) {
    const maxAllowedGas: number = 10000000  //max default allowed gas 10M

    if (request.method === 'eth_call') {
      if (!request.params || request.params.length < 2)
        throw new Error('eth_call must have a transaction and a block as parameters')

      const gasLimit = this.config.maxGasLimit || maxAllowedGas

      const tx = request.params[0] as TxRequest
      if (!tx || (tx.gas && toNumber(tx.gas) > gasLimit)) {
        throw new Error('eth_call with a gaslimit > ' + gasLimit + ' are not allowed')
      }
    }
    else if (request.method === 'eth_getLogs') {
      if (!request.params || request.params.length < 1) throw new Error('eth_getLogs must have a filter as parameter')
      const filter: LogFilter = request.params[0]
      let toB = filter && filter.toBlock

      if (toB === 'pending' && request.in3.verification.startsWith('proof')) throw new Error("proof on pending not supported")

      if (toB === 'latest' || toB === 'pending' || !toB) toB = this.watcher && this.watcher.block && this.watcher.block.number
      let fromB = toB && filter && filter.fromBlock

      if (fromB === 'pending' && request.in3.verification.startsWith('proof')) throw new Error("proof on pending not supported")

      if (fromB === 'earliest') fromB = 1;
      const range = fromB && (toNumber(toB) - toNumber(fromB))
      if (range > (request.in3.verification.startsWith('proof') ? 1000 : 10000))
        throw new Error('eth_getLogs for a range of ' + range + ' blocks is not allowed. limits: with proof: 1000, without 10000 ')
    }
  }

  private fixLegacySupport(request: RPCRequest) {
    // handle shortcut-functions
    if (request.method === 'in3_call') {
      request.method = 'eth_call'
      request.params = createCallParams(request)
    }
    if (request.in3 && request.in3.signatures && !request.in3.signers)
      request.in3.signers = request.in3.signatures
  }

  private async handleRPCMethod(request: RPCRequest) {

    this.fixLegacySupport(request)

    // check performancelimits
    this.checkPerformanceLimits(request)

    if (request.in3 && request.in3.whiteList)
      await this.whiteListMgr.addWhiteListWatch(request.in3.whiteList)

    // handle special jspn-rpc
    if (request.in3.verification == 'proof' || request.in3.verification == 'proofWithSignature') // proofWithSignature is only supported for legacy, since only the request for signers is relveant
      switch (request.method) {
        case 'eth_getBlockByNumber':
        case 'eth_getBlockByHash':
        case 'eth_getBlockTransactionCountByHash':
        case 'eth_getBlockTransactionCountByNumber':
          return handleBlock(this, request)
        case 'eth_getTransactionByBlockHashAndIndex':
        case 'eth_getTransactionByBlockNumberAndIndex':
          return handeGetTransactionFromBlock(this, request)
        case 'eth_getTransactionByHash':
          return handeGetTransaction(this, request)
        case 'eth_getTransactionReceipt':
          return handeGetTransactionReceipt(this, request)
        case 'eth_getLogs':
          return handleLogs(this, request)
        case 'eth_call':
          return handleCall(this, request)

        case 'eth_getCode':
        case 'eth_getBalance':
        case 'eth_getTransactionCount':
        case 'eth_getStorageAt':
          return handleAccount(this, request)
        default:

      }

    // handle in3-methods
    switch (request.method) {

      case 'eth_sign':
      case 'eth_sendTransaction':
        return this.toError(request, new IncubedError('An in3 - node can not sign Messages, because the no unlocked key is allowed!'))

      case 'eth_submitWork':
      case 'eth_submitHashrate':
        return this.toError(request, new UserError('Incubed cannot be used for mining since there is no coinbase', RPCException.INVALID_METHOD))

      case 'in3_sign':
        return handleSign(this, request)

      default:
        // default handling by simply getting the response from the server
        return this.getFromServer(request, request)
    }
  }

  getRequestFromPath(path: string[], in3: { chainId: string; }): RPCRequest {
    if (path[0] && path[0].startsWith('0x') && path[0].length < 43) {
      const [contract, method] = path
      const r: RPCRequest = { id: 1, jsonrpc: '2.0', method: '', params: [contract, 'latest'], in3 }
      switch (method) {
        case 'balance': return { ...r, method: 'eth_getBalance' }
        case 'nonce': return { ...r, method: 'eth_getTransactionCount' }
        case 'code': return { ...r, method: 'eth_getCode' }
        case 'storage': return { ...r, method: 'eth_getStorageAt', params: [contract, path[2], 'latest'] }
        default:
          return { ...r, method: 'in3_call', params: [contract, method, ...path.slice(2).join('/').split(',').filter(_ => _).map(_ => _ === 'true' ? true : _ === 'false' ? false : _)] }
      }
    }
    else if (path[0] && path[0].startsWith('0x') && path[0].length > 43)
      return { id: 1, jsonrpc: '2.0', method: 'eth_getTransactionReceipt', params: [path[0]], in3 }
    else if (path[0] && (parseInt(path[0]) || path[0] === 'latest'))
      return { id: 1, jsonrpc: '2.0', method: 'eth_getBlockByNumber', params: [path[0] === 'latest' ? 'latest' : '0x' + parseInt(path[0]).toString(16), false], in3 }

    return null
  }

  async getAuthorities(blockNumber: number): Promise<Buffer[]> {
    const spec = this.getChainSpec()

    //get all the states from validatorHistory from the specified blocknumber
    const validatorStates = spec && (await getValidatorHistory(this)).states
    if (!validatorStates || !validatorStates.length) return []

    let pos = validatorStates.length - 1;
    for (let i = pos; i; i--)
      if (validatorStates[i].block < blockNumber) break

    return validatorStates[pos].validators.map(serialize.address)
  }

  getChainSpec(): ChainSpec {
    const chain = clientConf.servers[this.chainId]
    return chain && chain.chainSpec
  }
}

function createCallParams(request: RPCRequest): any[] {
  const params = request.params || []
  const methodRegex = /^\w+\((.*)\)$/gm
  let [contract, method] = params as string[]
  if (!contract) throw new Error('First argument needs to be a valid contract address')
  if (!method) throw new Error('First argument needs to be a valid contract method signature')
  if (method.indexOf('(') < 0) method += '()'

  // since splitting for get is simply split(',') the method-signature is also split, so we reunit it.
  while (method.indexOf(')') < 0 && params.length > 2) {
    method += ',' + params[2]
    params.splice(2, 1)
  }

  if (method.indexOf(':') > 0) {
    const srcFullMethod = method;
    const fullMethod = method.endsWith(')') ? method : method.split(':').join(':(') + ')'
    const retTypes = method.split(':')[1].substr(1).replace(')', ' ').trim().split(', ');
    (request as any).convert = result => {
      if (result.result)
        result.result = tx.decodeFunction(fullMethod, Buffer.from(result.result.substr(2), 'hex'), request.context).map((v, i) => {
          if (Buffer.isBuffer(v)) return '0x' + v.toString('hex')
          if (v && v.ixor) return v.toString()
          if (retTypes[i] !== 'string' && typeof v === 'string' && v[1] !== 'x')
            return '0x' + v
          return v
        })
      if (Array.isArray(result.result) && !srcFullMethod.endsWith(')'))
        result.result = result.result[0]
      return result
    }
    method = method.substr(0, method.indexOf(':'))
  }

  const m = methodRegex.exec(method)
  if (!m) throw new Error('No valid method signature for ' + method)
  const types = m[1].split(',').filter(_ => _)
  const values = params.slice(2, types.length + 2)
  if (values.length < types.length) throw new Error('invalid number of arguments. Must be at least ' + types.length)

  return [{ to: contract, data: '0x' + tx.encodeFunction(method, values, request.context) }, params[types.length + 2] || 'latest']
}
