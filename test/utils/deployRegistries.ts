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

import * as reg from '../../src/util/registry';
import { LoggingAxiosTransport } from '../utils/transport'

const ownerPK = '0xb858a0f49ce12df65031ba0eb0b353abc74f93f8ccd43df9682fd2e2293a4db3'
const chainRegistry = '0x013b82355a066A31427df3140C5326cdE9c64e3A'
const kovanClient = 'https://rpc-kovan.slock.it'
const kovanRegistry = '0xb9a2bB17675206F3233bF426eB4b64900F63cd28'

//deployAll().then(console.log, err => console.log('ERROR:' + err))


export async function deployAll() {
  //  const chainRegistry = await deployChainRegistry(ownerPK, kovanClient)
  console.log('Chain Registry : ' + chainRegistry)

  const r = await reg.registerChains(ownerPK, chainRegistry, [{
    chainId: '0x000000000000000000000000000000000000000000000000000000000000002a',
    bootNodes: ['0xa1bB1860c4aBF6F050F36cf672679d940c916a18:https://in3-kovan1.slock.it'],
    meta: 'about:blank',
    registryContract: kovanRegistry,
    contractChain: '0x000000000000000000000000000000000000000000000000000000000000002a'
  }], kovanClient)


  console.log('res:', r)

  if (r || !r) return



  // register kovan-servers
  const registers = await reg.registerNodes(ownerPK, kovanRegistry, [{
    url: 'https://in3-kovan1.slock.it',
    pk: ownerPK,
    props: '0xFFFF',
    deposit: 0,
    timeout: 3600,
  }], '0x000000000000000000000000000000000000000000000000000000000000002a', chainRegistry, kovanClient, new LoggingAxiosTransport())

  console.log('kovan-registry ' + JSON.stringify(registers, null, 2))
}



