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


import chai from 'chai'
import 'mocha'
import * as util from '../../src/util/util'
import { toHex } from '../../src/util/util'
import { registerNodes, deployContract } from '../../src/util/registry'
import { TestTransport, getTestClient } from '../utils/transport'
import Watcher from '../../src/chains/watch'
import * as tx from '../../src/util/tx'
import EthHandler from '../../src/modules/eth/EthHandler'
import { resetSupport} from '../../src/modules/eth/proof'
import _ from 'lodash'

const toNumber = util.toNumber
const assert = chai.assert

describe('Features', () => {

  beforeEach(resetSupport)

  // This test doesnt make any more sense because the update from the nodelist does not dispatch a new request, it uses the one it has. In case the nodelist is returned by config, that can be tested instead
  // it('check auto update nodelist', async () => {
  //   let chaiStatic = chai as any
  //   chaiStatic.use(spies)

  //   // create a new key  
  //   const pk = await new TestTransport().createAccount()

  //   const test = await TestTransport.createWithRegisteredNodes(3)

  //   let lastChangeBlock = toNumber(await test.getFromServer('eth_blockNumber'))
  //   let client = await test.createClient({ requestCount: 1 })

  //   // get the current blocknumber directly from parity without asking the in3-server
  //   let currentBlock = toNumber(await test.getFromServer('eth_blockNumber'))

  //   // now we send a request through the client. 
  //   let block = await client.in3.sendRPC('eth_blockNumber', [])

  //   // This will now get an updated blocknumber with the current block
  //   chaiStatic.assert.equal(block, currentBlock)

  //   client = await test.createClient({ requestCount: 1, autoUpdateList: true, debug: true })
  //   // Overrides the current transport on the client in order to be able to assert about the requests
  //   let transportHandle = client.in3.transport
  //   let spy = chaiStatic.spy.on(client.in3, 'transport', async (url: string, data: string, timeout?: number) => {
  //     return await transportHandle(url, data, timeout)
  //   })

  //   // now we register another server
  //   await registerNodes(pk, test.registryContract, [{
  //     url: 'http://avalid.url/#4',
  //     pk,
  //     props: '0xffff',
  //     deposit: util.toBN('10000000000000000'),
  //     timeout: 7200,
  //   }], test.chainId, test.url)
  //   lastChangeBlock = await test.getFromServer('eth_blockNumber')
    
  //   _.values(test.handlers).forEach(handler => {
  //     handler.getHandler().watcher.update()
  //   })

  //   client.util.cacheClear()

  //   // now we send a request and automaticly trigger another auto-update
  //   await client.eth.getBlock(currentBlock)

  //   // We expect to be called once for eth_blockNumber and one more to update the nodelist. Unfortunately, right now, we cant assert substrings on data which would make for a more robust test.
  //   chaiStatic.expect(spy).to.have.been.called.at.least(2)
  // })


  it('updateLatestBlock', async () => {
    const test = new TestTransport()
    const client = await test.createClient({ requestCount: 1 })
    const pk = await test.createAccount()
    const contract = await deployContract('TestContract', pk, getTestClient())

    // call with latest block and expect 1 because the counter was incremented
    assert.equal(
      await client.in3.sendRPC('eth_getStorageAt', [contract, toHex('0x00', 32), 'latest']),
      0)

    // increment the counter only on adr1
    await tx.callContract(test.url, contract, 'increase()', [], { confirm: true, privateKey: pk, gas: 3000000, value: 0 })

    // call with latest block and expect 1 because the counter was incremented
    assert.equal(
      await client.in3.sendRPC('eth_getStorageAt', [contract, toHex('0x00', 32), 'latest']),
      1)
  })

  it('check nodelist finality', async () => {
    /**
     * First prepare test environment
     */

    //create test transport
    const test = await TestTransport.createWithRegisteredNodes(2)
    await test.getHandler(0).updateNodeList(undefined)

    //test accounts
    const pk1 = await test.createAccount('0x01')
    const pk2 = await test.createAccount('0x02')
    const pk = await test.createAccount('0x03')

    const watcher: Watcher = test.handlers['http://avalid.url/#1'].getHandler().watcher
    await watcher.update()
    assert.equal((watcher.handler as EthHandler).nodeList.nodes.length, 2)


    //sleep function
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    //15 block distance before next node registration
    let lastChangeBlock = toNumber(await test.getFromServer('eth_blockNumber'))
    let currentBlock = lastChangeBlock
    while(currentBlock - lastChangeBlock <= 15){
      // test Tx in new blocks
      await tx.sendTransaction(test.url, { privateKey: pk1, gas: 22000,to: pk2.address,data: '', value: 10,confirm: true})
      sleep(200)
      currentBlock = toNumber(await test.getFromServer('eth_blockNumber')) 
      assert.isNull(await watcher.update())
    }

    /**
     * Test with block height and node list finality
     */
    //now set block height to 10
    test.handlers['http://avalid.url/#1'].getHandler().config.minBlockHeight = 10

    //register a node
    await registerNodes(pk, test.registryContract, [{
      url: 'http://avalid.url/#13',
      pk,
      props: '0xfff',
      deposit: util.toBN('10000000000000000'),
      timeout: 7200,
    }], test.chainId, test.url)

    lastChangeBlock = toNumber(await test.getFromServer('eth_blockNumber'))
    //now wait until 10 blocks are mined
    currentBlock = lastChangeBlock

    while(currentBlock - lastChangeBlock < 9){
      // test Tx in new blocks
      await tx.sendTransaction(test.url, { privateKey: pk1, gas: 22000,to: pk2.address,data: '', value: 10,confirm: true})
      sleep(200)

      currentBlock = toNumber(await test.getFromServer('eth_blockNumber'))
      //no new node should be detected as we have not reached block height
      assert.equal((watcher.handler as EthHandler).nodeList.nodes.length, 2)
      //the watcher should not detect new node as it will after 10 blocks so it should return null
      assert.isNull(await watcher.update())
    }

    let logs = undefined
    while(!logs){
      // test Tx in new blocks
      await tx.sendTransaction(test.url, { privateKey: pk1, gas: 22000,to: pk2.address,data: '', value: 10,confirm: true})
      sleep(200)
      logs = await watcher.update()
      currentBlock = toNumber(await test.getFromServer('eth_blockNumber'))
    }

    assert.equal(logs.length, 1)
    assert.equal(logs[0].event, 'LogNodeRegistered')
    assert.equal(logs[0].url, 'http://avalid.url/#13')
    assert.equal(logs[0].props, 0xfff)
    assert.equal(logs[0].signer, pk.address)

    //now we should have 3 nodes
    assert.equal((watcher.handler as EthHandler).nodeList.nodes.length, 3)

    assert.equal((watcher.handler as EthHandler).nodeList.lastBlockNumber , lastChangeBlock)
    assert.equal(currentBlock-lastChangeBlock,10)

  }).timeout(5000)
})
