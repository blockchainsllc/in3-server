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
import { rlp } from 'ethereumjs-util'
import { util, serialize } from 'in3-common'
import { RPCRequest, RPCResponse } from '../../types/types'

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
  const state = new Trie()
  const vm = new VM({ state })

  // create a transaction-object
  const tx = serialize.createTx({ gas: '0x5b8d80', gasLimit: '0x5b8d80', from: '0x0000000000000000000000000000000000000000', ...args })

  function getAccount(address: string) {
    if (!(res.accounts[address]))
      res.accounts[address] = { address, storage: {}, ac: new Account() }
    return res.accounts[address]
  }

  let err: any = null

  function handle(res: Promise<any>, next) {
    res.then(_ => next(), error => {
      if (!err) err = error
      next(error)
    })
  }

  function setCode(ad: string) {
    const a = getAccount(util.toHex(ad, 20))
    return getFromServer({ method: 'eth_getCode', params: [a.address, block] })
      .then(_ => util.promisify(vm.stateManager, vm.stateManager.putContractCode, util.toBuffer(a.address, 20), util.toBuffer(a.code = _.result)))
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
          return handle(getFromServer({ method: 'eth_getBalance', params: [acc.address, block] }).then(_ => {
            // set the account data
            acc.ac.balance = acc.balance = _.result
            return util.promisify(state, state.put, util.toBuffer(acc.address, 20), acc.ac.serialize())
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
          return handle(getFromServer({ method: 'eth_getStorageAt', params: [ac.address, '0x' + key.toString('hex'), block] }).then(_ => {
            return util.promisify(ev.stateManager, ev.stateManager.putContractStorage, util.toBuffer(ac.address, 20), key, util.toBuffer(ac.storage[mKey] = _.result, 32))

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
