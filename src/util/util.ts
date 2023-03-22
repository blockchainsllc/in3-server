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

// this is eded in order to run in browsers
const Buffer: any = require('buffer').Buffer

import BN from 'bn.js'
import { Block, hash } from '../modules/eth/serialize'
import { rlp, toChecksumAddress, privateToAddress } from 'ethereumjs-util'
import { publicToAddress, bufferToHex } from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak'
import * as secp256k1 from 'secp256k1'

const fixLength = (hex: string) => hex.length % 2 ? '0' + hex : hex

/**
 * 
 * simple promisy-function
 */
export function promisify(self, fn, ...args: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    fn.apply(self, [...args, (err, res) => {
      if (err)
        reject(err)
      else
        resolve(res)
    }])
  })
}

export function toUtf8(val: any): string {
  if (!val) return val
  if (typeof val === 'string')
    return val.startsWith('0x') ? Buffer.from(val.substr(2), 'hex').toString('utf8') : val
  return val.toString('utf8')
}

/**
 * convert to BigNumber
 */
export function toBN(val: any) {
  if (BN.isBN(val)) return val
  if (val && val._isBigNumber) val = val.toHexString();
  if (typeof val === 'number') return new BN(Math.round(val).toString())
  if (Buffer.isBuffer(val)) return new BN(val)
  const hexVal = toHex(val).substr(2)
  return new BN(hexVal, 16)
}

/** 
 * converts any value as hex-string 
 */
export function toHex(val: any, bytes?: number): string {
  if (val === undefined) return undefined
  let hex: string
  if (typeof val === 'string'){
    hex = val.startsWith('0x') ? val.substr(2) : (parseInt(val[0]) ? new BN(val).toString(16) : Buffer.from(val, 'utf8').toString('hex'))
  }
  else if (typeof val === 'number')
    hex = val.toString(16)
  else if (BN.isBN(val))
    hex = val.toString(16)
  else if (val && val._isBigNumber)
    hex = val.toHexString();
  else
    hex = bufferToHex(val).substr(2)
  if (bytes)
    hex = padStart(hex, bytes * 2, '0') as string  // workarounf for ts-error in older js
  if (hex.length % 2)
    hex = '0' + hex
  return '0x' + hex.toLowerCase()
}

/**
 * converts to a js-number
 */
export function toNumber(val: any): number {
  switch (typeof val) {
    case 'number':
      return val
    case 'bigint':
      return Number(val as bigint) // a bit dangerous but should be handled by the callee
    case 'string':
      return parseInt(val)
    default:
      if (Buffer.isBuffer(val))
        return val.length == 0 ? 0 : parseInt(toMinHex(val))
      else if (BN.isBN(val))
        return val.bitLength() > 53 ? toNumber(val.toArrayLike(Buffer)) : val.toNumber()
      else if (val && val._isBigNumber)
        try {
          return val.toNumber()
        }
        catch (ex) {
          return toNumber(val.toHexString())
        }
      else if (val === undefined || val === null)
        return 0
      throw new Error('can not convert a ' + (typeof val) + ' to number')
  }
}

/** 
 * converts any value as Buffer
 *  if len === 0 it will return an empty Buffer if the value is 0 or '0x00', since this is the way rlpencode works wit 0-values.
 */
export function toBuffer(val, len = -1) {
  if (val && val._isBigNumber) val = val.toHexString()
  if (typeof val == 'string')
    val = val.startsWith('0x')
      ? Buffer.from((val.length % 2 ? '0' : '') + val.substr(2), 'hex')
      : val.length && (parseInt(val) || val == '0')
        ? new BN(val).toArrayLike(Buffer)
        : Buffer.from(val, 'utf8')
  else if (typeof val == 'number')
    val = val === 0 && len === 0 ? Buffer.allocUnsafe(0) : Buffer.from(fixLength(val.toString(16)), 'hex')
  else if (BN.isBN(val))
    val = val.toArrayLike(Buffer)

  if (!val) val = Buffer.allocUnsafe(0)

  // remove leading zeros
  while (len == 0 && val[0] === 0) val = val.slice(1)

  // since rlp encodes an empty array for a 0 -value we create one if the required len===0
  if (len == 0 && val.length == 1 && val[0] === 0)
    return Buffer.allocUnsafe(0)



  // if we have a defined length, we should padLeft 00 or cut the left content to ensure length
  if (len > 0 && Buffer.isBuffer(val) && val.length !== len)
    return val.length < len
      ? Buffer.concat([Buffer.alloc(len - val.length), val])
      : val.slice(val.length - len)

  return val as Buffer

}

/**
 * removes all leading 0 in a hex-string
 */
export function toSimpleHex(val: string) {
  let hex = val.replace('0x', '')
  while (hex.startsWith('00') && hex.length > 2)
    hex = hex.substr(2)
  return '0x' + hex

}

/**
 * returns a address from a private key 
 */
export function getAddress(pk: string) {
  const key = toBuffer(pk)
  return toChecksumAddress(toHex(privateToAddress(key)))
}

/** removes all leading 0 in the hexstring */
export function toMinHex(key: string | Buffer | number) {
  if (typeof key === 'number')
    key = toHex(key)

  if (typeof key === 'string') {
    key = key.trim()

    if (key.length < 3 || key[0] != '0' || key[1] != 'x')
      throw new Error("Only Hex format is supported. Given value " + key + " is not valid Hex ")

    for (let i = 2; i < key.length; i++) {
      if (key[i] !== '0')
        return '0x' + key.substr(i)
    }
  }
  else if (Buffer.isBuffer(key)) {
    const hex = key.toString('hex')
    for (let i = 0; i < hex.length; i++) {
      if (hex[i] !== '0')
        return '0x' + hex.substr(i)
    }
  }
  return '0x0'
}

/** padStart for legacy */
export function padStart(val: string, minLength: number, fill = ' ') {
  while (val.length < minLength)
    val = fill + val
  return val
}

/** padEnd for legacy */
export function padEnd(val: string, minLength: number, fill = ' ') {
  while (val.length < minLength)
    val = val + fill
  return val
}


export function createRandomIndexes(len: number, limit: number, seed: Buffer, result: number[] = []) {
  let step = seed.readUIntBE(0, 6) // first 6 bytes
  let pos = seed.readUIntBE(6, 6) % len// next 6 bytes
  while (result.length < limit) {
    if (result.indexOf(pos) >= 0) {
      seed = keccak256(seed).buffer as Buffer
      step = seed.readUIntBE(0, 6)
    } else
      result.push(pos)
    pos = (pos + step) % len
  }
  return result
}

export function getSigner(data: Block): Buffer {
  const signature: Buffer = data.sealedFields[1];
  const message = data.sealedFields.length === 3 ? hash(Buffer.concat([data.bareHash(), rlp.encode(data.sealedFields[2])])) : data.bareHash();
  return publicToAddress((secp256k1 as any).recover(message, signature.slice(0, 64), signature[64]), true);
}

export const aliases = { ewc: '0xf6', tobalaba: '0x44d', main: '0x1', ipfs: '0x7d0', mainnet: '0x1', goerli: '0x5' }
