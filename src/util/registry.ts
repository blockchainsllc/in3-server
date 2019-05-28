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

import * as tx from './tx'
import { toChecksumAddress } from 'ethereumjs-util'
import { Transport, util } from 'in3'
import { readFileSync } from 'fs'
import { padStart } from 'in3/js/src/util/util';
import { padEnd } from 'in3/js/src/util/util';
const toHex = util.toHex

const bin = JSON.parse(readFileSync('./contracts/contracts.json', 'utf8'))
try {
  const binTest = JSON.parse(readFileSync('./test/contracts/contracts.json', 'utf8'))
  Object.assign(bin.contracts, binTest.contracts)
} catch (x) {
  // it's ok, if the test contracts are missing
}

export function getABI(name: string) {
  return JSON.parse(bin.contracts[Object.keys(bin.contracts).find(_ => _.indexOf(name) >= 0)].abi)
}

export function deployContract(name: string, pk: string, url = 'http://localhost:8545', transport?: Transport) {
  return tx.deployContract(url, '0x' + bin.contracts[Object.keys(bin.contracts).find(_ => _.indexOf(name) >= 0)].bin, {
    privateKey: pk,
    gas: 3000000,
    confirm: true
  }, transport).then(_ => toChecksumAddress(_.contractAddress) as string)

}

export function deployChainRegistry(pk: string, url = 'http://localhost:8545', transport?: Transport) {
  return tx.deployContract(url, '0x' + bin.contracts[Object.keys(bin.contracts).find(_ => _.indexOf('ChainRegistry') >= 0)].bin, {
    privateKey: pk,
    gas: 3000000,
    confirm: true
  }, transport).then(_ => toChecksumAddress(_.contractAddress) as string)

}

export async function deployServerRegistry(pk: string, url = 'http://localhost:8545', transport?: Transport) {

  const blockHashAddress = (await deployBlockhashRegistry(pk, url, transport)).substr(2)

  return tx.deployContract(url, '0x' + bin.contracts[Object.keys(bin.contracts).find(_ => _.indexOf('ServerRegistry') >= 0)].bin + padStart(blockHashAddress, 64, "0"), {
    privateKey: pk,
    gas: 5000000,
    confirm: true
  }, transport).then(_ => toChecksumAddress(_.contractAddress) as string)

}

export function deployBlockhashRegistry(pk: string, url = 'http://localhost:8545', transport?: Transport) {
  return tx.deployContract(url, '0x' + bin.contracts[Object.keys(bin.contracts).find(_ => _.indexOf('BlockhashRegistry') >= 0)].bin, {
    privateKey: pk,
    gas: 3000000,
    confirm: true
  }, transport).then(_ => toChecksumAddress(_.contractAddress) as string)
}

export async function registerServers(pk: string, registry: string, data: {
  url: string,
  pk: string
  props: string
  deposit: number
  timeout: number
}[], chainId: string, chainRegistry?: string, url = 'http://localhost:8545', transport?: Transport, registerChain = true) {
  if (!registry)
    registry = await deployServerRegistry(pk, url, transport)

  for (const c of data)
    await tx.callContract(url, registry, 'registerServer(string,uint,uint64)', [
      c.url,
      toHex(c.props, 32),
      c.timeout
    ], {
        privateKey: c.pk,
        gas: 3000000,
        confirm: true,
        value: c.deposit
      }, transport)

  if (registerChain)
    chainRegistry = await registerChains(pk, chainRegistry, [{
      chainId,
      bootNodes: data.map(c => util.getAddress(c.pk) + ':' + c.url),
      meta: 'dummy',
      registryContract: registry,
      contractChain: chainId
    }], url, transport)

  return {
    chainRegistry,
    chainId,
    registry
  }


}

export async function registerChains(pk: string, chainRegistry: string, data: {
  chainId: string,
  bootNodes: string[],
  meta: string,
  registryContract: string,
  contractChain: string
}[], url = 'http://localhost:8545', transport?: Transport) {
  if (!chainRegistry)
    chainRegistry = await deployChainRegistry(pk, url, transport)

  for (const c of data)
    await tx.callContract(url, chainRegistry, 'registerChain(bytes32,string,string,address,bytes32)', [
      toHex(c.chainId, 32),
      c.bootNodes.join(','),
      c.meta,
      c.registryContract,
      toHex(c.contractChain, 32)
    ], {
        privateKey: pk,
        gas: 3000000,
        confirm: true,
        value: 0
      }, transport)



  return chainRegistry
}