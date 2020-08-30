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
import * as util  from '../../src/util/util'
import Client from 'in3'
import { registerNodes } from '../../src/util/registry';
import { LoggingAxiosTransport, getTestClient, TestTransport } from '../utils/transport'
import { resetSupport} from '../../src/modules/eth/proof'

describe('Deploying Contracts', () => {

  beforeEach(resetSupport)
  it('deploy and register servers', async () => {

    const test = await TestTransport.createWithRegisteredNodes(1)

    const pk = await test.createAccount('0xb903239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238', util.toBN('500000000000000000'))
    const pk2 = await test.createAccount('0xaaaa239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238', util.toBN('500000000000000000'))

    // const pk = '0xb903239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238'
    //  const pk2 = '0xaaaa239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238'

    //  deploy cainRegkstry and ServerRegistry for 0x99-chainId with 2 Nodes
    const registers = await registerNodes(pk, null, [{
      url: '#1',
      pk,
      props: '0xFF',
      deposit: util.toBN('10000000000000000'),
      timeout: 3600
    },
    {
      url: '#2',
      pk: pk2,
      props: '0xFF',
      deposit: util.toBN('10000000000000000'),
      timeout: 3600
    }], '0x99', getTestClient(), new LoggingAxiosTransport())


    // create a client which reads the chainData from the contract
    const client = new Client({
      chainId: '0x99',
      mainChain: '0x99',
      servers: {
        '0x99': {
          contract: registers.registry,
          contractChain: '0x99',
          // we give him a bootnode which simply reads directly from parity
          nodeList: [{
            address: pk.address,
            url: getTestClient(),
            chainIds: ['0x99'],
            deposit: util.toBN('10000000000000000') as any
          }]
        }
      }
    })

    assert.lengthOf(registers.registry, 42, 'No serverRegistry')
    assert.equal(registers.chainId, '0x99')



  })
})

