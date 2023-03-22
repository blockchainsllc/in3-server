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
import { keccak } from 'ethereumjs-util'
import 'mocha'
import { PK, signatureCaches } from '../../src/chains/signatures'
import { resetSupport } from '../../src/modules/eth/proof'
import { BlockData } from '../../src/modules/eth/serialize'
import { RPCRequest, RPCResponse, Signature } from '../../src/types/types'
import { toNumber, toHex, toBuffer, toMinHex } from '../../src/util/util'
import { TestTransport } from '../utils/transport'
import { callContract } from '../../src/util/tx'



const sign = (b: BlockData, registryId: string, pk: PK, blockHash?: string) => {
  const toHash = toHex(blockHash || b.hash).substr(2).padStart(64, '0') + toHex(b.number).substr(2).padStart(64, '0') + toHex(registryId).substr(2).padStart(64, '0')
  const msgHash = keccak(toBuffer(`0x${toHash}`))
  const s = pk.sign(msgHash)
  return {
    ...s,
    block: toNumber(b.number),
    blockHash: blockHash || b.hash,
    address: pk.address,
    msgHash: toHex(msgHash, 32),
    r: toHex(s.r),
    s: toHex(s.s),
    v: Number(s.v)
  } as Signature
}

describe('Convict', () => {

  beforeEach(resetSupport)

  it('verify and convict (block within 256 blocks)', async () => {
    let nodeCount = 3
    const test = await TestTransport.createWithRegisteredNodes(nodeCount)
    let watchers = []

    for (let i = 0; i < 3; i++) 
      watchers.push(test.getHandler(i).watcher)

    const pk1 = test.getHandlerPK(0)

    const latest = await test.getFromServer('eth_blockNumber') as BlockData
    let latestNo = toNumber(latest)
    const block = await test.getFromServer('eth_getBlockByNumber', toHex(latestNo), false) as BlockData
    const client = await test.createClient({ signatureCount: 1, requestCount: 1, replaceLatestBlock: 0, finality: 0 })

    // this is a correct signature and should not fail.
    await client.eth.getBalance(pk1.address, toNumber(block.number))

    test.injectRandom([0.01, 0.9])
    test.injectRandom([0.02, 0.8])

    let manipulated = false
    test.injectResponse({ method: 'in3_sign' }, (_req: RPCRequest, re: RPCResponse, url: string) => {
      const index = parseInt(url.substr(-1)) - 1
      // we change it to a wrong signature
      if (!manipulated) {
        re.result = [sign(block, test.registryId, test.getHandlerPK(index), toHex(pk1.address, 32))]
        manipulated = true
      }
      return re
    })

    assert.equal(await test.getNodeCountFromContract(), 3)

    // we create a new client because the old one may have different weights now
    const client2 = await test.createClient({ signatureCount: 1, requestCount: 1, replaceLatestBlock: 0, finality: 0 })
    client.util.cacheClear()

    // just read all events
    for (let watcher of watchers) {
      await watcher.update()
    }

    // this is a correct signature and should not fail.
    await client2.eth.getBalance(pk1.address, toNumber(block.number))

    let events = []
    for (let i = 0; i < 4; i++) {
      await test.createAccount()
      await watchers[1].update()
      events = [...(await watchers[0].update() || []), ...events]
    }
    // fetch the latest block since we may have done a convict in the last block.
    events = [...(await watchers[0].update() || []), ...events]
    //    console.log('event:', JSON.stringify(events, null, 2))

    // we should get a valid response even though server #0 signed a wrong hash and was convicted server #1 gave a correct one.
    assert.equal(await test.getNodeCountFromContract(), 2)

    assert.equal(events.length, 2)
    assert.equal(events.map(_ => _.event).join(), 'LogNodeRemoved,LogNodeConvicted')
  }).timeout(6000000)


  it("should increase the # of blocks to at least 260", async () => {
    const test = await TestTransport.createWithRegisteredNodes(2)

    let currentBlock = await test.getFromServer('eth_getBlockByNumber', "latest", false) as BlockData

    while (toNumber(currentBlock.number) < 260) {
      await test.createAccount(null, '1')
      currentBlock = await test.getFromServer('eth_getBlockByNumber', "latest", false) as BlockData

    }

  }).timeout(600000)

  it('verify and convict (block older then 256 blocks) - not worth it', async () => {
    const test = await TestTransport.createWithRegisteredNodes(3)

    const blockHashRegistry = (await callContract(test.url, test.registryContract, 'blockRegistry():(address)', []))[0]
    await callContract(test.url, test.registryContract, 'blockRegistry():(address)', [], { privateKey: test.getHandlerPK(0), to: test.nodeList.contract, value: 0, confirm: true, gas: 5000000 })

    const txReceipt = (await callContract(test.url, blockHashRegistry, 'snapshot()', [], { privateKey: test.getHandlerPK(1), value: 0, confirm: true, gas: 5000000 }))

    const wrongBlock = txReceipt.blockNumber - 0x104


    const watcher = test.getHandler(0).watcher
    const watcher2 = test.getHandler(1).watcher
    const watcher3 = test.getHandler(1).watcher


    const pk1 = test.getHandlerPK(0)
    const pk2 = test.getHandlerPK(1)

    const block = await test.getFromServer('eth_getBlockByNumber', toMinHex(wrongBlock), false) as BlockData

    assert.equal((toNumber(txReceipt.blockNumber) - toNumber(block.number)), 260)

    const client = await test.createClient(({ signatureCount: 1, requestCount: 1, replaceLatestBlock: 0, finality: 0 }))
    client.util.cacheClear()

    // this is a correct signature and should not fail.
    await client.eth.getBalance(pk1.address, wrongBlock)

    test.injectRandom([0.01, 0.9])
    test.injectRandom([0.02, 0.8])
    signatureCaches.clear()
    let manipulated = false
    test.injectResponse({ method: 'in3_sign' }, (req: RPCRequest, re: RPCResponse, url: string) => {
      const index = parseInt(url.substr(-1)) - 1
      // we change it to a wrong signature
      if (!manipulated) {
        re.result = [sign(block, toHex(test.getHandlerPK(index).address, 32), pk1)]
        manipulated = true
      }
      return re
    })

    assert.equal(await test.getNodeCountFromContract(), 3)

    // we create a new client because the old one may have different weights now
    await test.createClient()
    client.util.cacheClear()

    // just read all events
    await watcher.update()
    await watcher2.update()
    await watcher3.update()


    // this is a correct signature and should not fail.
    await client.eth.getBalance(pk1.address, wrongBlock)

    let events
    let events2
    let events3

    for (let i = 0; i < 40; i++) {
      await test.createAccount()
      events = await watcher.update()
      events2 = await watcher2.update()
      events3 = await watcher3.update()
      assert.equal(events, undefined)
      assert.equal(events2, undefined)
      assert.equal(events3, undefined)
    }

    // we should get a valid response even though server #0 signed a wrong hash and was convicted server #1 gave a correct one.
    assert.equal(await test.getNodeCountFromContract(), 3)
  })

  it('verify and convict (block older then 256 blocks) - worth it', async () => {
    const test = await TestTransport.createWithRegisteredNodes(3)
    const pk1 = test.getHandlerPK(0)
    const client = await test.createClient({ signatureCount: 1, requestCount: 1, replaceLatestBlock: 0, finality: 0 })
    client.util.cacheClear()

    for (let i = 0; i >= 3; i++) {
      await callContract(test.url, test.registryContract, 'updateNode(address,string,uint192,uint64,uint)', [test.getHandlerPK(i).address, `http://avalid.url/#${i+1}`, 0, 0, 0], { privateKey: (test.getHandlerConfig(i) as any)._pk, value: 0, confirm: true, gas: 5000000 })
    }

    const blockHashRegistry = (await callContract(test.url, test.registryContract, 'blockRegistry():(address)', []))[0]

    const txReceipt = (await callContract(test.url, blockHashRegistry, 'snapshot()', [], {
      privateKey: (test.getHandlerConfig(1) as any)._pk, value: 0, confirm: true, gas: 5000000
    }))

    const wrongBlock = txReceipt.blockNumber - 0x104
    const watchers = [test.getHandler(0).watcher, test.getHandler(1).watcher, test.getHandler(2).watcher]

    test.getHandlerPK(1)

    const block = await test.getFromServer('eth_getBlockByNumber', toMinHex(wrongBlock), false) as BlockData

    assert.equal((toNumber(txReceipt.blockNumber) - toNumber(block.number)), 260)


    // this is a correct signature and should not fail.
    await client.eth.getBalance(pk1.address)
    client.util.cacheClear()

    test.injectRandom([0.01, 0.9])
    test.injectRandom([0.02, 0.8])

    let manipulated = false
    test.injectResponse({ method: 'in3_sign' }, (_req: RPCRequest, re: RPCResponse, url: string) => {
      const index = parseInt(url.substr(-1)) - 1
      // we change it to a wrong signature
      if (!manipulated) {
        re.result = [sign(block, test.registryId, test.getHandlerPK(index), toHex(pk1.address, 32))]
        manipulated = true
      }
      return re
    })

    assert.equal(await test.getNodeCountFromContract(), 3)

    // we create a new client because the old one may have different weights now
    const client2 = await test.createClient({ signatureCount: 1, requestCount: 1, replaceLatestBlock: 0, finality: 0 })
    // just read all events
    for (let watcher of watchers) {
      await watcher.update()
    }

    client.util.cacheClear()
    client2.util.cacheClear()
    // this is a correct signature and should not fail.
    await client2.eth.getBalance(pk1.address)

    // we should get a valid response even though server #0 signed a wrong hash and was convicted server #1 gave a correct one.
    await test.createAccount()
    // just read all events
    for (let watcher of watchers) {
      await watcher.update()
    }

    await test.createAccount()

    manipulated = false
    test.injectResponse({ method: 'in3_sign' }, (_req: RPCRequest, re: RPCResponse, url: string) => {
      const index = parseInt(url.substr(-1)) - 1
      // we change it to a wrong signature
      if (!manipulated) {
        re.result = [sign(block, test.registryId, test.getHandlerPK(index), toHex(pk1.address, 32))]
        manipulated = true
      }
      return re
    })


    assert.equal(await test.getNodeCountFromContract(), 3)

    // this is a correct signature and should not fail.
    const client3 = await test.createClient({ signatureCount: 1, requestCount: 1, replaceLatestBlock: 0, finality: 0 })
    client3.util.cacheClear()
    await client3.eth.getBalance(pk1.address, wrongBlock)
    //   let events = await watcher.update()

    //  if (!events) events = await watcher2.update()
    let events = []

    for (let i = 0; i < 26; i++) {
      await test.createAccount()

      await watchers[2].update()
      await watchers[1].update()
      events = [...(await watchers[0].update() || []), ...events]
    }
    await watchers[2].update()
    await watchers[1].update()
    events = [...(await watchers[0].update() || []), ...events]


    //  assert.equal(events.length, 2)
    assert.equal(await test.getNodeCountFromContract(), 2)

    // assert.equal(events.map(_ => _.event).join(), 'LogNodeConvicted,LogNodeRemoved')

  }).timeout(600000000)
})
