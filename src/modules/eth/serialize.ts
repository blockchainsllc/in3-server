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

import * as ethUtil from '@ethereumjs/util'
import { Transaction as Tx } from '@ethereumjs/tx'
import { rlp, rlphash, keccak } from 'ethereumjs-util'
import { toBuffer, toHex } from '../../util/util'

/** Buffer[] of the header */
export type BlockHeader = Buffer[]

/** Buffer[] of the transaction */
export type Transaction = Buffer[]

/** Buffer[] of the Account */
export type Account = Buffer[]

/** Buffer[] of the Receipt */
export type Receipt = [Buffer, Buffer, Buffer, [Buffer, Buffer[], Buffer][]]

/** Block as returned by eth_getBlockByNumber */
export interface BlockData {
  hash: string
  parentHash: string
  sha3Uncles: string
  miner: string
  coinbase?: string
  stateRoot: string
  transactionsRoot: string
  receiptsRoot: string
  receiptRoot?: string
  logsBloom: string
  difficulty: string | number
  number: string | number
  gasLimit: string | number
  gasUsed: string | number
  timestamp: string | number
  extraData: string
  sealFields?: string[]
  mixHash?: string
  nonce?: string | number
  transactions?: any[]
  uncles?: string[]
  baseFeePerGas?: string
}

/** Transaction as returned by eth_getTransactionByHash */
export interface TransactionData {
  hash: string
  blockHash?: string
  blockNumber?: number | string
  chainId?: number | string
  condition?: string
  creates?: string
  from?: string
  gas?: number | string
  gasLimit?: number | string
  gasPrice?: number | string
  input: string
  data?: string
  nonce: number | string
  publicKey?: string
  raw?: string
  standardV?: string
  to: string
  transactionIndex: number,
  r?: string
  s?: string
  v?: string
  value: number | string
  type?: string
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
  accessList?: { address: string, storageKeys: string[] }[]
}

/** Account-Object */
export interface AccountData {
  nonce: string
  balance: string
  storageHash: string
  codeHash: string
  code?: string
}

/** LogData as part of the TransactionReceipt */
export interface LogData {
  removed: boolean // true when the log was removed, due to a chain reorganization. false if its a valid log.
  logIndex: string //  integer of the log index position in the block. null when its pending log.
  transactionLogIndex: string //  integer of the log index position in the transaction. null when its pending log.
  transactionIndex: string // of the transactions index position log was created from. null when its pending log.
  transactionHash: string // 32 Bytes - hash of the transactions this log was created from. null when its pending log.
  blockHash: string // 32 Bytes - hash of the block where this log was in. null when its pending. null when its pending log.
  blockNumber: string // - the block number where this log was in. null when its pending. null when its pending log.
  address: string //, 20 Bytes - address from which this log originated.
  data: string // contains one or more 32 Bytes non-indexed arguments of the log.
  topics: string[] //Array of DATA - Array of 0 to 4 32 Bytes DATA of indexed log arguments. (In solidity: The first topic is the hash of the signature of the event (e.g. Deposit(address,bytes32,uint256)), except you declared the event with the anonymous specifier.)
}

/** TransactionReceipt as returned by eth_getTransactionReceipt */
export interface ReceiptData {
  type?: string
  transactionHash?: string
  transactionIndex?: number
  blockNumber?: string | number
  blockHash?: string
  status?: string | boolean
  root?: string
  cumulativeGasUsed?: string | number
  gasUsed?: string | number
  logsBloom?: string
  logs: LogData[]
}


/** serialize the data  */
const serialize = (val: Block | Transaction | Receipt | Account | any) => rlp.encode(val) as Buffer

/** returns the hash of the object */
export const hash = (val: Block | Transaction | Receipt | Account | Buffer) => Array.isArray(val) ? rlphash(val) : keccak(Buffer.from(val))


// types ...

/** converts it to a Buffer with 256 bytes length */
export const bytes256 = val => toBuffer(val, 256)
/** converts it to a Buffer with 32 bytes length */
export const bytes32 = val => toBuffer(val, 32)
/** converts it to a Buffer with 8 bytes length */
export const bytes8 = val => toBuffer(val, 8)
/** converts it to a Buffer  */
export const bytes = val => toBuffer(val)
/** converts it to a Buffer with 20 bytes length */
export const address = val => toBuffer(val, 20)
/** converts it to a Buffer with a variable length. 0 = length 0*/
export const uint = val => toBuffer(val, 0)

export const uint64 = val => toBuffer(val, 8)
export const uint128 = val => toBuffer(val, 16)

/** create a Buffer[] from RPC-Response */
export function toBlockHeader(block: BlockData) {
  const bh = [
    bytes32(block.parentHash),
    bytes32(block.sha3Uncles),
    address(block.miner || block.coinbase),
    bytes32(block.stateRoot),
    bytes32(block.transactionsRoot),
    bytes32(block.receiptsRoot || block.receiptRoot),
    bytes256(block.logsBloom),
    uint(block.difficulty),
    uint(block.number),
    uint(block.gasLimit),
    uint(block.gasUsed),
    uint(block.timestamp),
    bytes(block.extraData),

    ...block.sealFields
      ? block.sealFields.map(s => rlp.decode(bytes(s)))
      : [
        bytes32(block.mixHash),
        bytes8(block.nonce)
      ]
  ] as BlockHeader
  if (block.baseFeePerGas) bh.push(uint(block.baseFeePerGas))
  return bh;
}

/** create a Buffer[] from RPC-Response */
export function serializeTransaction(tx: TransactionData) {
  const type = parseInt(tx.type || "0")
  let data = []
  switch (type) {
    case 0:
      data = [
        uint(tx.nonce),
        uint(tx.gasPrice),
        uint(tx.gas || tx.gasLimit),
        tx.to ? address(tx.to) : Buffer.alloc(0),
        uint(tx.value),
        bytes(tx.input || tx.data),
        uint(tx.v),
        uint(tx.r),
        uint(tx.s)
      ]
      break;

    case 1: // EIP 2930
      data = [
        uint(tx.chainId),
        uint(tx.nonce),
        uint(tx.gasPrice),
        uint(tx.gas || tx.gasLimit),
        tx.to ? address(tx.to) : Buffer.alloc(0),
        uint(tx.value),
        bytes(tx.input || tx.data),
        (tx.accessList || []).map(a => [address(a.address), (a.storageKeys || []).map(bytes32)]),
        uint(tx.v),
        uint(tx.r),
        uint(tx.s)
      ]
      break;
    case 2: // EIP 1559
      data = [
        uint(tx.chainId),
        uint(tx.nonce),
        uint(tx.maxPriorityFeePerGas),
        uint(tx.maxFeePerGas),
        uint(tx.gas || tx.gasLimit),
        tx.to ? address(tx.to) : Buffer.alloc(0),
        uint(tx.value),
        bytes(tx.input || tx.data),
        (tx.accessList || []).map(a => [address(a.address), (a.storageKeys || []).map(bytes32)]),
        uint(tx.v),
        uint(tx.r),
        uint(tx.s)
      ]
      break;
  }

  return type ? Buffer.concat([Buffer.from([type]), serialize(data)]) : serialize(data)
}


// encode the account
export const toAccount = (account: AccountData) => [
  uint(account.nonce),
  uint(account.balance),
  bytes32(account.storageHash || ethUtil.KECCAK256_RLP),
  bytes32(account.codeHash || ethUtil.KECCAK256_NULL)
] as Account


/** create a Buffer[] from RPC-Response */
export function serializeReceipt(r: ReceiptData) {
  const type = parseInt(r.type || "0")
  const data = serialize([
    uint(r.status || r.root),
    uint(r.cumulativeGasUsed),
    bytes256(r.logsBloom),
    r.logs.map(l => [
      address(l.address),
      l.topics.map(bytes32),
      bytes(l.data)
    ])
  ].slice(r.status === null && r.root === null ? 1 : 0))
  return type ? Buffer.concat([Buffer.from([type]), data]) : data
}


/**
 * encodes and decodes the blockheader
 */
export class Block {

  /** the raw Buffer fields of the BlockHeader */
  raw: BlockHeader

  /** the transaction-Object (if given) */
  transactions: any[]

  get parentHash() { return this.raw[0] }
  get uncleHash() { return this.raw[1] }
  get coinbase() { return this.raw[2] }
  get stateRoot() { return this.raw[3] }
  get transactionsTrie() { return this.raw[4] }
  get receiptTrie() { return this.raw[5] }
  get bloom() { return this.raw[6] }
  get difficulty() { return this.raw[7] }
  get number() { return this.raw[8] }
  get gasLimit() { return this.raw[9] }
  get gasUsed() { return this.raw[10] }
  get timestamp() { return this.raw[11] }
  get extra() { return this.raw[12] }
  get sealedFields() { return this.raw.slice(13) }

  /** creates a Block-Onject from either the block-data as returned from rpc, a buffer or a hex-string of the encoded blockheader */
  constructor(data: Buffer | string | BlockData) {
    if (Buffer.isBuffer(data))
      this.raw = rlp.decode(data) as any as Buffer[]
    else if (typeof data === 'string')
      this.raw = rlp.decode(Buffer.from(data.replace('0x', ''), 'hex')) as any as Buffer[]
    else if (typeof data === 'object') {
      this.raw = toBlockHeader(data)

      if (data.transactions && typeof data.transactions[0] === 'object')
        this.transactions = data.transactions.map(createTx)
    }

  }

  /** the blockhash as buffer */
  hash(): Buffer {
    return hash(this.raw)
  }

  /** the blockhash as buffer without the seal fields*/
  bareHash(): Buffer {
    return hash(this.raw.slice(0, 13))
  }

  /** the serialized header as buffer */
  serializeHeader(): Buffer {
    return serialize(this.raw)
  }

}

/** creates a Transaction-object from the rpc-transaction-data */
export function createTx(transaction) {
  if (transaction && typeof (transaction) === 'string' && transaction.startsWith('0x'))
    return Tx.fromValuesArray([Buffer.from(transaction.substr(2), 'hex')])

  const fromAddress = toBuffer(transaction.from)
  let txParams = {
    ...transaction,
    nonce: toHex(transaction.nonce) || '0x00',
    gasPrice: toHex(transaction.gasPrice) || '0x00',
    value: toHex(transaction.value || 0),
    gasLimit: toHex(transaction.gasLimit === undefined ? transaction.gas : transaction.gasLimit),
    data: toHex(transaction.gasLimit === undefined ? (transaction.input || transaction.data) : transaction.data),
    input: toHex(transaction.gasLimit === undefined ? (transaction.input || transaction.data) : transaction.data),
    to: transaction.to ? ethUtil.setLengthLeft(ethUtil.toBuffer(transaction.to), 20) : null,
    v: transaction.v < 27 ? transaction.v + 27 : transaction.v,
    from: fromAddress
  }

  if (transaction.hash)
    txParams.hash = ethUtil.toBuffer(transaction.hash)
  
  return new Tx(txParams)
}


/** converts blockdata to a hexstring*/
export function blockToHex(block: any) {
  return toHex(new Block(block).serializeHeader())
}

/** converts a hexstring to a block-object */
export function blockFromHex(hex: string) {
  return new Block(hex)
}



