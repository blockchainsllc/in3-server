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
      .then(_ => util.promisify(a.ac, a.ac.setCode, state, util.toBuffer(a.code = _.result)))
      .then(_ => util.promisify(state, state.put, util.toBuffer(a.address, 20), a.ac.serialize()))
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
            // set the storage data
            return util.promisify(ac.ac, ac.ac.setStorage, state, key, rlp.encode(util.toBuffer(ac.storage[mKey] = _.result, 32)))
              .then(() => util.promisify(state, state.put, util.toBuffer(ac.address, 20), ac.ac.serialize()))
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
