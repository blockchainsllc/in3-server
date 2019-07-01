
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
import { registerNodes, deployNodeRegistry } from '../../src/util/registry'
import { toBN, toBuffer } from 'in3/js/src/util/util';
import { BigNumber } from 'ethers/utils';

const address = serialize.address
const bytes32 = serialize.bytes32
const toNumber = util.toNumber
const toHex = util.toHex
const uint64 = serialize.uint64

const sign = (b: BlockData, registryId: string, pk: string, blockHash?: string) => {
  const msgHash = ethUtil.keccak(Buffer.concat([bytes32(blockHash || b.hash), bytes32(b.number), bytes32(registryId)]))
  const s = ethUtil.ecsign(msgHash, bytes32(pk))
  return {
    ...s,
    block: toNumber(b.number),
    blockHash: blockHash || b.hash,
    address: util.getAddress(pk),
    msgHash: toHex(msgHash, 32),
    r: toHex(s.r),
    s: toHex(s.s),
    v: s.v
  } as Signature
}

const signVote = (blockhash: string, owner: string, pk: string) => {

  const msgHash = (ethUtil.keccak(blockhash + owner.substr(2)))
  const msgHash2 = ethUtil.keccak(toHex("\x19Ethereum Signed Message:\n32") + toHex(msgHash).substr(2))
  const s = ethUtil.ecsign((msgHash2), bytes32(pk))

  return {
    ...s,
    address: util.getAddress(pk),
    msgHash: toHex(msgHash, 32),
    signature: toHex(s.r) + toHex(s.s).substr(2) + toHex(s.v).substr(2),
    r: toHex(s.r),
    s: toHex(s.s),
    v: s.v
  }
}

describe('Convict', () => {

  it("static variables and deployment", async () => {
    const test = await TestTransport.createWithRegisteredNodes(2)

    const version = (await tx.callContract(test.url, test.nodeList.contract, 'VERSION():(uint)', []))[0]
    await tx.callContract(test.url, test.nodeList.contract, 'VERSION():(uint)', [], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 50000000 })
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'VERSION():(uint)', [], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 10, confirm: true, gas: 50000000 }).catch(_ => false))
    assert.equal(toNumber(version).toString(), "12300020190328")

    const numNodes = (await tx.callContract(test.url, test.nodeList.contract, 'totalNodes():(uint)', []))[0]
    await tx.callContract(test.url, test.nodeList.contract, 'totalNodes():(uint)', [], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 50000000 })
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'totalNodes():(uint)', [], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 10, confirm: true, gas: 50000000 }).catch(_ => false))

    assert.equal(toNumber(numNodes), 2)

    const hashurl = ethUtil.keccak("#1")

    const urlIndex = (await tx.callContract(test.url, test.nodeList.contract, 'urlIndex(bytes32):(bool,address)', [hashurl]))
    await tx.callContract(test.url, test.nodeList.contract, 'urlIndex(bytes32):(bool,address)', [hashurl], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 50000000 })
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'urlIndex(bytes32):(bool,address)', [hashurl], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 10, confirm: true, gas: 50000000 }).catch(_ => false))

    assert.isTrue(urlIndex[0])
    assert.equal(util.getAddress(test.getHandlerConfig(0).privateKey).toLowerCase(), "0x" + urlIndex[1].toLowerCase())

    const newServerReg = await deployNodeRegistry(test.getHandlerConfig(0).privateKey, test.url)

    let currentBlock = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

    const registryId = (await tx.callContract(test.url, newServerReg, 'registryId():(bytes32)', []))[0]

    const tsDeployment = await tx.callContract(test.url, newServerReg, 'blockTimeStampDeployment():(uint)', [0])
    assert.equal(tsDeployment.toString(), Number(currentBlock.timestamp).toString())

    await tx.callContract(test.url, newServerReg, 'blockTimeStampDeployment():(uint)', [0], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 50000000 })
    assert.isFalse(await tx.callContract(test.url, newServerReg, 'blockTimeStampDeployment():(uint)', [0], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 10, confirm: true, gas: 50000000 }).catch(_ => false))

    const blockBefore = await test.getFromServer('eth_getBlockByNumber', toHex(Number(currentBlock.number) - 1), false) as BlockData

    const calcReg = ethUtil.keccak(Buffer.concat([
      address(newServerReg),
      bytes32(blockBefore.hash)
    ]))

    assert.equal(calcReg.toString(), registryId.toString())

    await tx.callContract(test.url, newServerReg, 'registerNode(string,uint64,uint64,uint64)', ['abc', 1000, 10000, 2000], {
      privateKey: test.getHandlerConfig(0).privateKey, value: toBN('490000000000000000'), confirm: true, gas: 50000000, to: newServerReg
    })

    currentBlock = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData
    const server = (await tx.callContract(test.url, newServerReg, 'nodes(uint):(string,uint,uint64,uint64,uint64,uint64,uint64,address,bytes32)', [0]))
    await tx.callContract(test.url, newServerReg, 'nodes(uint):(string,uint,uint64,uint64,uint64,uint64,uint64,address,bytes32)', [0], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 50000000 })
    assert.isFalse(await tx.callContract(test.url, newServerReg, 'nodes(uint):(string,uint,uint64,uint64,uint64,uint64,uint64,address,bytes32)', [0], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 10, confirm: true, gas: 50000000 }).catch(_ => false))

    assert.equal(server[0], "abc")

    assert.equal(server[1].toString(), "490000000000000000")

    assert.equal(server[2].toString(), "10000")
    assert.equal(Number(currentBlock.timestamp).toString(), server[3].toString())
    assert.equal(server[4].toString(), "0")
    assert.equal(server[5].toString(), "1000")

    assert.equal(server[6].toString(), "2000")
    assert.equal("0x" + server[7].toLowerCase(), util.getAddress(test.getHandlerConfig(0).privateKey).toLowerCase())

    const calcHashContract = ethUtil.keccak(
      Buffer.concat([
        bytes32(server[1]),
        uint64(server[2]),
        uint64(server[3]),
        uint64(server[4]),
        uint64(server[5]),
        address("0x" + server[7].toLowerCase()),
        serialize.bytes(server[0])
      ])
    )
    assert.equal(calcHashContract.toString(), server[8].toString())

    const calcHash = ethUtil.keccak(
      Buffer.concat([
        bytes32(toBN('490000000000000000')),
        uint64('10000'),
        uint64(currentBlock.timestamp),
        uint64('0'),
        uint64('1000'),
        address(util.getAddress(test.getHandlerConfig(0).privateKey)),
        serialize.bytes('abc')
      ])
    )

    assert.equal(calcHash.toString(), calcHashContract.toString())
  }
  )

  it('convict on contracts', async () => {

    const test = await TestTransport.createWithRegisteredNodes(2)

    const registryId = (await tx.callContract(test.url, test.nodeList.contract, 'registryId():(bytes32)', []))[0]

    const blockHashRegAddress = "0x" + (await tx.callContract(test.url, test.nodeList.contract, 'blockRegistry():(address)', []))[0].toString('hex')
    await tx.callContract(test.url, test.nodeList.contract, 'blockRegistry():(address)', [], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 50000000 })
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'blockRegistry():(address)', [], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 10, confirm: true, gas: 50000000 }).catch(_ => false))

    // creating a snaphsot
    const snapshotreceipt = await tx.callContract(test.url, blockHashRegAddress, 'snapshot()', [], { privateKey: test.getHandlerConfig(1).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 5000000 })

    const blockNumberInSnapshot = toNumber(snapshotreceipt.blockNumber) - 1

    const convictOwner = util.getAddress(test.getHandlerConfig(0).privateKey)

    // make sure we have more than 256 blocks in order to test older blocks
    const currentBlock = parseInt(await test.getFromServer('eth_blockNumber'))
    for (let b = 0; b < 300 - currentBlock; b++) {
      await test.createAccount(null, '0x27147114878000')
    }

    // read current Block
    let block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData
    // create a event-watcher starting with the current block
    const watcher = new Watcher(test.getHandler(0), 0, null, toNumber(block.number))

    // sign the correct blockhash 
    let s = sign(block, registryId, test.getHandlerConfig(0).privateKey)

    let convictSignature: Buffer = ethUtil.keccak(Buffer.concat([bytes32(s.blockHash), address(util.getAddress(test.getHandlerConfig(1).privateKey)), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))

    const c1 = await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32,address)', [s.block, convictSignature, convictOwner], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
    })

    let rc = await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(address,bytes32,uint,uint8,bytes32,bytes32)', [convictOwner, s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 3000000,
      value: 0,
      confirm: true
    }).catch(_ => false)
    assert.isFalse(rc, 'Transaction must fail, because we sent the correct hash')
    assert.include(await test.getErrorReason(), "you try to convict with a correct hash")
    // now test if we can send a wrong blockhash, but the block is older than 256 blocks:
    // wrong blockhash signed by first node
    s = sign({ number: 1 } as any, registryId, test.getHandlerConfig(0).privateKey, '0x0000000000000000000000000000000000000000000000000000000000001234')

    convictSignature = ethUtil.keccak(Buffer.concat([bytes32(s.blockHash), address(util.getAddress(test.getHandlerConfig(1).privateKey)), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))
    /*
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [0, convictSignature], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 3000000,
      value: 0,
      confirm: true                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
    }).catch(_ => false))
    assert.include(await test.getErrorReason(), "block not found")
    */

    rc = await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(address,bytes32,uint,uint8,bytes32,bytes32)', [convictOwner, s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 3000000,
      value: 0,
      confirm: true
    }).catch(_ => false)
    assert.isFalse(rc, 'Transaction must fail, because the block is too old')
    assert.include(await test.getErrorReason(), "block not found")

    const serverContract = await test.getNodeFromContract(0)

    block = await test.getFromServer('eth_getBlockByNumber', toHex(blockNumberInSnapshot), false) as BlockData
    s = sign(block, registryId, test.getHandlerConfig(0).privateKey)

    convictSignature = ethUtil.keccak(Buffer.concat([bytes32(s.blockHash), address(util.getAddress(test.getHandlerConfig(1).privateKey)), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))
    await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32,address)', [s.block, convictSignature, convictOwner], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 3000000,
      value: 0,
      confirm: true                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
    })

    rc = await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(address,bytes32,uint,uint8,bytes32,bytes32)', [convictOwner, s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 3000000,
      value: 0,
      confirm: true
    }).catch(_ => false)

    assert.isFalse(rc, 'Transaction must fail, because block is correct')
    assert.include(await test.getErrorReason(), "you try to convict with a correct hash")

    // wrong blockhash signed by first node
    s = sign({ number: blockNumberInSnapshot } as any, registryId, test.getHandlerConfig(0).privateKey, '0x0000000000000000000000000000000000000000000000000000000000001234')

    // the sender to convit will be second node
    const sender = util.getAddress(test.getHandlerConfig(1).privateKey)

    // get the balance
    const balanceSenderBefore = new BigNumber(await test.getFromServer('eth_getBalance', sender, 'latest'))
    const balanceRegistryBefore = new BigNumber(await test.getFromServer('eth_getBalance', test.nodeList.contract, 'latest'))

    const convictSignatureWrong: Buffer = ethUtil.keccak(Buffer.concat([bytes32(s.blockHash), address(util.getAddress(test.getHandlerConfig(1).privateKey)), toBuffer(s.v, 1), bytes32(s.s), bytes32(s.s)]))

    await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32,address)', [s.block, convictSignatureWrong, convictOwner], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 3000000,
      value: 0,
      confirm: true                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
    })

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32,address)', [s.block, convictSignatureWrong, convictOwner], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 3000000,
      value: 10,
      confirm: true                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
    }).catch(_ => false))

    rc = await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(address,bytes32,uint,uint8,bytes32,bytes32)', [convictOwner, s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 3000000,
      value: 0,
      confirm: true
    }).catch(_ => false)
    assert.include(await test.getErrorReason(), "wrong convict hash")

    assert.isFalse(rc, 'Transaction must fail, convict signature is wrong')


    // send the transactions to convict with the wrong hash
    convictSignature = ethUtil.keccak(Buffer.concat([bytes32(s.blockHash), address(util.getAddress(test.getHandlerConfig(1).privateKey)), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))

    await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32,address)', [s.block, convictSignature, convictOwner], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 3000000,
      value: 0,
      confirm: true
    })

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(address,bytes32,uint,uint8,bytes32,bytes32)', [convictOwner, s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 3000000,
      value: 10,
      confirm: true
    }).catch(_ => false))

    await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(address,bytes32,uint,uint8,bytes32,bytes32)', [convictOwner, s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 3000000,
      value: 0,
      confirm: true
    })

    const balanceSenderAfter = new BigNumber(await test.getFromServer('eth_getBalance', sender, 'latest'))
    const balanceRegistryAfter = new BigNumber(await test.getFromServer('eth_getBalance', test.nodeList.contract, 'latest'))

    assert.equal((balanceSenderAfter.sub(balanceSenderBefore)).toString(), new BigNumber(serverContract.deposit / 2).toString())

    //  assert.equal(balanceRegistryBefore.sub(balanceRegistryAfter).toString(), serverContract.deposit)
    const events = await watcher.update()
    assert.equal(events.length, 2)
    assert.equal(events.map(_ => _.event).join(), 'LogNodeConvicted,LogNodeRemoved')

  }).timeout(500000)

  it('verify and convict (block within 256 blocks)', async () => {

    const test = await TestTransport.createWithRegisteredNodes(2)
    const watcher = test.getHandler(0).watcher

    const pk1 = test.getHandlerConfig(0).privateKey

    const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData
    const client = await test.createClient()

    // this is a correct signature and should not fail.
    const res = await client.sendRPC('eth_getBalance', [util.getAddress(pk1), 'latest'], undefined, {
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
        re.result = [sign(block, test.registryId, test.getHandlerConfig(index).privateKey, pk1)]
        manipulated = true
      }
      return re
    })

    assert.equal(await test.getNodeCountFromContract(), 2)

    // we create a new client because the old one may have different weights now
    const client2 = await test.createClient()

    // just read all events
    await watcher.update()

    // this is a correct signature and should not fail.
    await client2.sendRPC('eth_getBalance', [util.getAddress(pk1), 'latest'], undefined, {
      keepIn3: true, proof: 'standard', signatureCount: 1, requestCount: 1
    })

    // we should get a valid response even though server #0 signed a wrong hash and was convicted server #1 gave a correct one.
    assert.equal(await test.getNodeCountFromContract(), 1)

    // just read all events
    const events = await watcher.update()
    assert.equal(events.length, 2)
    assert.equal(events.map(_ => _.event).join(), 'LogNodeConvicted,LogNodeRemoved')

  })

  it.skip('getValidVoters', async () => {
    const test = await TestTransport.createWithRegisteredNodes(1)

    const accounts = []
    for (let i = 0; i < 60; i++) {

      const user = await test.createAccount(null, toBN('500000000000000000'))

      accounts.push({
        privateKey: user,
        address: util.getAddress(user)

      })

      await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['abc' + i, 1000, 10000, 2000], { privateKey: user, value: toBN('490000000000000000'), confirm: true, gas: 5000000 })

      const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData
      const blockNumber = toNumber(block.number) - 1

      const [validVoters, votingTime] = (await tx.callContract(test.url, test.nodeList.contract, 'getValidVoters(uint,address):(address[],uint)', [blockNumber, util.getAddress(test.getHandlerConfig(0).privateKey)]))

      await tx.callContract(test.url, test.nodeList.contract, 'getValidVoters(uint,address):(address[],uint)', [blockNumber, util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 300000000 - 1 })
      assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'getValidVoters(uint,address):(address[],uint)', [blockNumber, util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 10, confirm: true, gas: 300000000 - 1 }).catch(_ => false))

      assert.equal(await test.getNodeCountFromContract(), i + 2)
      for (const v of validVoters) {
        assert.notEqual("0x" + v, util.getAddress(test.getHandlerConfig(0).privateKey).toLowerCase())
      }

      const correctNumber = i < 24 ? i + 1 : 24

      assert.equal(validVoters.length, correctNumber)

    }
  }).timeout(50000)


  it.skip('voteUnregisterNode - votingPower', async () => {
    const test = await TestTransport.createWithRegisteredNodes(1)

    await test.increaseTime(86400 * 365 * 2)
    const accounts = []
    for (let i = 0; i < 24; i++) {

      const user = await test.createAccount(null, toBN('4320000000000000000000000'))

      accounts.push({
        privateKey: user,
        address: util.getAddress(user)

      })

      await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['abc' + i, 1000, 10000, 2000], { privateKey: user, value: toBN('4320000000000000000000000'), confirm: true, gas: 5000000 })
      let blockTemp = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

      await tx.callContract(test.url, test.nodeList.contract, 'getValidVoters(uint,address):(address[],uint)', [toNumber(blockTemp.number) - 1, util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 300000000 - 1 })
    }

    let block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

    let blockNumber = toNumber(block.number) - 1

    const validVoters = (await tx.callContract(test.url, test.nodeList.contract, 'getValidVoters(uint,address):(address[])', [blockNumber, util.getAddress(test.getHandlerConfig(0).privateKey)]))[0]
    await tx.callContract(test.url, test.nodeList.contract, 'getValidVoters(uint,address):(address[],uint)', [blockNumber, util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 300000000 - 1 })

    assert.equal(validVoters.length, 24)
    assert.equal(await test.getNodeCountFromContract(), 25)

    let blockSign = await test.getFromServer('eth_getBlockByNumber', toHex(blockNumber), false) as BlockData
    const [indexBefore, usedBefore, ownerBefore, lockedTimeBefore, depositAmountBefore] = await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint,uint)', [util.getAddress(test.getHandlerConfig(0).privateKey)])
    await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint,uint)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 300000000 - 1 })
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint,uint)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 10, confirm: true, gas: 300000000 - 1 }).catch(_ => false))

    assert.isTrue(usedBefore)
    assert.equal(indexBefore.toString(), '0')
    assert.equal(lockedTimeBefore.toString(), '0')
    assert.equal(depositAmountBefore.toString(), '0')

    const addressValidVoters = []

    for (const a of validVoters) {
      addressValidVoters.push("0x" + a.toLowerCase())
    }

    const txSig = []
    for (const a of accounts) {

      if (addressValidVoters.includes(a.address.toLowerCase())) {
        const s = signVote(blockSign.hash, util.getAddress(test.getHandlerConfig(0).privateKey), a.privateKey)
        txSig.push(s.signature)


        const rec = "0x" + (await tx.callContract(test.url, test.nodeList.contract, 'recoverAddress(bytes,bytes32,address):(address)', [s.signature, blockSign.hash, util.getAddress(test.getHandlerConfig(0).privateKey)]))[0]
        await tx.callContract(test.url, test.nodeList.contract, 'recoverAddress(bytes,bytes32,address):(address)', [s.signature, blockSign.hash, util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, gas: 300000000 - 1, value: 0, to: test.nodeList.contract })
        assert.equal(a.address.toLowerCase(), rec)
        assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'recoverAddress(bytes,bytes32,address):(address)', [s.signature, blockSign.hash, util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, gas: 300000000 - 1, value: 10, to: test.nodeList.contract, confirm: true }).catch(_ => false))

      }
    }

    const nonexistingUser = await test.createAccount(null)

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'voteUnregisterNode(uint,address,bytes[])', [1, util.getAddress(test.getHandlerConfig(0).privateKey), []], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false), 'Must fail, because no signatures provided')
    assert.include(await test.getErrorReason(), "block not found")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'voteUnregisterNode(uint,address,bytes[])', [blockNumber, util.getAddress(nonexistingUser), []], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false), 'Must fail, because no signatures provided')
    assert.include(await test.getErrorReason(), "owner does not have a node")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'voteUnregisterNode(uint,address,bytes[])', [blockNumber, util.getAddress(test.getHandlerConfig(0).privateKey), []], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false), 'Must fail, because no signatures provided')
    assert.include(await test.getErrorReason(), "provided no signatures")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'voteUnregisterNode(uint,address,bytes[])', [blockNumber, util.getAddress(test.getHandlerConfig(0).privateKey), txSig], { privateKey: accounts[0].privateKey, value: 0, confirm: true, gas: 5000000 }).catch(_ => false), 'Must fail, because not enough voting power')
    assert.include(await test.getErrorReason(), "not enough voting power")

    await test.increaseTime(86400 * 31)

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'voteUnregisterNode(uint,address,bytes[])', [blockNumber, util.getAddress(test.getHandlerConfig(0).privateKey), txSig.slice(1, txSig.length)], { privateKey: accounts[0].privateKey, value: 0, confirm: true, gas: 5000000 }).catch(_ => false), 'Must fail, because not enough voting power')
    assert.include(await test.getErrorReason(), "not enough voting power")

    const singleSignArray = []

    for (let i = 0; i < 24; i++) {
      singleSignArray[i] = txSig[0]
    }

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'voteUnregisterNode(uint,address,bytes[])', [blockNumber, util.getAddress(test.getHandlerConfig(0).privateKey), singleSignArray], { privateKey: accounts[0].privateKey, value: 0, confirm: true, gas: 5000000 }).catch(_ => false), 'Must fail, because not enough voting power')
    assert.include(await test.getErrorReason(), "not enough voting power")

    let balanceVoterBefore = new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(accounts[0].privateKey), 'latest'))

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'voteUnregisterNode(uint,address,bytes[])', [blockNumber, util.getAddress(test.getHandlerConfig(0).privateKey), txSig], { privateKey: accounts[0].privateKey, value: 10, confirm: true, gas: 6000000 }).catch(_ => false))

    const voteTx = await tx.callContract(test.url, test.nodeList.contract, 'voteUnregisterNode(uint,address,bytes[])', [blockNumber, util.getAddress(test.getHandlerConfig(0).privateKey), txSig], { privateKey: accounts[0].privateKey, value: 0, confirm: true, gas: 6000000 })

    let balanceVoterAfter = new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(accounts[0].privateKey), 'latest'))

    //test for min (10 finney)
    assert.equal(balanceVoterAfter.sub(balanceVoterBefore).toString(), '10000000000000000')

    assert.equal(await test.getNodeCountFromContract(), 24)

    const [indexAfter, usedAfter, ownerAfter, lockedTimeAfter, depositAmountAfter] = await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint,uint)', [util.getAddress(test.getHandlerConfig(0).privateKey)])
    await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint,uint)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 5000000 })

    assert.isFalse(usedAfter)
    assert.equal(indexAfter.toString(), '0')

    const blockVote = await test.getFromServer('eth_getBlockByNumber', voteTx.blockNumber, false) as BlockData

    assert.equal(lockedTimeAfter.toString(), util.toBN(blockVote.timestamp).add(util.toBN(3600)).toString())
    assert.equal(depositAmountAfter.toString(), '0')

  })

  it.skip('it should return correct deposits', async () => {

    const test = await TestTransport.createWithRegisteredNodes(1)

    const accounts = []
    for (let i = 0; i < 24; i++) {

      const user = await test.createAccount(null, toBN('10000000000000000'))

      accounts.push({
        privateKey: user,
        address: util.getAddress(user)

      })

      await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['abc' + i, 1000, 10000, 2000], { privateKey: user, value: toBN('10000000000000000'), confirm: true, gas: 50000000 })
    }

    /**
     * 10 finney return => min return value
     */
    const userVoteOne = await test.createAccount(null, toBN('10000000000000000000'))
    await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['kickOne', 1000, 10000, 2000], { privateKey: userVoteOne, value: toBN('10000000000000000000'), confirm: true, gas: 50000000 })

    const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData
    const blockNumber = toNumber(block.number) - 1

    const blockSign = await test.getFromServer('eth_getBlockByNumber', toHex(blockNumber), false) as BlockData

    let txSigNew = []
    for (const a of accounts) {
      const s = signVote(blockSign.hash, util.getAddress(userVoteOne), a.privateKey)
      txSigNew.push(s.signature)
    }

    let balanceVoterBefore = new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(accounts[1].privateKey), 'latest'))

    await tx.callContract(test.url, test.nodeList.contract, 'voteUnregisterNode(uint,address,bytes[])', [blockNumber, util.getAddress(userVoteOne), txSigNew], { privateKey: accounts[1].privateKey, value: 0, confirm: true, gas: 5000000 })

    const [, , , , depositAmountAfter2] = await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint,uint)', [util.getAddress(userVoteOne)])
    await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint,uint)', [util.getAddress(userVoteOne)], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 5000000 })

    assert.equal(depositAmountAfter2.toString(), '9900000000000000000')

    let balanceVoterAfter = new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(accounts[1].privateKey), 'latest'))

    //gasPrice = 0, only 10 finney are getting transfered
    assert.equal(balanceVoterAfter.sub(balanceVoterBefore).toString(), '10000000000000000')

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'returnDeposit(address)', [util.getAddress(accounts[1].privateKey)], { privateKey: accounts[1].privateKey, value: 0, confirm: true, gas: 5000000 }).catch(_ => false), 'Must fail, because deposit is still locked')
    assert.include(await test.getErrorReason(), "nothing to transfer")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'returnDeposit(address)', [util.getAddress(userVoteOne)], { privateKey: userVoteOne, value: 0, confirm: true, gas: 5000000 }).catch(_ => false), 'Must fail, because deposit is still locked')
    assert.include(await test.getErrorReason(), "deposit still locked")

    await test.increaseTime(10000)

    await test.createAccount(userVoteOne, toBN('10000000000000000000'))

    try {
      await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['ToKickOne', 1000, 3600, 2000], { privateKey: userVoteOne, value: toBN('10000000000000000000'), confirm: true, gas: 5000000 })
    } catch (e) {
      console.log("error: " + await test.getErrorReason())
    }
    balanceVoterBefore = new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(userVoteOne), 'latest'))

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'returnDeposit(address)', [util.getAddress(accounts[0].privateKey)], {
      privateKey: accounts[0].privateKey, value: 10, confirm: true, gas: 5000000
    }).catch(_ => false))

    await tx.callContract(test.url, test.nodeList.contract, 'returnDeposit(address)', [util.getAddress(userVoteOne)], {
      privateKey: userVoteOne, value: 0, confirm: true, gas: 5000000
    })

    balanceVoterAfter = new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(userVoteOne), 'latest'))
    assert.equal(balanceVoterAfter.sub(balanceVoterBefore).toString(), '9900000000000000000')
    assert.equal(balanceVoterAfter.sub(balanceVoterBefore).toString(), depositAmountAfter2)
    const [indexAfter3, usedAfter3, ownerAfter3, lockedTimeAfter3, depositAmountAfter3] = await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint,uint)', [util.getAddress(userVoteOne)])
    await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint,uint)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: userVoteOne, to: test.nodeList.contract, value: 0, confirm: true, gas: 5000000 })

    assert.isTrue(usedAfter3)
    assert.equal(indexAfter3.toString(), '25')
    assert.equal(lockedTimeAfter3.toString(), 0)
    assert.equal(depositAmountAfter3.toString(), 0)

    /**
     * 1% of deposit - gasPrice
     */

    const userVoteTwo = await test.createAccount(null, toBN('10000000000000000000'))

    await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['kickTwo', 1000, 10000, 2000], { privateKey: userVoteTwo, value: toBN('10000000000000000000'), confirm: true, gas: 50000000 })

    txSigNew = []
    for (const a of accounts) {
      const s = signVote(blockSign.hash, util.getAddress(userVoteTwo), a.privateKey)
      txSigNew.push(s.signature)
    }

    const balanceVoterTwoBefore = new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(userVoteOne), 'latest'))

    await tx.callContract(test.url, test.nodeList.contract, 'voteUnregisterNode(uint,address,bytes[])', [blockNumber, util.getAddress(userVoteTwo), txSigNew], { privateKey: userVoteOne, value: 0, confirm: true, gas: 5000000, gasPrice: toBN('100000000000') })
    const balanceVoterTwoAfter = new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(userVoteOne), 'latest'))

    const [, , , , depositAmountAfter4] = await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint,uint)', [util.getAddress(userVoteTwo)])

    assert.equal(depositAmountAfter4.toString(), '9900000000000000000')

    /**
     * gasPrice > 1% of gasPrice
     */

    const userVoteThree = await test.createAccount(null, toBN('10000000000000000000'))

    await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['kickThree', 1000, 10000, 2000], { privateKey: userVoteThree, value: toBN('10000000000000000000'), confirm: true, gas: 50000000 })

    txSigNew = []
    for (const a of accounts) {
      const s = signVote(blockSign.hash, util.getAddress(userVoteThree), a.privateKey)
      txSigNew.push(s.signature)
    }

    await test.createAccount(userVoteOne, toBN('50000000000000000000'))
    const balanceVoterThreeBefore = new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(userVoteOne), 'latest'))
    const unregisterTx = await tx.callContract(test.url, test.nodeList.contract, 'voteUnregisterNode(uint,address,bytes[])', [blockNumber, util.getAddress(userVoteThree), txSigNew], { privateKey: userVoteOne, value: 0, confirm: true, gas: 5000000, gasPrice: toBN('10000000000000') })

    const balanceVoterThreeAfter = new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(userVoteOne), 'latest'))

    const [, , , , depositAmountAfter5] = await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint,uint)', [util.getAddress(userVoteThree)])

    assert.equal(depositAmountAfter5.toString(), '9900000000000000000')

    const balanceDiff = balanceVoterThreeBefore.sub(balanceVoterThreeAfter)

    const gasCostUnregister = toBN(unregisterTx.gasUsed).mul(toBN('10000000000000'))

    const balanceDiffCalc = toBN(gasCostUnregister.toString()).sub(toBN(balanceDiff.toString()))

    assert.equal(balanceDiffCalc.toString(), '100000000000000000')

  }).timeout(50000)

  it('verify and convict (block older then 256 blocks) - worth it', async () => {

    const test = await TestTransport.createWithRegisteredNodes(2)

    await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(test.getHandlerConfig(0).privateKey), test.getHandlerConfig(0).rpcUrl, 0, 0, 0], { privateKey: test.getHandlerConfig(0).privateKey, value: toBN('490000000000000000'), confirm: true, gas: 5000000 })
    const blockHashRegistry = "0x" + (await tx.callContract(test.url, test.nodeList.contract, 'blockRegistry():(address)', []))[0].toString("hex")

    const txReceipt = (await tx.callContract(test.url, blockHashRegistry, 'snapshot()', [], { privateKey: test.getHandlerConfig(1).privateKey, value: 0, confirm: true, gas: 5000000 }))

    const wrongBlock = txReceipt.blockNumber - 0x12C
    const watcher = test.getHandler(0).watcher

    const pk1 = test.getHandlerConfig(0).privateKey
    const pk2 = test.getHandlerConfig(1).privateKey

    const block = await test.getFromServer('eth_getBlockByNumber', toHex(wrongBlock), false) as BlockData

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
        re.result = [sign(block, test.registryId, test.getHandlerConfig(index).privateKey, pk1)]
        manipulated = true
      }
      return re
    })


    assert.equal(await test.getNodeCountFromContract(), 2)

    // we create a new client because the old one may have different weights now
    const client2 = await test.createClient()

    // just read all events
    await watcher.update()


    // this is a correct signature and should not fail.
    const res2 = await client2.sendRPC('eth_getBalance', [util.getAddress(pk1), toHex(wrongBlock)], undefined, {
      keepIn3: true, proof: 'standard', signatureCount: 1, requestCount: 1
    })

    // we should get a valid response even though server #0 signed a wrong hash and was convicted server #1 gave a correct one.

    // just read all events
    const events = await watcher.update()
    assert.equal(events.length, 2)
    assert.equal(await test.getNodeCountFromContract(), 1)

    assert.equal(events.map(_ => _.event).join(), 'LogNodeConvicted,LogNodeRemoved')

  })

  it.skip('verify and convict - vote kick', async () => {
    const test = await TestTransport.createWithRegisteredNodes(1)
    const accounts = []
    for (let i = 0; i < 24; i++) {

      const user = await test.createAccount(null, toBN('590000000000000000'))

      accounts.push({
        privateKey: user,
        address: util.getAddress(user)

      })

      await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['abc' + i, 1000, 10000, 2000], { privateKey: user, value: toBN('500000000000000000'), confirm: true, gas: 5000000 })
    }

    const evilServer = await test.createAccount(null, toBN('1100000000000000000'))
    await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['evilServer', 1000, 10000, 2000], { privateKey: evilServer, value: toBN('1000000000000000000'), confirm: true, gas: 5000000 })

    const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

    const blockNumber = toNumber(block.number) - 1

    const validVoters = (await tx.callContract(test.url, test.nodeList.contract, 'getValidVoters(uint,address):(address[],uint)', [blockNumber, util.getAddress(evilServer)]))[0]
    await tx.callContract(test.url, test.nodeList.contract, 'getValidVoters(uint,address):(address[])', [blockNumber, util.getAddress(evilServer)], { privateKey: evilServer, to: test.nodeList.contract, value: 0, confirm: true, gas: 300000000 - 1 })

    const blockSign = await test.getFromServer('eth_getBlockByNumber', toHex(blockNumber), false) as BlockData
    const [indexBefore, usedBefore, ownerBefore, lockedTimeBefore, depositAmountBefore] = await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint,uint)', [util.getAddress(evilServer)])
    await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint,uint)', [util.getAddress(evilServer)], { privateKey: evilServer, to: test.nodeList.contract, value: 0, confirm: true, gas: 300000000 - 1 })

    assert.isTrue(usedBefore)
    assert.equal(indexBefore.toString(), '25')
    assert.equal(lockedTimeBefore.toString(), '0')
    assert.equal(depositAmountBefore.toString(), '0')

    const addressValidVoters = []

    for (const a of validVoters) {
      addressValidVoters.push("0x" + a.toLowerCase())
    }

    const txSig = []
    for (const a of accounts) {

      if (addressValidVoters.includes(a.address.toLowerCase())) {
        const s = signVote(blockSign.hash, util.getAddress(evilServer), a.privateKey)
        txSig.push(s.signature)
      }
    }
    const registryId = (await tx.callContract(test.url, test.nodeList.contract, 'registryId():(bytes32)', []))[0]

    let s = sign({ number: blockNumber } as any, registryId, evilServer, '0x0000000000000000000000000000000000000000000000000000000000001234')
    const convictSignature = ethUtil.keccak(Buffer.concat([bytes32(s.blockHash), address(util.getAddress(accounts[0].privateKey)), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))
    await tx.callContract(test.url, test.nodeList.contract, 'voteUnregisterNode(uint,address,bytes[])', [blockNumber, util.getAddress(evilServer), txSig], { privateKey: accounts[0].privateKey, value: 0, confirm: true, gas: 6500000 })
    const [usedBeforeConvict, indexBeforeConvict, lockedTimeBeforeConvict, depositBeforeConvict] = await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint,uint)', [util.getAddress(evilServer)])

    const balanceBeforeConvict = new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(accounts[0].privateKey), 'latest'))

    await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [s.block, convictSignature], {
      privateKey: accounts[0].privateKey,
      gas: 3000000,
      value: 0,
      confirm: true
    })

    await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(address,bytes32,uint,uint8,bytes32,bytes32)', [util.getAddress(evilServer), s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: accounts[0].privateKey,
      gas: 300000000 - 1,
      value: 0,
      confirm: true
    })

    const balanceAfterConvict = new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(accounts[0].privateKey), 'latest'))

    // 50% of the 0.0099 ether deposit
    assert.equal(balanceAfterConvict.sub(balanceBeforeConvict).toString(), '495000000000000000')

    const [, usedAfterConvict, , lockedTimeAfterConvict, depositAfterConvict] = await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint,uint)', [util.getAddress(evilServer)])

    //assert.equal(depositBeforeConvict.toString(), 10000)
    assert.isFalse(usedAfterConvict)
    assert.equal(depositAfterConvict.toString(), 0)

    assert.equal(lockedTimeAfterConvict.toString(), 0)
    // assert.equal(balanceAfterConvict.sub(balanceBeforeConvict).toString(), '5000')
  })

  it('verify and convict (block older then 256 blocks) - not worth it', async () => {

    const test = await TestTransport.createWithRegisteredNodes(2)


    const blockHashRegistry = "0x" + (await tx.callContract(test.url, test.nodeList.contract, 'blockRegistry():(address)', []))[0].toString("hex")
    await tx.callContract(test.url, test.nodeList.contract, 'blockRegistry():(address)', [], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 5000000 })

    const txReceipt = (await tx.callContract(test.url, blockHashRegistry, 'snapshot()', [], { privateKey: test.getHandlerConfig(1).privateKey, value: 0, confirm: true, gas: 5000000 }))

    const wrongBlock = txReceipt.blockNumber - 0x12C
    const watcher = test.getHandler(0).watcher

    const pk1 = test.getHandlerConfig(0).privateKey
    const pk2 = test.getHandlerConfig(1).privateKey

    const block = await test.getFromServer('eth_getBlockByNumber', toHex(wrongBlock), false) as BlockData

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


    assert.equal(await test.getNodeCountFromContract(), 2)

    // we create a new client because the old one may have different weights now
    const client2 = await test.createClient()

    // just read all events
    await watcher.update()


    // this is a correct signature and should not fail.
    const res2 = await client2.sendRPC('eth_getBalance', [util.getAddress(pk1), toHex(wrongBlock)], undefined, {
      keepIn3: true, proof: 'standard', signatureCount: 1, requestCount: 1
    })

    // we should get a valid response even though server #0 signed a wrong hash and was convicted server #1 gave a correct one.
    assert.equal(await test.getNodeCountFromContract(), 2)

    // just read all events
    const events = await watcher.update()
  })

  it.skip('requestUnregisteringNode - cancel', async () => {

    const test = await TestTransport.createWithRegisteredNodes(2)

    const serverBefore = await test.getNodeFromContract(0)

    assert.equal(serverBefore.timeout.toNumber(), 3600)
    assert.equal(serverBefore.unregisterTime.toNumber(), 0)

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, value: 10, confirm: true, gas: 3000000 }).catch(_ => false))

    const receipt = await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 })

    let block = await test.getFromServer('eth_getBlockByNumber', receipt.blockNumber, false) as BlockData

    const serverAfter = await test.getNodeFromContract(0)

    assert.equal(serverAfter.timeout.toNumber(), 3600)
    assert.equal(serverAfter.unregisterTime - Number(block.timestamp), 3600)

    const user = await test.createAccount()

    const userNonExist = await test.createAccount(null, toBN('10000000000000000000'))
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(userNonExist)], { privateKey: userNonExist, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "sender is not an in3-signer")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false), 'Must fail, because not the owner of the server')
    assert.include(await test.getErrorReason(), "node is already unregistering")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'cancelUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(1).privateKey)], { privateKey: test.getHandlerConfig(1).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false), 'Must fail, because not the owner of the server')
    assert.include(await test.getErrorReason(), "node is not unregistering")


    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, value: 10, confirm: true, gas: 3000000 }).catch(_ => false))

    await tx.callContract(test.url, test.nodeList.contract, 'cancelUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 })

    const serverAfterCancel = await test.getNodeFromContract(0)

    assert.equal(serverAfterCancel.timeout.toNumber(), 3600)
    assert.equal(serverAfterCancel.unregisterTime.toNumber(), 0)

  })

  it('requestUnregisteringServer', async () => {

    const test = await TestTransport.createWithRegisteredNodes(2)

    const serverBefore = await test.getNodeFromContract(0)

    assert.equal(serverBefore.timeout.toNumber(), 3600)
    assert.equal(serverBefore.unregisterTime.toNumber(), 0)

    const receipt = await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 })


    let block = await test.getFromServer('eth_getBlockByNumber', receipt.blockNumber, false) as BlockData

    const serverAfter = await test.getNodeFromContract(0)

    assert.equal(serverAfter.timeout.toNumber(), 3600)
    assert.equal(serverAfter.unregisterTime - Number(block.timestamp), 3600)

    const balanceOwnerBefore = new BigNumber(await test.getFromServer('eth_getBalance', test.nodeList.nodes[0].address, 'latest'))

    const userNonExist = await test.createAccount()

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(userNonExist)], {
      privateKey: userNonExist,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false), 'Must fail because sender does now own a server')
    assert.include(await test.getErrorReason(), "address is not an in3-signer")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], {
      privateKey: test.getHandlerConfig(0).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false), 'Must fail because the owner is not allowed to confirm yet')
    assert.include(await test.getErrorReason(), "only confirm after the timeout allowed")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(1).privateKey)], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false), 'Must fail because the owner did not call requestUnregister before')
    assert.include(await test.getErrorReason(), "cannot unregister an active node")

    // wait 2h 
    await test.increaseTime(7201)

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], {
      privateKey: test.getHandlerConfig(0).privateKey,
      gas: 300000,
      value: 10,
      confirm: true
    }).catch(_ => false))

    await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], {
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
    const pk1 = await test.createAccount(null, toBN('49000000000000000000'))
    const pk2 = await test.createAccount(null, toBN('49000000000000000000'))
    const transport = new LoggingAxiosTransport()

    // register 2 different servers should work
    let registers = await registerNodes(pk1, null, [{
      url: 'test1.com',
      deposit: toBN('4900000000000000000'),
      pk: pk1,
      props: '0xff',
      timeout: 7200,
    }, {
      url: 'test2.com',
      deposit: toBN('4900000000000000000'),
      pk: pk2,
      props: '0xff',
      timeout: 7200,
    }], test.chainId, null, test.url, transport, false)

    // register same url servers should not work
    await test.mustFail(
      registerNodes(pk1, null, [{
        url: 'test1.com',
        deposit: toBN('4900000000000000000'),
        pk: pk1,
        props: '0xff',
        timeout: 7200,
      }, {
        url: 'test1.com',
        deposit: toBN('4900000000000000000'),
        pk: pk2,
        props: '0xff',
        timeout: 7200,
      }], test.chainId, null, test.url, transport, false)
    )

    assert.include(await test.getErrorReason(), "a node with the same url or owner is already registered")


    // register same pk servers should not work
    await test.mustFail(
      registerNodes(pk1, null, [{
        url: 'test1.com',
        deposit: toBN('4900000000000000000'),
        pk: pk1,
        props: '0xff',
        timeout: 3600
      }, {
        url: 'test2.com',
        deposit: toBN('4900000000000000000'),
        pk: pk1,
        props: '0xff',
        timeout: 3600
      }], test.chainId, null, test.url, transport, false)
    )
    assert.include(await test.getErrorReason(), "a node with the same url or owner is already registered")

  })

  it('updateServer', async () => {


    const test = await TestTransport.createWithRegisteredNodes(2)
    let serverBefore = await test.getNodeFromContract(0)
    assert.equal(serverBefore.timeout.toNumber(), 3600)
    assert.equal(toHex(serverBefore.props), "0xffff")

    const pk1 = await test.createAccount(null, toBN('4900000000000000000'))
    const transport = new LoggingAxiosTransport()

    assert.equal(await test.getNodeCountFromContract(), 2)

    await registerNodes(pk1, test.nodeList.contract, [{
      url: 'test3.com',
      deposit: toBN('4900000000000000000'),
      pk: pk1,
      props: '0xff',
      timeout: 7200,
    }], test.chainId, null, test.url, transport, false)

    assert.equal(await test.getNodeCountFromContract(), 3)

    serverBefore = await test.getNodeFromContract(2)
    assert.equal(toNumber(serverBefore.timeout), 7200)
    assert.equal(toHex(serverBefore.props), "0xff")

    //updateNode(address _signer, string calldata _url, uint64 _props, uint64 _timeout)
    // changing props

    await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(pk1), "test3.com", 0x0fff, 0, 2000], { privateKey: pk1, value: 0, confirm: true, gas: 3000000 })
    let serverAfter = await test.getNodeFromContract(2)

    assert.equal(toNumber(serverAfter.timeout), 7200)
    assert.equal(toHex(serverAfter.props), "0x0fff")

    await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(pk1), "test3.com", 0x0fff, 14400, 2000], { privateKey: pk1, value: 0, confirm: true, gas: 3000000 })
    serverAfter = await test.getNodeFromContract(2)
    assert.equal(toHex(serverAfter.props), "0x0fff")
    assert.equal(toNumber(serverAfter.timeout), 14400)

    await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(pk1), "test3.com", 0xffff, 16400, 2000], { privateKey: pk1, value: 0, confirm: true, gas: 3000000 })
    serverAfter = await test.getNodeFromContract(2)
    assert.equal(toHex(serverAfter.props), "0xffff")
    assert.equal(toNumber(serverAfter.timeout), 16400)

    const randomAccount = await test.createAccount(null, '0x27147114878000')

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(randomAccount), "test3.com", 0xffff, 16400, 2000], {
      privateKey: randomAccount,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false), 'Must fail because the owner does not have a node yet')

    assert.include(await test.getErrorReason(), "only node owner can update")

    const richUser = await test.createAccount(null, toBN("100000000000000000000"))

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['abc', 1000, 10000, 2000], { privateKey: richUser, value: toBN('50000000000000000000'), confirm: true, gas: 5000000 }).catch(_ => false), 'Must fail because the owner does not have a server yet')
    assert.include(await test.getErrorReason(), "Limit of 50 ETH reached")

    await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['abc', 1000, 10000, 2000], { privateKey: richUser, value: toBN('5000000000000000000'), confirm: true, gas: 5000000 })

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(richUser), 'abc', 0xffff, 16400, 2000], { privateKey: richUser, value: toBN('50000000000000000000'), confirm: true, gas: 5000000 }).catch(_ => false), 'Must fail because the owner does not have a server yet')
    assert.include(await test.getErrorReason(), "Limit of 50 ETH reached")

    await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(richUser), 'abc', 0xffff, 16400, 2000], { privateKey: richUser, value: toBN('5000000000000000000'), confirm: true, gas: 5000000 })

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(richUser), "test3.com", 0xffff, 16400, 2000], {
      privateKey: richUser,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false), 'Must fail because the url is already taken')
    assert.include(await test.getErrorReason(), "url is already in use")

  })

  it.skip('calculate min deposit', async () => {
    const test = await TestTransport.createWithRegisteredNodes(2)
    let minDeposit = await tx.callContract(test.url, test.nodeList.contract, 'calculateMinDeposit(uint):(uint)', [0])
    await tx.callContract(test.url, test.nodeList.contract, 'calculateMinDeposit(uint):(uint)', [0], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 300000000 - 1 })

    // in the 1st 2 weeks we use 10 finney
    assert.equal(minDeposit.toString(), "10000000000000000")

    await test.increaseTime(86400 * 366)

    // should not have changed
    minDeposit = await tx.callContract(test.url, test.nodeList.contract, 'calculateMinDeposit(uint):(uint)', [0])
    await tx.callContract(test.url, test.nodeList.contract, 'calculateMinDeposit(uint):(uint)', [0], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 300000000 - 1 })
    assert.equal(minDeposit.toString(), "10000000000000000")

    const pk1 = await test.createAccount(null, toBN('51000000000000000000'))
    const pk2 = await test.createAccount(null, toBN('86400000000000000000000'))

    await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['server1', 1000, 10000, 2000], { privateKey: pk1, value: toBN('10000000000000000'), confirm: true, gas: 5000000 })
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['server1', 1000, 10000, 2000], { privateKey: pk1, value: toBN('10000000000000000'), confirm: true, gas: 5000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "not enough deposit")
    assert.equal((await tx.callContract(test.url, test.nodeList.contract, 'calculateMinDeposit(uint):(uint)', [0])).toString(), '864000000000000000000')
    await tx.callContract(test.url, test.nodeList.contract, 'calculateMinDeposit(uint):(uint)', [0], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 5000000 })

    const a = await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['server2', 1000, 10000, 2000], { privateKey: pk2, value: toBN('86400000000000000000000'), confirm: true, gas: 6000000 })
    assert.equal((await tx.callContract(test.url, test.nodeList.contract, 'calculateMinDeposit(uint):(uint)', [0])).toString(), '4320000000000000000000000')
    await tx.callContract(test.url, test.nodeList.contract, 'calculateMinDeposit(uint):(uint)', [0], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 5000000 })
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'calculateMinDeposit(uint):(uint)', [0], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 10, confirm: true, gas: 5000000 }).catch(_ => false))


  })



})
