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


import { toChecksumAddress } from '@ethereumjs/util'
import { readFileSync } from 'fs'
import { PK } from '../chains/signatures'
import { AppContext } from '../types/types'
import { Transport } from './transport'
import * as tx from './tx'
import { padStart, toHex } from './util'

const bin = require('in3-contracts/contracts/contracts.json')

const in3ContractBin = JSON.parse(readFileSync('node_modules/in3-contracts/contracts/contracts.json', 'utf8'))
try {
  const binTest = JSON.parse(readFileSync('./test/contracts/contracts.json', 'utf8'))
  Object.assign(bin.contracts, binTest.contracts)
} catch (x) {
  // it's ok, if the test contracts are missing
}

export function getABI(name: string) {
  return JSON.parse(in3ContractBin.contracts[Object.keys(in3ContractBin.contracts).find(_ => _.indexOf(name) >= 0)].abi)
}

export function deployContract(name: string, pk: PK, url = 'http://localhost:8545', transport?: Transport) {
  return tx.deployContract(url, '0x' + bin.contracts[Object.keys(bin.contracts).find(_ => _.indexOf(name) >= 0)].bin, {
    privateKey: pk,
    gas: 3000000,
    confirm: true
  }, transport).then(_ => toChecksumAddress(_.contractAddress) as string)

}


export async function deployNodeRegistry(pk: PK, url = 'http://localhost:8545', transport?: Transport, context?: AppContext) {
  const blockHashAddress = await deployBlockhashRegistry(pk, url, transport, context)
  const erc20 = await deployERC20(pk, url, transport, context)
  const regData = await deployRegistryData(pk, url, transport, context)
  const registry = await tx.deployContract(url,
    '0x' + in3ContractBin.contracts[Object.keys(in3ContractBin.contracts).find(_ => _.indexOf('/contracts/NodeRegistryLogic.sol:NodeRegistryLogic') >= 0)].bin
    + toHex(blockHashAddress, 32).substr(2)
    + toHex(regData, 32).substr(2)
    + toHex('0x2386f26fc10000', 32).substr(2)
    , {
      privateKey: pk,
      gas: 8000000,
      confirm: true
    }, transport)
    .then(_ => toChecksumAddress(_.contractAddress) as string)

  await tx.callContract(url, regData, 'adminSetSupportedToken(address)', [erc20], { privateKey: pk, gas: 500000, confirm: true, value: 0 }, transport)
  await tx.callContract(url, regData, 'adminSetLogic(address)', [registry], { privateKey: pk, gas: 500000, confirm: true, value: 0 }, transport)
  return registry
}

function deployBlockhashRegistry(pk: PK, url = 'http://localhost:8545', transport?: Transport, context?: AppContext) {
  return tx.deployContract(url, '0x' + in3ContractBin.contracts[Object.keys(in3ContractBin.contracts).find(_ => _.indexOf('/contracts/BlockhashRegistry.sol:BlockhashRegistry') >= 0)].bin, {
    privateKey: pk,
    gas: 8000000,
    confirm: true
  }, transport, context, 300000).then(_ => toChecksumAddress(_.contractAddress) as string)
}

function deployERC20(pk: PK, url = 'http://localhost:8545', transport?: Transport, context?: AppContext) {
  return tx.deployContract(url, '0x' + in3ContractBin.contracts[Object.keys(in3ContractBin.contracts).find(_ => _.indexOf('/contracts/ERC20Wrapper.sol:ERC20Wrapper') >= 0)].bin, {
    privateKey: pk,
    gas: 8000000,
    confirm: true
  }, transport, context, 300000).then(_ => toChecksumAddress(_.contractAddress) as string)
}

function deployRegistryData(pk: PK, url = 'http://localhost:8545', transport?: Transport, context?: AppContext) {
  return tx.deployContract(url, '0x' + in3ContractBin.contracts[Object.keys(in3ContractBin.contracts).find(_ => _.indexOf('/contracts/NodeRegistryData.sol:NodeRegistryData') >= 0)].bin, {
    privateKey: pk,
    gas: 8000000,
    confirm: true
  }, transport, context, 300000).then(_ => toChecksumAddress(_.contractAddress) as string)
}

export async function registerNodes(pk: PK, registry: string, data: {
  url: string,
  pk: PK
  props: string
  deposit: any
  timeout: number
  weight?: number
}[], chainId: string, url = 'http://localhost:8545', transport?: Transport, _registerChain = true, context?: AppContext) {
  if (!registry)
    registry = await deployNodeRegistry(pk, url, transport, context)

  const regData = await tx.callContract(url, registry, "nodeRegistryData():(address)", []).then(_ => _[0])
  const erc20 = await tx.callContract(url, regData, "supportedToken():(address)", []).then(_ => _[0])

  for (const c of data) {
    // first create tokens
    await tx.callContract(url, erc20, 'mint()', [], {
      privateKey: c.pk,
      gas: 3000000,
      confirm: true,
      value: c.deposit
    }, transport)

    // and aprove them...
    await tx.callContract(url, erc20, 'approve(address,uint256)', [registry, c.deposit], {
      privateKey: c.pk,
      gas: 3000000,
      confirm: true,
      value: 0
    }, transport)


    // now register
    await tx.callContract(url, registry, 'registerNode(string,uint192,uint64,uint256)', [
      c.url,
      toHex(c.props, 24),
      c.weight ? c.weight : 0,
      c.deposit
    ], {
      privateKey: c.pk,
      gas: 3000000,
      confirm: true,
      value: 0
    }, transport)
  }

  const regId = toHex((await tx.callContract(url, regData, "registryId():(bytes32)", []))[0])

  return {
    chainId,
    registry,
    regData,
    regId
  }


}

export function deployWhiteList(pk: PK, url = 'http://localhost:8545', whiteListAddrs: string, transport?: Transport) {
  return tx.deployContract(url,
    '0x' + bin.contracts[Object.keys(bin.contracts).
      find(_ => _.indexOf('/contracts/IN3WhiteList.sol:IN3WhiteList') >= 0)].bin + padStart(whiteListAddrs, 64, "0"),
    // '0x' + bin.contracts[Object.keys(bin.contracts).find(_ => _.indexOf(name) >= 0)].bin, 
    {
      privateKey: pk,
      gas: 4000000,
      confirm: true
    }, transport).then(_ => toChecksumAddress(_.contractAddress) as string)
}