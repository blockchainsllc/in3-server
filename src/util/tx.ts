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

import { methodID } from 'ethereumjs-abi'
import { toBuffer } from 'ethereumjs-util'
import { Transport, AxiosTransport } from './transport'
import * as  util  from './util'
import { RPCResponse, AppContext } from '../types/types'
import { SentryError } from '../util/sentryError'
import { AbiCoder } from '@ethersproject/abi'
import { PK } from '../chains/signatures'
import { toMinHex,toHex } from './util';
const BN = require('bn.js')
const ETx = require('ethereumjs-tx') as any


let idCount = 1
export async function deployContract(url: string, bin: string, txargs?:
    {
      privateKey: PK
      gas: number
      nonce?: number
      gasPrice?: number
      to?: string
      data?: string
      value?: number
      confirm?: boolean
    },
    transport?: Transport,
    context?: AppContext,
    timeout?: number
  ) {
  return sendTransaction(url, { value: 0, ...txargs, data: bin }, transport, context, timeout)
}

export async function callContract(url: string, contract: string, signature: string, args: any[], txargs?: {
  privateKey: PK
  gas?: number
  nonce?: number
  gasPrice?: number
  to?: string
  data?: string
  value: any
  confirm?: boolean
}, transport?: Transport, blockNumber?: number, context?: AppContext) {
  if (!transport) transport = new AxiosTransport()
  const data = '0x' + encodeFunction(signature, args, context)

  if (txargs) {
    return sendTransaction(url, { ...txargs, to: contract, data }, transport, context).catch(err => {
      throw new Error('Could not call ' + signature + '(' + args.map(toHex).join() + ') to ' + contract + ' : ' + err.message)
    })
  }

  context?.hub?.addBreadcrumb({
    category: "encoding call",
    data: {
      jsonrpc: '2.0',
      id: idCount++,
      method: 'eth_call', params: [{
        to: contract,
        data
      }],
      signature: signature,
      args: args
    }
  })

  return decodeFunction(signature.replace('()', '(uint)'), toBuffer(await transport.handle(url, {
    jsonrpc: '2.0',
    id: idCount++,
    method: 'eth_call', params: [{
      to: contract,
      data
    },
    (blockNumber ? toMinHex(blockNumber) : 'latest')]
  }).then((_: RPCResponse) => _.error
    ? Promise.reject(new Error('Could not call ' + contract + ' with ' + signature + ' params=' + JSON.stringify(args) + ':' + _.error)) as any
    : _.result + ''
  )), context)
}


export async function sendTransaction(url: string, txargs: {
  privateKey: PK
  gas?: number
  nonce?: number
  gasPrice?: number
  to?: string
  data: string
  value: any
  confirm?: boolean
}, transport?: Transport, context?: AppContext, timeout?: number): Promise<{
  blockHash: string,
  blockNumber: string,
  contractAddress: string,
  cumulativeGasUsed: string,
  gasUsed: string,
  logs: string[],
  logsBloom: string,
  root: string,
  status: string,
  transactionHash: string,
  transactionIndex: string
}> {

  if (!transport) transport = new AxiosTransport()
  const key = txargs.privateKey
  const from = key.address

  // get the nonce
  if (!txargs.nonce)
    txargs.nonce = await transport.handle(url, {
      jsonrpc: '2.0',
      id: idCount++,
      method: 'eth_getTransactionCount',
      params: [from, 'latest'],
      context: context
    }).then((_: RPCResponse) => {
      if (_.error) {
        throw new Error(_.error)
      }
      return parseInt(_.result as any)
    })

  // get the nonce
  if (!txargs.gasPrice)
    txargs.gasPrice = await transport.handle(url, {
      jsonrpc: '2.0',
      id: idCount++,
      method: 'eth_gasPrice',
      params: [],
      context: context
    }).then((_: RPCResponse) => {
      if (_.error) {
        throw new Error(_.error)
      }
      return parseInt(_.result as any)
    })

  if (!txargs.gas)
    txargs.gas = await transport.handle(url, {
      jsonrpc: '2.0',
      id: idCount++,
      method: 'eth_estimateGas',
      params: [{
        from: key.address,
        to: txargs.to || undefined,
        data: txargs.data,
        value: txargs.value || "0x0"
      }],
      context: context
    }).then((_: RPCResponse) => {
      if (_.error) {
        throw new Error('Error estimaing gas for tx to ' + txargs.to + ' with data ' + txargs.data + ' : ' + (_.error as any).message || _.error)
      }
      return Math.floor(parseInt(_.result as any) * 1.1)
    })

  // create Transaction
  const tx = new ETx({
    nonce: toHex(txargs.nonce),
    gasPrice: toHex(txargs.gasPrice),
    gasLimit: toHex(txargs.gas),
    gas: toHex(txargs.gas),
    to: txargs.to ? toHex(txargs.to, 20) : undefined,
    value: toHex(txargs.value || 0),
    data: toHex(txargs.data)
  })

  context?.hub?.addBreadcrumb({
    category: "sending tx",
    data: txargs
  })

  // We clear any previous signature before signing it. Otherwise, _implementsEIP155's can give
  // different results if this tx was already signed.
  const sig = key.sign(tx.hash(false))
  if (tx._chainId)
    sig.v += tx._chainId * 2 + 8

  Object.assign(tx, sig)

  const txHash = await transport.handle(url, {
    jsonrpc: '2.0',
    id: idCount++,
    method: 'eth_sendRawTransaction',
    params: [toHex(tx.serialize())],
    context: context
  }).then((_: RPCResponse) => _.error ? Promise.reject(new Error('Error sending the tx ' + JSON.stringify(txargs) + ':' + JSON.stringify(_.error))) as any : _.result + '')

  return txargs.confirm ? waitForReceipt(url, txHash, timeout || 30, txargs.gas, transport, context) : txHash
}

export async function getErrorReason(url: string, txHash: string, transport?: Transport): Promise<string> {

  const clientVersion = await transport.handle(url, {
    jsonrpc: '2.0',
    id: idCount++,
    method: 'web3_clientVersion',
    params: []
  }).then((_: RPCResponse) => _.result as string) || ''
  let returnValue = ''

  if (clientVersion.includes("Parity")) {
    const trace = await transport.handle(url, {
      jsonrpc: '2.0',
      id: idCount++,
      method: 'trace_replayTransaction',
      params: [txHash, ['trace']]
    }).then((_: RPCResponse) => _.result)
    returnValue = trace.output

  }
  if (clientVersion.includes("Geth")) {
    const trace = await transport.handle(url, {
      jsonrpc: '2.0',
      id: idCount++,
      method: 'debug_traceTransaction',
      params: [txHash]
    }).then((_: RPCResponse) => _.result)
    returnValue = "0x" + trace.returnValue
  }
  if (!returnValue || returnValue.length < 128) return ''
  const len = parseInt('0x' + returnValue.substr(69 * 2 - 8, 8))
  return util.toUtf8('0x' + returnValue.substr(69 * 2, len * 2)) + ' in tx ' + txHash
}


export async function waitForReceipt(url: string, txHash: string, timeout = 10, sentGas = 0, transport?: Transport, context?: AppContext) {
  if (!transport) transport = new AxiosTransport()

  let steps = 200
  const start = Date.now()
  while (Date.now() - start < timeout * 1000) {
    const r = await transport.handle(url, {
      jsonrpc: '2.0',
      id: idCount++,
      method: 'eth_getTransactionReceipt',
      params: [txHash]
    }) as RPCResponse


    if (r.error) throw new SentryError('Error fetching receipt', context, 'error_fetching_tx', 'Error fetching the receipt for ' + txHash + ' : ' + JSON.stringify(r.error))
    if (r.result) {
      const receipt = r.result as any
      if (sentGas && parseInt(sentGas as any) === parseInt(receipt.gasUsed))
        throw new SentryError((await getErrorReason(url, txHash, transport)) + ' Transaction failed and all gas was used up', context, 'gas_error', sentGas + ' not enough')
      if (receipt.status && receipt.status == '0x0')
        throw new SentryError((await getErrorReason(url, txHash, transport)) + ' tx failed', context, 'tx_failed', 'The Transaction failed because it returned status=0')
      return receipt
    }


    // wait a second and try again
    await new Promise(_ => setTimeout(_, Math.min(timeout * 200, steps *= 2)))
  }

  throw new SentryError('Error waiting for the transaction to confirm')
}

function encodeEtheresBN(val: any) {
  return val && BN.isBN(val) ? toHex(val) : val
}

export function encodeFunction(signature: string, args: any[], context?: AppContext): string {
  const inputParams = signature.split(':')[0]

  const abiCoder = new AbiCoder()

  const typeTemp = inputParams.substring(inputParams.indexOf('(') + 1, (inputParams.indexOf(')')))

  const typeArray = typeTemp.length > 0 ? typeTemp.split(",") : []
  const methodHash = (methodID(signature.substr(0, signature.indexOf('(')), typeArray)).toString('hex')

  context?.hub?.addBreadcrumb({
    category: "encodeFunction",
    data: { signature, args }
  })

  try {
    return methodHash + abiCoder.encode(typeArray, args.map(encodeEtheresBN)).substr(2)
  } catch (e) {
    context?.hub?.configureScope({ ABIError: "encode" })
    throw new Error("ABI-encoding error")
  }
}

function fixBN(val: any) {
  if (val && val._isBigNumber) return new BN.BN(val.toHexString().substr(2), 'hex')
  if (Array.isArray(val)) return val.map(fixBN)
  return val
}

export function decodeFunction(signature: string | string[], args: Buffer, context?: AppContext): any {

  const outputParams = Array.isArray(signature) ? "(" + signature.toString() + ")" : signature.split(':')[1]

  const abiCoder = new AbiCoder()

  const typeTemp = outputParams.substring(outputParams.indexOf('(') + 1, (outputParams.indexOf(')')))

  const typeArray = typeTemp.length > 0 ? typeTemp.split(",") : []

  context?.hub?.addBreadcrumb({
    category: "decodeFunction",
    data: { signature, args }
  })

  try {
    return fixBN(abiCoder.decode(typeArray, args))
  } catch (e) {
    let sentryTags = { ABIError: "decode" }
    let sentryExtras = { outputParams, signature, args }
    context?.hub?.configureScope(sentryTags, sentryExtras)
    throw new Error("ABI-decoding error")
  }
}

export function isValidAddress(addr: String) {
  if (typeof addr !== 'string')
    throw new Error('Invalid address')

  return addr && addr.match(/^0x[0-9a-fA-F]{40}$/)
}