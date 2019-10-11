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

import VM from 'ethereumjs-vm'
import * as Account from 'ethereumjs-account'
import * as Block from 'ethereumjs-block'
import * as Trie from 'merkle-patricia-tree'
import { util, serialize } from 'in3-common'
import { RPCRequest, RPCResponse } from '../../types/types'

// cache structure holding the accounts and storage
export interface CacheAccount {
  code?: string,
  balance?: string,
  storage?: {
    [key: string]: string
  }
  lastUsed?: number
}

const maxCacheSize = 100 // caceh max 100 Accounts
const accountCache: { [adr: string]: CacheAccount } = {}

/**returns a cacheObject for the  */
export function getFromCache(adr: string): CacheAccount {
  let ac = accountCache[adr]
  if (!ac) {
    // before we add a new entry to the cache we check size and remove the entry with the oldes lastUsed.
    const keys = Object.keys(accountCache)
    if (keys.length > maxCacheSize)
      delete accountCache[keys.reduce((p, c) => accountCache[c].lastUsed < accountCache[p].lastUsed ? c : p, keys[0])]
    ac = accountCache[adr] = {}
  }
  ac.lastUsed = Date.now()
  return ac
}


/** executes a transaction-call to a smart contract */
export async function analyseCall(args: {
  to: string
  data: string
  value?: string
  from?: string
}, block: string, getFromServer: (request: Partial<RPCRequest>) => Promise<RPCResponse>): Promise<{
  blocks: string[],
  result: Buffer,
  accounts: {
    [name: string]: {
      code?: boolean | string,
      balance?: string,
      storage?: {
        [key: string]: string
      }
    }
  }
}> {

  // create the result-structre
  const res: {
    blocks: string[],
    result?: Buffer,
    accounts: {
      [name: string]: {
        address: string
        ac: Account,
        proof?: any,
        code?: boolean | string,
        balance?: string,
        storage?: {
          [key: string]: string
        }
      }
    }
  } = { blocks: [], accounts: {} }

  // create new state for a vm
  const vm = new VM({ state: new Trie() })

  // create a transaction-object
  const tx = serialize.createTx({ gas: '0x5b8d80', gasLimit: '0x5b8d80', from: '0x0000000000000000000000000000000000000000', ...args })

  // keeps the error in case a error is discovered
  let err: any = null

  // helper functions
  // gets or creates an account in the result
  function getAccount(address: string) {
    return res.accounts[address] || (res.accounts[address] = { address, storage: {}, ac: new Account() })
  }

  // convert a promise into a callback
  function handle(res: Promise<any>, next) {
    res.then(_ => next(), error => {
      if (!err) err = error
      next(error)
    })
  }

  async function fetchCode(address: string, ): Promise<String> {
    const ac = getFromCache(address)
    if (ac.code) return ac.code
    return getFromServer({ method: 'eth_getCode', params: [address, block] }).then(_ => ac.code = _.result)
  }

  async function fetchBalance(address: string): Promise<string> {
    const ac = getFromCache(address)
    if (ac.balance) return ac.balance
    return getFromServer({ method: 'eth_getBalance', params: [address, block] }).then(_ => ac.balance = _.result)
  }
  async function fetchStorage(address: string, key: string): Promise<string> {
    const ac = getFromCache(address)
    if (!ac.storage) ac.storage = {}
    if (ac.storage[key]) return ac.storage[key]
    return getFromServer({ method: 'eth_getStorageAt', params: [address, key, block] }).then(_ => ac.storage[key] = _.result)
  }

  function setCode(ad: string) {
    const a = getAccount(util.toHex(ad, 20))
    return fetchCode(ad).then(_ => util.promisify(vm.stateManager, vm.stateManager.putContractCode, util.toBuffer(a.address, 20), util.toBuffer(a.code = _ as any)))
  }

  // get the code of the contract
  await setCode(args.to)

  // keep track of each opcode in order to make sure, all storage-values are provided!
  vm.on('step', (ev, next) => {
    switch (ev.opcode.name) {
      case 'BALANCE':
      case 'EXTCODEHASH':
      case 'EXTCODESIZE':
      case 'EXTCODECOPY':
        const acc = getAccount(util.toHex('0x' + ev.stack[ev.stack.length - 1].toString(16), 20))

        if (ev.opcode.name === 'BALANCE' && acc.balance === undefined)
          return handle(fetchBalance(acc.address).then(_ => {
            // set the account data
            acc.ac.balance = acc.balance = _
            return util.promisify(vm.stateManager, vm.stateManager.putAccount, util.toBuffer(a.address, 20), acc.ac)
          }), next)
        else if (ev.opcode.name !== 'BALANCE' && acc.code === undefined)
          return handle(setCode(acc.address), next)
        break

      case 'CALL':
      case 'CALLCODE':
      case 'DELEGATECALL':
      case 'STATICCALL':
        const a = getAccount(util.toHex('0x' + ev.stack[ev.stack.length - 2].toString(16), 20))
        if (a.code === undefined)
          return handle(setCode(a.address), next)
        break

      case 'SLOAD':
        const ac = getAccount(util.toHex(ev.address, 20))
        const key = serialize.bytes32(ev.stack[ev.stack.length - 1])
        const mKey = util.toMinHex('0x' + key.toString('hex'))

        if (ac.storage[mKey] === undefined)
          return handle(fetchStorage(ac.address, '0x' + key.toString('hex')).then(_ => {
            return util.promisify(ev.stateManager, ev.stateManager.putContractStorage, util.toBuffer(ac.address, 20), key, util.toBuffer(ac.storage[mKey] = _, 32))
          }), next)
        break

      default:
        return next()
    }
    return next()
  })

  // run the tx
  const result = await vm.runTx({ tx, block: new Block([block, [], []]) })

  if (err) throw err
  res.result = result.execResult.returnValue
  return res as any
}

