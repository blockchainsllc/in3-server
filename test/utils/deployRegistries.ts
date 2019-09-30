/*******************************************************************************
 * This file is part of the Incubed project.
 * Sources: https://github.com/slockit/in3-c
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



