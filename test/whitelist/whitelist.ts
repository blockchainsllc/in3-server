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



import { assert } from 'chai'
import 'mocha'
import { util} from 'in3-common'
import * as tx from '../../src/util/tx'
import { TestTransport, getTestClient } from '../utils/transport'
import {  deployWhiteList } from '../../src/util/registry'
import { RPC } from '../../src/server/rpc'

describe('WhiteList Tests', () => {

  it('Registration and getting list', async () => {

    const whitelistedNode = "0x45d45e6Ff99E6c34A235d263965910298985fcFe"

    let test = new TestTransport(1) 

    // create a account with 500 wei
    const acct = await test.createAccount(undefined, 500)
    //const addr = getAddress(acct)

    // check deployed code
    const adr = await deployWhiteList(acct, getTestClient(), "0")

    const receipt = await tx.callContract(getTestClient(), adr, 'whiteListNode(address)', [whitelistedNode], {
      confirm: true,
      privateKey: acct,
      gas: 3000000,
      value: 0
    })

    const pk = await test.createAccount(null, util.toBN('100000000000000000'))
    const rpc = new RPC({
      port: 1,
      chains: {
        [test.chainId]: {
          watchInterval: -1,
          minBlockHeight: 0,
          autoRegistry: {
            url: 'dummy',
            deposit: util.toBN('10000000000000000') as any,
            depositUnit: 'wei',
            capabilities: {
              proof: true,
              multiChain: true
            },
          },
          privateKey: pk,
          rpcUrl: test.url,
          registry: test.nodeList.contract
        }
      }
    }, test, test.nodeList)

    await rpc.init()

    const wl = await rpc.getHandler().getWhiteList(true,adr)
    assert.equal(whitelistedNode.toLowerCase(),"0x"+wl.nodes[0].toLowerCase())

  }).timeout(6000000)

})
