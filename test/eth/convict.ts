
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

import { assert } from 'chai'
import 'mocha'
import { util, BlockData, serialize, Signature, RPCRequest, RPCResponse, transport } from 'in3'
import * as tx from '../../src/util/tx'
import * as ethUtil from 'ethereumjs-util'
import { TestTransport, LoggingAxiosTransport } from '../utils/transport'
import Watcher from '../../src/chains/watch'
import { registerServers } from '../../src/util/registry'
import { toBN, toBuffer } from 'in3/js/src/util/util';
import { BigNumber } from 'ethers/utils';
import { sha3 } from 'ethereumjs-util'


const address = serialize.address
const bytes32 = serialize.bytes32
const toNumber = util.toNumber
const toHex = util.toHex

const sign = (b: BlockData, pk: string, blockHash?: string) => {
  const msgHash = ethUtil.sha3(Buffer.concat([bytes32(blockHash || b.hash), bytes32(b.number)]))
  const sig = ethUtil.ecsign(msgHash, bytes32(pk)) as Signature
  sig.block = toNumber(b.number)
  sig.blockHash = blockHash || b.hash
  sig.address = util.getAddress(pk)
  sig.msgHash = toHex(msgHash, 32)
  return sig
}


describe('Convict', () => {



  it('convict on contracts', async () => {

    const test = await TestTransport.createWithRegisteredServers(2)

    const blockHashRegAddress = "0x" + (await tx.callContract(test.url, test.nodeList.contract, 'blockRegistry():(address)', []))[0].toString('hex')

    // creating a snaphsot
    const snapshotreceipt = await tx.callContract(test.url, blockHashRegAddress, 'snapshot()', [], { privateKey: test.getHandlerConfig(1).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 5000000 })

    const blockNumberInSnapshot = toNumber(snapshotreceipt.blockNumber) - 1

    // make sure we have more than 256 blocks in order to test older blocks
    const currentBlock = parseInt(await test.getFromServer('eth_blockNumber'))
    for (let b = 0; b < 300 - currentBlock; b++) {
      await test.createAccount()
    }

    // read current Block
    let block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData
    // create a event-watcher starting with the current block
    const watcher = new Watcher(test.getHandler(0), 0, null, toNumber(block.number))

    // sign the correct blockhash 
    let s = sign(block, test.getHandlerConfig(0).privateKey)

    /*
    // must fail, since we cannot convict with a correct blockhash
    let rc = await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32,uint,uint8,bytes32,bytes32)', [0, s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false)
*/
    let convictSignature: Buffer = sha3(Buffer.concat([bytes32(s.blockHash), address(util.getAddress(test.getHandlerConfig(1).privateKey)), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))

    await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [s.block, convictSignature], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: false                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
    })

    let rc = await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(uint,bytes32,uint,uint8,bytes32,bytes32)', [toNumber(0), s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false)
    assert.isFalse(rc, 'Transaction must fail, because we sent the correct hash')



    // now test if we can send a wrong blockhash, but the block is older than 256 blocks:
    // wrong blockhash signed by first node
    s = sign({ number: 1 } as any, test.getHandlerConfig(0).privateKey, '0x0000000000000000000000000000000000000000000000000000000000001234')

    convictSignature = sha3(Buffer.concat([bytes32(s.blockHash), address(util.getAddress(test.getHandlerConfig(1).privateKey)), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))
    await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [0, convictSignature], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: false                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
    })

    rc = await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(uint,bytes32,uint,uint8,bytes32,bytes32)', [toNumber(0), s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false)
    assert.isFalse(rc, 'Transaction must fail, because the block is too old')


    const serverContract = await test.getServerFromContract(0)
    const unregisterDeposit = serverContract.deposit / 50

    block = await test.getFromServer('eth_getBlockByNumber', toHex(blockNumberInSnapshot), false) as BlockData
    s = sign(block, test.getHandlerConfig(0).privateKey)

    convictSignature = sha3(Buffer.concat([bytes32(s.blockHash), address(util.getAddress(test.getHandlerConfig(1).privateKey)), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))
    await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [s.block, convictSignature], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: false                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
    })

    rc = await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(uint,bytes32,uint,uint8,bytes32,bytes32)', [toNumber(0), s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false)

    assert.isFalse(rc, 'Transaction must fail, because block is correct')

    // wrong blockhash signed by first node
    s = sign({ number: blockNumberInSnapshot } as any, test.getHandlerConfig(0).privateKey, '0x0000000000000000000000000000000000000000000000000000000000001234')

    // the sender to convit will be second node
    const sender = util.getAddress(test.getHandlerConfig(1).privateKey)

    // get the balance
    const balanceSenderBefore = new BigNumber(await test.getFromServer('eth_getBalance', sender, 'latest'))
    const balanceRegistryBefore = new BigNumber(await test.getFromServer('eth_getBalance', test.nodeList.contract, 'latest'))

    const convictSignatureWrong: Buffer = sha3(Buffer.concat([bytes32(s.blockHash), address(util.getAddress(test.getHandlerConfig(1).privateKey)), toBuffer(s.v, 1), bytes32(s.s), bytes32(s.s)]))

    await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [s.block, convictSignatureWrong], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: false                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
    })

    rc = await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(uint,bytes32,uint,uint8,bytes32,bytes32)', [toNumber(0), s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false)

    assert.isFalse(rc, 'Transaction must fail, convict signature is wrong')


    // send the transactions to convict with the wrong hash
    convictSignature = sha3(Buffer.concat([bytes32(s.blockHash), address(util.getAddress(test.getHandlerConfig(1).privateKey)), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))

    let a = await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [s.block, convictSignature], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    })

    let b = await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(uint,bytes32,uint,uint8,bytes32,bytes32)', [toNumber(0), s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    })


    console.log("gas combined")

    console.log((toNumber(a.gasUsed) + toNumber(b.gasUsed)))

    const balanceSenderAfter = new BigNumber(await test.getFromServer('eth_getBalance', sender, 'latest'))
    const balanceRegistryAfter = new BigNumber(await test.getFromServer('eth_getBalance', test.nodeList.contract, 'latest'))

    assert.equal((balanceSenderAfter.sub(balanceSenderBefore)).toString(), new BigNumber(serverContract.deposit / 2).toString())

    assert.equal(balanceRegistryBefore.sub(balanceRegistryAfter).toString(), serverContract.deposit)
    const events = await watcher.update()
    assert.equal(events.length, 2)
    assert.equal(events.map(_ => _.event).join(), 'LogServerConvicted,LogServerRemoved')


  }).timeout(50000)

  it('verify and convict (block within 256 blocks)', async () => {

    const test = await TestTransport.createWithRegisteredServers(2)
    const watcher = test.getHandler(0).watcher

    const serverContract = await test.getServerFromContract(0)
    const unregisterDeposit = serverContract.deposit / 50

    const pk1 = test.getHandlerConfig(0).privateKey
    const pk2 = test.getHandlerConfig(1).privateKey

    const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData
    const client = await test.createClient()

    // this is a correct signature and should not fail.
    const res = await client.sendRPC('eth_getBalance', [util.getAddress(pk1), 'latest'], undefined, {
      keepIn3: true, proof: 'standard', signatureCount: 1, requestCount: 1
    })
    //  await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringServer(uint)', [0], { privateKey: pk2, value: unregisterDeposit, confirm: true, gas: 300000 })

    assert.isDefined(res.in3.proof.signatures[0])
    test.injectRandom([0.01, 0.9])
    test.injectRandom([0.02, 0.8])

    let manipulated = false
    test.injectResponse({ method: 'in3_sign' }, (req: RPCRequest, re: RPCResponse, url: string) => {
      const index = parseInt(url.substr(1)) - 1
      // we change it to a wrong signature
      if (!manipulated) {
        re.result = [sign(block, test.getHandlerConfig(index).privateKey, pk1)]
        manipulated = true
      }
      return re
    })

    assert.equal(await test.getServerCountFromContract(), 2)

    // we create a new client because the old one may have different weights now
    const client2 = await test.createClient()

    // just read all events
    await watcher.update()
    //console.log(await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringServer(uint)', [0], { privateKey: pk2, value: unregisterDeposit, confirm: true, gas: 300000 }))


    // this is a correct signature and should not fail.
    const res2 = await client2.sendRPC('eth_getBalance', [util.getAddress(pk1), 'latest'], undefined, {
      keepIn3: true, proof: 'standard', signatureCount: 1, requestCount: 1
    })

    // we should get a valid response even though server #0 signed a wrong hash and was convicted server #1 gave a correct one.
    assert.equal(await test.getServerCountFromContract(), 1)

    // just read all events
    const events = await watcher.update()
    assert.equal(events.length, 2)
    assert.equal(events.map(_ => _.event).join(), 'LogServerConvicted,LogServerRemoved')

  })

  it('verify and convict (block older then 256 blocks) - worth it', async () => {

    const test = await TestTransport.createWithRegisteredServers(2)

    await tx.callContract(test.url, test.nodeList.contract, 'updateServer(uint,uint,uint64)', [0, 0, 0], { privateKey: test.getHandlerConfig(0).privateKey, value: toBN('490000000000000000'), confirm: true, gas: 5000000 })


    const blockHashRegistry = "0x" + (await tx.callContract(test.url, test.nodeList.contract, 'blockRegistry():(address)', []))[0].toString("hex")

    const txReceipt = (await tx.callContract(test.url, blockHashRegistry, 'snapshot()', [], { privateKey: test.getHandlerConfig(1).privateKey, value: 0, confirm: true, gas: 5000000 }))

    const wrongBlock = txReceipt.blockNumber - 0x12C
    const watcher = test.getHandler(0).watcher

    const pk1 = test.getHandlerConfig(0).privateKey
    const pk2 = test.getHandlerConfig(1).privateKey

    const block = await test.getFromServer('eth_getBlockByNumber', toHex(wrongBlock), false) as BlockData

    //console.log((toNumber(txReceipt.blockNumber) - toNumber(block.number)))
    assert.equal((toNumber(txReceipt.blockNumber) - toNumber(block.number)), 300)

    const client = await test.createClient()

    // this is a correct signature and should not fail.
    const res = await client.sendRPC('eth_getBalance', [util.getAddress(pk1), toHex(wrongBlock)], undefined, {
      keepIn3: true, proof: 'standard', signatureCount: 1, requestCount: 1
    })

    assert.isDefined(res.in3.proof.signatures[0])
    test.injectRandom([0.01, 0.9])
    test.injectRandom([0.02, 0.8])

    let manipulated = false
    test.injectResponse({ method: 'in3_sign' }, (req: RPCRequest, re: RPCResponse, url: string) => {
      const index = parseInt(url.substr(1)) - 1
      // we change it to a wrong signature
      if (!manipulated) {
        re.result = [sign(block, test.getHandlerConfig(index).privateKey, pk1)]
        manipulated = true
      }
      return re
    })


    assert.equal(await test.getServerCountFromContract(), 2)

    // we create a new client because the old one may have different weights now
    const client2 = await test.createClient()

    // just read all events
    await watcher.update()


    // this is a correct signature and should not fail.
    const res2 = await client2.sendRPC('eth_getBalance', [util.getAddress(pk1), toHex(wrongBlock)], undefined, {
      keepIn3: true, proof: 'standard', signatureCount: 1, requestCount: 1
    })

    // we should get a valid response even though server #0 signed a wrong hash and was convicted server #1 gave a correct one.
    assert.equal(await test.getServerCountFromContract(), 1)

    // just read all events
    const events = await watcher.update()
    assert.equal(events.length, 2)

    assert.equal(events.map(_ => _.event).join(), 'LogServerConvicted,LogServerRemoved')

  })

  it('verify and convict (block older then 256 blocks) - request unregister', async () => {

    const test = await TestTransport.createWithRegisteredServers(2)

    await tx.callContract(test.url, test.nodeList.contract, 'updateServer(uint,uint,uint64)', [0, 0, 0], { privateKey: test.getHandlerConfig(0).privateKey, value: toBN('490000000000000000'), confirm: true, gas: 5000000 })

    const serverContract = await test.getServerFromContract(0)

    const unregisterDeposit = serverContract.deposit / 50



    const blockHashRegistry = "0x" + (await tx.callContract(test.url, test.nodeList.contract, 'blockRegistry():(address)', []))[0].toString("hex")

    const txReceipt = (await tx.callContract(test.url, blockHashRegistry, 'snapshot()', [], { privateKey: test.getHandlerConfig(1).privateKey, value: 0, confirm: true, gas: 5000000 }))

    const wrongBlock = txReceipt.blockNumber - 0x12C
    const watcher = test.getHandler(0).watcher

    const pk1 = test.getHandlerConfig(0).privateKey
    const pk2 = test.getHandlerConfig(1).privateKey

    const block = await test.getFromServer('eth_getBlockByNumber', toHex(wrongBlock), false) as BlockData

    //console.log((toNumber(txReceipt.blockNumber) - toNumber(block.number)))
    assert.equal((toNumber(txReceipt.blockNumber) - toNumber(block.number)), 300)

    const client = await test.createClient()

    // this is a correct signature and should not fail.
    const res = await client.sendRPC('eth_getBalance', [util.getAddress(pk1), toHex(wrongBlock)], undefined, {
      keepIn3: true, proof: 'standard', signatureCount: 1, requestCount: 1
    })

    assert.isDefined(res.in3.proof.signatures[0])
    test.injectRandom([0.01, 0.9])
    test.injectRandom([0.02, 0.8])

    let manipulated = false
    test.injectResponse({ method: 'in3_sign' }, (req: RPCRequest, re: RPCResponse, url: string) => {
      const index = parseInt(url.substr(1)) - 1
      // we change it to a wrong signature
      if (!manipulated) {
        re.result = [sign(block, test.getHandlerConfig(index).privateKey, pk1)]
        manipulated = true
      }
      return re
    })


    assert.equal(await test.getServerCountFromContract(), 2)

    // we create a new client because the old one may have different weights now
    const client2 = await test.createClient()

    const unregisterAccount = await test.createAccount()

    // just read all events
    await watcher.update()

    const balanceBeforeUnregister = new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(unregisterAccount), 'latest'))

    await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringServer(uint)', [0], { privateKey: unregisterAccount, value: unregisterDeposit, confirm: true, gas: 300000 })

    const balanceAfterUnregister = new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(unregisterAccount), 'latest'))

    assert.equal(balanceBeforeUnregister.sub(balanceAfterUnregister).toString(), (serverContract.deposit / 50).toString())

    // this is a correct signature and should not fail.
    const res2 = await client2.sendRPC('eth_getBalance', [util.getAddress(pk1), toHex(wrongBlock)], undefined, {
      keepIn3: true, proof: 'standard', signatureCount: 1, requestCount: 1
    })

    // we should get a valid response even though server #0 signed a wrong hash and was convicted server #1 gave a correct one.
    assert.equal(await test.getServerCountFromContract(), 1)

    // just read all events
    const events = await watcher.update()

    assert.equal(events.length, 3)

    assert.equal(events.map(_ => _.event).join(), 'LogServerUnregisterRequested,LogServerConvicted,LogServerRemoved')

    const balanceAfterConvict = new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(unregisterAccount), 'latest'))

    assert.equal(balanceAfterConvict.toString(), balanceBeforeUnregister.toString())

  })

  it('verify and convict (block older then 256 blocks) - not worth it', async () => {

    const test = await TestTransport.createWithRegisteredServers(2)


    const blockHashRegistry = "0x" + (await tx.callContract(test.url, test.nodeList.contract, 'blockRegistry():(address)', []))[0].toString("hex")

    const txReceipt = (await tx.callContract(test.url, blockHashRegistry, 'snapshot()', [], { privateKey: test.getHandlerConfig(1).privateKey, value: 0, confirm: true, gas: 5000000 }))

    const wrongBlock = txReceipt.blockNumber - 0x12C
    const watcher = test.getHandler(0).watcher

    const pk1 = test.getHandlerConfig(0).privateKey
    const pk2 = test.getHandlerConfig(1).privateKey

    const block = await test.getFromServer('eth_getBlockByNumber', toHex(wrongBlock), false) as BlockData

    //console.log((toNumber(txReceipt.blockNumber) - toNumber(block.number)))
    assert.equal((toNumber(txReceipt.blockNumber) - toNumber(block.number)), 300)

    const client = await test.createClient()

    // this is a correct signature and should not fail.
    const res = await client.sendRPC('eth_getBalance', [util.getAddress(pk1), toHex(wrongBlock)], undefined, {
      keepIn3: true, proof: 'standard', signatureCount: 1, requestCount: 1
    })

    assert.isDefined(res.in3.proof.signatures[0])
    test.injectRandom([0.01, 0.9])
    test.injectRandom([0.02, 0.8])

    let manipulated = false
    test.injectResponse({ method: 'in3_sign' }, (req: RPCRequest, re: RPCResponse, url: string) => {
      const index = parseInt(url.substr(1)) - 1
      // we change it to a wrong signature
      if (!manipulated) {
        re.result = [sign(block, test.getHandlerConfig(index).privateKey, pk1)]
        manipulated = true
      }
      return re
    })


    assert.equal(await test.getServerCountFromContract(), 2)

    // we create a new client because the old one may have different weights now
    const client2 = await test.createClient()

    // just read all events
    await watcher.update()


    // this is a correct signature and should not fail.
    const res2 = await client2.sendRPC('eth_getBalance', [util.getAddress(pk1), toHex(wrongBlock)], undefined, {
      keepIn3: true, proof: 'standard', signatureCount: 1, requestCount: 1
    })

    // we should get a valid response even though server #0 signed a wrong hash and was convicted server #1 gave a correct one.
    assert.equal(await test.getServerCountFromContract(), 2)

    // just read all events
    const events = await watcher.update()
  })


  it('requestUnregisteringServer - cancel', async () => {

    const test = await TestTransport.createWithRegisteredServers(2)
    const watcher = test.handlers['#1'].getHandler().watcher
    // read all events (should be only the 2 register-events
    assert.equal((await watcher.update()).length, 2)
    //  const unregisterDeposit = 10000 / 50

    const user = await test.createAccount("30000000000000000")
    const serverContract = await test.getServerFromContract(0)

    const unregisterDeposit = serverContract.deposit / 50
    // the user regquests to unregister this server
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringServer(uint)', [0], { privateKey: user, value: unregisterDeposit / 2, confirm: true, gas: 300000 }).catch(_ => false), 'Must fail, because the wrong value was sent')

    // the user regquests to unregister this server
    await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringServer(uint)', [0], { privateKey: user, value: unregisterDeposit, confirm: true, gas: 300000 })

    const balanceOwnerBefore = new BigNumber(await test.getFromServer('eth_getBalance', test.nodeList.nodes[0].address, 'latest'))

    // this should have picked up the first event, but als executing a transaction and reacting to it.
    let events = await watcher.update()
    assert.equal(events.length, 1)
    assert.equal(events[0].event, 'LogServerUnregisterRequested')
    assert.equal(events[0].caller, util.getAddress(user))
    assert.equal(events[0].url, '#1')
    assert.equal(events[0].owner, test.nodeList.nodes[0].address)

    // now we should see the reaction of the server
    events = await watcher.update()
    if (!events) {
      await new Promise(_ => setTimeout(_, 100))
      events = await watcher.update()
    }
    assert.equal(events.length, 1)
    assert.equal(events[0].event, 'LogServerUnregisterCanceled')
    assert.equal(events[0].url, '#1')
    assert.equal(events[0].owner, test.nodeList.nodes[0].address)

    const balanceOwnerAfter = new BigNumber(await test.getFromServer('eth_getBalance', test.nodeList.nodes[0].address, 'latest'))
    // the owner now got the deposit from the
    assert.equal(balanceOwnerAfter.sub(balanceOwnerBefore).toString(), unregisterDeposit.toString())
  })


  it('requestUnregisteringServer - 28days', async () => {

    const test = await TestTransport.createWithRegisteredServers(2)
    // read all events (should be only the 2 register-events

    const user = await test.createAccount()
    const serverContract = await test.getServerFromContract(0)
    const unregisterDeposit = serverContract.deposit / 50
    // the user regquests to unregister this server
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringServer(uint)', [0], { privateKey: user, value: unregisterDeposit / 2, confirm: true, gas: 300000 }).catch(_ => false), 'Must fail, because the wrong value was sent')

    let balanceBefore = new BigNumber(await test.getFromServer('eth_getBalance', test.nodeList.nodes[1].address, 'latest'))

    // the user regquests to unregister this server
    await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringServer(uint)', [0], { privateKey: test.getHandlerConfig(1).privateKey, value: unregisterDeposit, confirm: true, gas: 300000 })

    let balanceAfter = new BigNumber(await test.getFromServer('eth_getBalance', test.nodeList.nodes[1].address, 'latest'))

    assert.equal(balanceBefore.sub(balanceAfter).toString(), (unregisterDeposit.toString()))

    balanceBefore = balanceAfter

    const balanceOwnerBefore = new BigNumber(await test.getFromServer('eth_getBalance', test.nodeList.nodes[0].address, 'latest'))

    // should fail now
    let rc = await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringServer(uint)', [0], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false)

    assert.isFalse(rc)

    await test.increaseTime(28 * 86400 + 10)

    rc = await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringServer(uint)', [0], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    })


    balanceAfter = new BigNumber(await test.getFromServer('eth_getBalance', test.nodeList.nodes[1].address, 'latest'))

    assert.equal(balanceAfter.sub(balanceBefore).toString(), (unregisterDeposit + (serverContract.deposit / 5)).toString())
  })


  it('requestUnregisteringServer - timeout', async () => {

    const test = await TestTransport.createWithRegisteredServers(2)

    const serverBefore = await test.getServerFromContract(0)

    assert.equal(serverBefore.timeout.toNumber(), 3600)
    assert.equal(serverBefore.unregisterTime.toNumber(), 0)
    assert.equal(serverBefore.unregisterCaller, "0000000000000000000000000000000000000000")
    assert.equal(serverBefore.unregisterDeposit, 0)

    const receipt = await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringServer(uint)', [0], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 })

    let block = await test.getFromServer('eth_getBlockByNumber', receipt.blockNumber, false) as BlockData

    const serverAfter = await test.getServerFromContract(0)

    assert.equal(serverAfter.timeout.toNumber(), 3600)
    assert.equal(serverAfter.owner, serverAfter.unregisterCaller)
    assert.equal(serverAfter.unregisterTime - Number(block.timestamp), 3600)
    assert.equal(serverAfter.unregisterDeposit, 0)

    const balanceOwnerBefore = new BigNumber(await test.getFromServer('eth_getBalance', test.nodeList.nodes[0].address, 'latest'))

    let rc = await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringServer(uint)', [0], {
      privateKey: test.getHandlerConfig(0).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false)

    // wait 2h 
    await test.increaseTime(7201)

    rc = await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringServer(uint)', [0], {
      privateKey: test.getHandlerConfig(0).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    })
    const balanceOwnerAfter = new BigNumber(await test.getFromServer('eth_getBalance', test.nodeList.nodes[0].address, 'latest'))

    assert.equal(balanceOwnerAfter.sub(balanceOwnerBefore).toString(), serverBefore.deposit.toString())


  })

  it('registerDuplicate', async () => {
    // create an empty registry
    const test = await new TestTransport(1)
    const pk1 = await test.createAccount()
    const pk2 = await test.createAccount()
    const transport = new LoggingAxiosTransport()

    // register 2 different servers should work
    let registers = await registerServers(pk1, null, [{
      url: 'test1.com',
      deposit: 0,
      pk: pk1,
      props: '0xff',
      timeout: 7200,
    }, {
      url: 'test2.com',
      deposit: 0,
      pk: pk2,
      props: '0xff',
      timeout: 7200,
    }], test.chainId, null, test.url, transport, false)

    // register same url servers should not work
    await test.mustFail(
      registerServers(pk1, null, [{
        url: 'test1.com',
        deposit: 0,
        pk: pk1,
        props: '0xff',
        timeout: 7200,
      }, {
        url: 'test1.com',
        deposit: 0,
        pk: pk2,
        props: '0xff',
        timeout: 7200,
      }], test.chainId, null, test.url, transport, false)
    )

    // register same pk servers should not work
    await test.mustFail(
      registerServers(pk1, null, [{
        url: 'test1.com',
        deposit: 0,
        pk: pk1,
        props: '0xff',
        timeout: 3600
      }, {
        url: 'test2.com',
        deposit: 0,
        pk: pk1,
        props: '0xff',
        timeout: 3600
      }], test.chainId, null, test.url, transport, false)
    )
  })

  it('registerServer and changing timeout', async () => {


    const test = await TestTransport.createWithRegisteredServers(2)
    let serverBefore = await test.getServerFromContract(0)
    assert.equal(serverBefore.timeout.toNumber(), 3600)
    assert.equal(toHex(serverBefore.props), "0xffff")

    const pk1 = await test.createAccount()
    const transport = new LoggingAxiosTransport()

    assert.equal(await test.getServerCountFromContract(), 2)

    await registerServers(pk1, test.nodeList.contract, [{
      url: 'test3.com',
      deposit: 0,
      pk: pk1,
      props: '0xff',
      timeout: 7200,
    }], test.chainId, null, test.url, transport, false)

    assert.equal(await test.getServerCountFromContract(), 3)

    serverBefore = await test.getServerFromContract(2)
    assert.equal(toNumber(serverBefore.timeout), 7200)
    assert.equal(toHex(serverBefore.props), "0xff")

    // changing props
    await tx.callContract(test.url, test.nodeList.contract, 'updateServer(uint,uint,uint64)', [2, 0x0fff, 0], { privateKey: pk1, value: 0, confirm: true, gas: 3000000 })
    let serverAfter = await test.getServerFromContract(2)

    assert.equal(toNumber(serverAfter.timeout), 7200)
    assert.equal(toHex(serverAfter.props), "0x0fff")

    await tx.callContract(test.url, test.nodeList.contract, 'updateServer(uint,uint,uint64)', [2, 0x0fff, 14400], { privateKey: pk1, value: 0, confirm: true, gas: 3000000 })
    serverAfter = await test.getServerFromContract(2)
    assert.equal(toHex(serverAfter.props), "0x0fff")
    assert.equal(toNumber(serverAfter.timeout), 14400)

    await tx.callContract(test.url, test.nodeList.contract, 'updateServer(uint,uint,uint64)', [2, 0xffff, 16400], { privateKey: pk1, value: 0, confirm: true, gas: 3000000 })
    serverAfter = await test.getServerFromContract(2)
    assert.equal(toHex(serverAfter.props), "0xffff")
    assert.equal(toNumber(serverAfter.timeout), 16400)


  })
})
