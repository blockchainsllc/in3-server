
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
const uint = serialize.uint

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

const calcHash = (nonce: number, signer: string, blockhash: string): Buffer => {

  return ethUtil.keccak(Buffer.concat([bytes32(nonce), address(signer), bytes32(blockhash)]))

}


describe('Convict', () => {

  it("static variables and deployment", async () => {
    const test = await TestTransport.createWithRegisteredNodes(2)

    const version = (await tx.callContract(test.url, test.nodeList.contract, 'VERSION():(uint)', []))[0]
    await tx.callContract(test.url, test.nodeList.contract, 'VERSION():(uint)', [], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 50000000 })
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'VERSION():(uint)', [], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 10, confirm: true, gas: 50000000 }).catch(_ => false))
    assert.equal(toNumber(version).toString(), "12300020190709")

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
  })


  it("overflow checks", async () => {

    const test = await TestTransport.createWithRegisteredNodes(1)

    const timeoutPK = await test.createAccount(null, toBN('4900000000000000000'))
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['timeout', toBN("0xFFFFFFFFFFFFFFFFF"), 3601, toBN("0xFFFFFFFFFFFFFFFFF")], { privateKey: timeoutPK, value: toBN('4900000000000000000'), confirm: true, gas: 5000000 }).catch(_ => false))
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['timeout', toBN("0xFFFFFFFFFFFFFFFF"), 3601, toBN("0xFFFFFFFFFFFFFFFFF")], { privateKey: timeoutPK, value: toBN('4900000000000000000'), confirm: true, gas: 5000000 }).catch(_ => false))

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'registerNodeFor(string,uint64,uint64,address,uint64)', ['timeout', toBN("0xFFFFFFFFFFFFFFFFF"), 3601, util.getAddress(timeoutPK), toBN("0xFFFFFFFFFFFFFFFFF")], { privateKey: timeoutPK, value: toBN('4900000000000000000'), confirm: true, gas: 5000000 }).catch(_ => false))
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'registerNodeFor(string,uint64,uint64,address,uint64)', ['timeout', toBN("0xFFFFFFFFFFFFFFFF"), 3601, util.getAddress(timeoutPK), toBN("0xFFFFFFFFFFFFFFFFFF")], { privateKey: timeoutPK, value: toBN('4900000000000000000'), confirm: true, gas: 5000000 }).catch(_ => false))

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'registerNodeFor(string,uint64,uint64,address,uint64)', ['timeout', toBN("0xFFFFFFFFFFFFFF"), 3601, "abcdefg" + util.getAddress(timeoutPK), toBN("0xFFFFFFFFFFFFFFF")], { privateKey: timeoutPK, value: toBN('4900000000000000000'), confirm: true, gas: 5000000 }).catch(_ => false))

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(test.getHandlerConfig(0).privateKey), "test3.com", toBN("0xFFFFFFFFFFFFFFFFF"), 0, 2000], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(test.getHandlerConfig(0).privateKey), "test3.com", 0xFFFFFFFFFFFFFFFFF, 0, 2000], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(test.getHandlerConfig(0).privateKey), "test3.com", 0xFFFFFFFFFFF, 0, 0xFFFFFFFFFFFFFFFFF], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['timeout', toBN("0xFFFFFFFFFFFFFF"), 3601, toBN("0xFFFFFFFFFFFFFF")], { privateKey: timeoutPK, value: toBN('4900000000000000000'), confirm: true, gas: 5000000 })

  })

  it('convict on contracts', async () => {

    const test = await TestTransport.createWithRegisteredNodes(2)

    const registryId = (await tx.callContract(test.url, test.nodeList.contract, 'registryId():(bytes32)', []))[0]
    await tx.callContract(test.url, test.nodeList.contract, 'registryId():(bytes32)', [], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 0, confirm: true, gas: 50000000 })
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'registryId():(bytes32)', [], { privateKey: test.getHandlerConfig(0).privateKey, to: test.nodeList.contract, value: 10, confirm: true, gas: 50000000 }).catch(_ => false))
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

    const c1 = await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [s.block, convictSignature], {
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
    await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [s.block, convictSignature], {
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

    await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [s.block, convictSignatureWrong], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 3000000,
      value: 0,
      confirm: true                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
    })

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [s.block, convictSignatureWrong], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 3000000,
      value: 10,
      confirm: true                       //  we are not waiting for confirmation, since we want to deliver the answer to the client.
    }).catch(_ => false))

    const s2 = sign({ number: blockNumberInSnapshot } as any, registryId, test.getHandlerConfig(1).privateKey, '0x0000000000000000000000000000000000000000000000000000000000001234')
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(address,bytes32,uint,uint8,bytes32,bytes32)', [convictOwner, s2.blockHash, s2.block, s2.v, s2.r, s2.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 3000000,
      value: 0,
      confirm: true
    }).catch(_ => false))
    assert.include(await test.getErrorReason(), "the block was not signed by the signer of the node")

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

    await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [s.block, convictSignature], {
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

  it("convict - immediate remove", async () => {
    const test = await TestTransport.createWithRegisteredNodes(2)

    const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

    const convictCallerOne = await test.createAccount()
    const convictCallerTwo = await test.createAccount()

    const registryId = (await tx.callContract(test.url, test.nodeList.contract, 'registryId():(bytes32)', []))[0]

    const s = sign({ number: block.number } as any, registryId, test.getHandlerConfig(0).privateKey, '0x0000000000000000000000000000000000000000000000000000000000001234')
    // send the transactions to convict with the wrong hash
    const convictSignatureOne = ethUtil.keccak(Buffer.concat([bytes32(s.blockHash), address(util.getAddress(convictCallerOne)), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))
    const convictSignatureTwo = ethUtil.keccak(Buffer.concat([bytes32(s.blockHash), address(util.getAddress(convictCallerTwo)), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))

    await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [s.block, convictSignatureOne], {
      privateKey: convictCallerOne,
      gas: 3000000,
      value: 0,
      confirm: true
    })

    await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [s.block, convictSignatureTwo], {
      privateKey: convictCallerTwo,
      gas: 3000000,
      value: 0,
      confirm: true
    })

    const tempAddr = util.getAddress(test.getHandlerConfig(0).privateKey)

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(address,bytes32,uint,uint8,bytes32,bytes32)', [util.getAddress(test.getHandlerConfig(0).privateKey), s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: convictCallerTwo,
      gas: 3000000,
      value: 0,
      confirm: true
    }).catch(_ => false))
    assert.include(await test.getErrorReason(), "revealConvict still locked")

    await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(address,bytes32,uint,uint8,bytes32,bytes32)', [util.getAddress(test.getHandlerConfig(0).privateKey), s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: convictCallerOne,
      gas: 3000000,
      value: 0,
      confirm: true
    })
  })

  it("convict - locked", async () => {
    const test = await TestTransport.createWithRegisteredNodes(2)

    const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

    const convictCallerOne = await test.createAccount()
    const convictCallerTwo = await test.createAccount()

    const registryId = (await tx.callContract(test.url, test.nodeList.contract, 'registryId():(bytes32)', []))[0]

    const s = sign({ number: block.number } as any, registryId, test.getHandlerConfig(0).privateKey, '0x0000000000000000000000000000000000000000000000000000000000001234')
    // send the transactions to convict with the wrong hash
    const convictSignatureOne = ethUtil.keccak(Buffer.concat([bytes32(s.blockHash), address(util.getAddress(convictCallerOne)), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))
    const convictSignatureTwo = ethUtil.keccak(Buffer.concat([bytes32(s.blockHash), address(util.getAddress(convictCallerTwo)), toBuffer(s.v, 1), bytes32(s.r), bytes32(s.s)]))

    await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [s.block, convictSignatureOne], {
      privateKey: convictCallerOne,
      gas: 3000000,
      value: 0,
      confirm: true
    })

    await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32)', [s.block, convictSignatureTwo], {
      privateKey: convictCallerTwo,
      gas: 3000000,
      value: 0,
      confirm: true
    })

    const tempAddr = util.getAddress(test.getHandlerConfig(0).privateKey)

    // for (let i = 0; i < 2; i++) {
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(address,bytes32,uint,uint8,bytes32,bytes32)', [util.getAddress(test.getHandlerConfig(0).privateKey), s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: convictCallerTwo,
      gas: 3000000,
      value: 0,
      confirm: true
    }).catch(_ => false))
    assert.include(await test.getErrorReason(), "revealConvict still locked")
    //  }

    await tx.callContract(test.url, test.nodeList.contract, 'revealConvict(address,bytes32,uint,uint8,bytes32,bytes32)', [util.getAddress(test.getHandlerConfig(0).privateKey), s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: convictCallerTwo,
      gas: 3000000,
      value: 0,
      confirm: true
    })
  })

  if (process.env.GITLAB_CI) it.skip('verify and convict (block within 256 blocks)')
  else
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


      await test.createAccount()
      await test.createAccount()
      await test.createAccount()
      await watcher.update()
      // we should get a valid response even though server #0 signed a wrong hash and was convicted server #1 gave a correct one.
      assert.equal(await test.getNodeCountFromContract(), 1)

      // just read all events
      const events = await watcher.update()
      assert.equal(events.length, 2)
      assert.equal(events.map(_ => _.event).join(), 'LogNodeConvicted,LogNodeRemoved')

    })


  // TODO: remove
  if (process.env.GITLAB_CI) it.skip('verify and convict (block older then 256 blocks) - worth it')
  else it('verify and convict (block older then 256 blocks) - worth it', async () => {
    // TODO: remove
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
    await test.createAccount()
    // just read all events
    await watcher.update()
    await test.createAccount()
    const events = await watcher.update()

    assert.equal(events.length, 2)
    assert.equal(await test.getNodeCountFromContract(), 1)

    assert.equal(events.map(_ => _.event).join(), 'LogNodeConvicted,LogNodeRemoved')

  })


  // TODO: remove
  if (process.env.GITLAB_CI) it.skip('verify and convict (block older then 256 blocks) - not worth it')
  else it('verify and convict (block older then 256 blocks) - not worth it', async () => {
    // TODO: remove
    if (process.env.GITLAB_CI) return true
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


  it('requestUnregisteringNode - owner - cancel', async () => {

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

    const user = await test.createAccount(null, toBN('49000000000000000000'))

    const userNonExist = await test.createAccount(null, toBN('10000000000000000000'))
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(userNonExist)], { privateKey: userNonExist, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "address is not an in3-signer")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false), 'Must fail, because not the owner of the server')
    assert.include(await test.getErrorReason(), "node is already unregistering")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'cancelUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(1).privateKey)], { privateKey: test.getHandlerConfig(1).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false), 'Must fail, because not the owner of the server')
    assert.include(await test.getErrorReason(), "node is not unregistering")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'cancelUnregisteringNode(address)', [util.getAddress(user)], { privateKey: test.getHandlerConfig(1).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false), 'Must fail, because not the owner of the server')
    assert.include(await test.getErrorReason(), "signer does not own a node")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, value: 10, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'cancelUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: user, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "only owner can cancel unregistering a node")


    await tx.callContract(test.url, test.nodeList.contract, 'cancelUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 })

    const serverAfterCancel = await test.getNodeFromContract(0)

    assert.equal(serverAfterCancel.timeout.toNumber(), 3600)
    assert.equal(serverAfterCancel.unregisterTime.toNumber(), 0)

    const calcDeposit = await tx.callContract(test.url, test.nodeList.contract, 'calcUnregisterDeposit(address):(uint)', [util.getAddress(test.getHandlerConfig(1).privateKey)])

    await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(1).privateKey)], { privateKey: user, value: toBN(calcDeposit[0].toString()), confirm: true, gas: 3000000 })
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'cancelUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(1).privateKey)], { privateKey: test.getHandlerConfig(1).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "cancel during challenge not allowed")
  })

  it('requestUnregisteringNode - owner', async () => {

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

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false))
    assert.include(await test.getErrorReason(), "only owner can unregister a node")

    assert.equal(await test.getNodeCountFromContract(), 2)

    await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], {
      privateKey: test.getHandlerConfig(0).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    })
    assert.equal(await test.getNodeCountFromContract(), 1)

    const balanceOwnerAfter = new BigNumber(await test.getFromServer('eth_getBalance', test.nodeList.nodes[0].address, 'latest'))

    assert.equal(balanceOwnerAfter.sub(balanceOwnerBefore).toString(), serverBefore.deposit.toString())

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], {
      privateKey: test.getHandlerConfig(0).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false))

    assert.include(await test.getErrorReason(), "sender does not own a node")

    await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(1).privateKey)], { privateKey: test.getHandlerConfig(1).privateKey, value: 0, confirm: true, gas: 3000000 })

    await test.increaseTime(10000)
    await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(1).privateKey)], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    })
    assert.equal(await test.getNodeCountFromContract(), 0)

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(1).privateKey)], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false))

    await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['abc', 1000, 3600, 2000], {
      privateKey: test.getHandlerConfig(0).privateKey, value: toBN('490000000000000000'), confirm: true, gas: 5000000
    })

    await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 })

    await test.increaseTime(3600)
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], {
      privateKey: userNonExist,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false))
    assert.include(await test.getErrorReason(), "only owner can unregister a node")

    await test.increaseTime(86400)

    const emptyAccount = await test.createAccount(null, 0)
    assert.equal(new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(emptyAccount), 'latest')).toString(), '0')

    const balanceOwnerBeforeConfirm = await test.getFromServer('eth_getBalance', util.getAddress(test.getHandlerConfig(0).privateKey), 'latest')

    await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], {
      privateKey: emptyAccount,
      gas: 300000,
      value: 0,
      confirm: true
    })

    let currentBlock = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

    assert.equal(new BigNumber(await test.getFromServer('eth_getBalance', util.getAddress(emptyAccount), 'latest')).toString(), toBN('4900000000000000').toString())
    const [unregisterTimeoutAfter, usedAfter, ownerAfter, lockedTimeAfter, unregisterCallerAfter, depositAmountAfter, unregisterDepositAfter, indexAfter] = await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint64,address,uint,uint,uint)', [util.getAddress(test.getHandlerConfig(0).privateKey)])

    assert.equal(unregisterTimeoutAfter.toString(), '0')
    assert.isFalse(usedAfter)
    assert.equal(ownerAfter, util.getAddress(test.getHandlerConfig(0).privateKey).substr(2).toLowerCase())
    assert.equal(lockedTimeAfter.toString(), toNumber(currentBlock.timestamp).toString())
    assert.equal(unregisterCallerAfter, '0000000000000000000000000000000000000000')
    assert.equal(depositAmountAfter.toString(), toBN('490000000000000000').sub(toBN('4900000000000000')).toString())
    assert.equal(unregisterDepositAfter.toString(), '0')
    assert.equal(indexAfter.toString(), '0')
    const balanceOwnerAfterConfirm = await test.getFromServer('eth_getBalance', util.getAddress(test.getHandlerConfig(0).privateKey), 'latest')

    assert.equal(balanceOwnerBeforeConfirm, balanceOwnerAfterConfirm)
    assert.equal(await test.getNodeCountFromContract(), 0)

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'returnDeposit(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], {
      privateKey: emptyAccount,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false))

    assert.include(await test.getErrorReason(), "only owner can claim deposit")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'returnDeposit(address)', [util.getAddress(test.getHandlerConfig(1).privateKey)], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false))

    assert.include(await test.getErrorReason(), "nothing to transfer")
    await test.increaseTime(1)

    await tx.callContract(test.url, test.nodeList.contract, 'returnDeposit(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], {
      privateKey: test.getHandlerConfig(0).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    })

    const balanceOwnerAfterDeposit = await test.getFromServer('eth_getBalance', util.getAddress(test.getHandlerConfig(0).privateKey), 'latest')

    assert.equal(toBN(balanceOwnerAfterDeposit).toString(), toBN(balanceOwnerAfterConfirm).add(toBN('490000000000000000').sub(toBN('4900000000000000'))).toString())

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'returnDeposit(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], {
      privateKey: test.getHandlerConfig(0).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false), "cannot return deposit twice")

    await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['abc', 1000, 3600, 2000], {
      privateKey: test.getHandlerConfig(0).privateKey, value: toBN('490000000000000000'), confirm: true, gas: 5000000
    })

    await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 })

    await test.increaseTime(90001)
    const balanceBeforeUnregister = await test.getFromServer('eth_getBalance', util.getAddress(test.getHandlerConfig(0).privateKey), 'latest')
    await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], {
      privateKey: test.getHandlerConfig(0).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    })
    const balanceAfterUnregister = await test.getFromServer('eth_getBalance', util.getAddress(test.getHandlerConfig(0).privateKey), 'latest')

    assert.equal(toBN(balanceAfterUnregister).toString(), toBN(balanceBeforeUnregister).add(toBN('490000000000000000')).toString())

  })

  it('requestUnregisteringNode - non-owner', async () => {
    const test = await TestTransport.createWithRegisteredNodes(2)

    assert.equal(await test.getNodeCountFromContract(), 2)
    const unregisterCallerPK = await test.createAccount(null, toBN('49000000000000000000'))

    const serverBefore = await test.getNodeFromContract(0)

    const calcDeposit = await tx.callContract(test.url, test.nodeList.contract, 'calcUnregisterDeposit(address):(uint)', [util.getAddress(test.getHandlerConfig(0).privateKey)])

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: unregisterCallerPK, value: 0, confirm: true, gas: 3000000 }).catch(_ => false), "must fail because no value provided")
    assert.include(await test.getErrorReason(), "send deposit is not correct")
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: unregisterCallerPK, value: toBN('49000000000000000000'), confirm: true, gas: 3000000 }).catch(_ => false), "must fail because too much value provided")
    assert.include(await test.getErrorReason(), "send deposit is not correct")

    const [, usedBefore, ownerBefore, lockedTimeBefore, unregisterCallerBefore, depositAmountBefore, unregisterDepositBefore, indexBefore] = await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint64,address,uint,uint,uint)', [util.getAddress(test.getHandlerConfig(0).privateKey)])
    assert.isTrue(usedBefore)
    assert.equal(ownerBefore, util.getAddress(test.getHandlerConfig(0).privateKey).substr(2).toLowerCase())
    assert.equal(lockedTimeBefore.toString(), '0')
    assert.equal(unregisterCallerBefore, '0000000000000000000000000000000000000000')
    assert.equal(depositAmountBefore.toString(), '0')
    assert.equal(unregisterDepositBefore.toString(), '0')
    assert.equal(indexBefore.toString(), '0')

    await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: unregisterCallerPK, value: toBN(calcDeposit[0].toString()), confirm: true, gas: 3000000 })

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: unregisterCallerPK, value: toBN(calcDeposit[0].toString()), confirm: true, gas: 3000000 }).catch(_ => false), "cannot call unregister twice")
    assert.include(await test.getErrorReason(), "cannot unregister when inactivity is claimed")

    const [unregisterTimeout, used, owner, lockedTime, unregisterCaller, depositAmount, unregisterDeposit, index] = await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint64,address,uint,uint,uint)', [util.getAddress(test.getHandlerConfig(0).privateKey)])
    let currentBlock = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

    const lockedTimeCalc = toBN(currentBlock.timestamp).add(toBN(28 * 86400))
    assert.equal(lockedTimeCalc.toString(), unregisterTimeout.toString())
    assert.isTrue(used)
    assert.equal(owner, util.getAddress(test.getHandlerConfig(0).privateKey).substr(2).toLowerCase())
    assert.equal(lockedTime.toString(), '0')
    assert.equal(unregisterCaller, util.getAddress(unregisterCallerPK).substr(2).toLowerCase())
    assert.equal(depositAmount.toString(), '0')
    assert.equal(unregisterDeposit.toString(), calcDeposit[0].toString())
    assert.equal(indexBefore.toString(), '0')
    const serverAfter = await test.getNodeFromContract(0)

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'transferOwnership(address,address)',
      [util.getAddress(test.getHandlerConfig(0).privateKey), util.getAddress(unregisterCallerPK)], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false), "must fail as owner change during claimed inactivity is not allowed")
    assert.include(await test.getErrorReason(), 'no ownership transfer during claimed inactivity')

    assert.deepEqual(serverBefore, serverAfter)

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: unregisterCallerPK, value: 0, confirm: true, gas: 3000000 }).catch(_ => false),
      "must fail as cannot confirm before timeout")
    assert.include(await test.getErrorReason(), "only after challenge time is over")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false),
      "must fail as cannot confirm before timeout")
    assert.include(await test.getErrorReason(), "only unregister caller can confirm")

    await test.increaseTime(28 * 86400 + 1)
    const balanceBefore = await test.getFromServer('eth_getBalance', util.getAddress(unregisterCallerPK), 'latest')

    await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: unregisterCallerPK, value: 0, confirm: true, gas: 3000000 })
    currentBlock = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData
    const balanceAfter = await test.getFromServer('eth_getBalance', util.getAddress(unregisterCallerPK), 'latest')

    assert.equal(toBN(balanceAfter).sub(toBN(balanceBefore)).toString(), calcDeposit[0].mul(toBN(2)).toString())

    const [unregisterTimeoutAfrer, usedAfter, ownerAfter, lockedTimeAfter, unregisterCallerAfter, depositAmountAfter, unregisterDepositAfter, indexAfter] = await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint64,address,uint,uint,uint)', [util.getAddress(test.getHandlerConfig(0).privateKey)])

    assert.equal(unregisterTimeoutAfrer.toString(), '0')
    assert.isFalse(usedAfter)
    assert.equal(ownerAfter, util.getAddress(test.getHandlerConfig(0).privateKey).substr(2).toLowerCase())
    assert.equal(lockedTimeAfter.toString(), serverAfter.timeout.add(toBN(currentBlock.timestamp)).toString())
    assert.equal(unregisterCallerAfter, "0000000000000000000000000000000000000000")
    assert.equal(depositAmountAfter.toString(), serverAfter.deposit.sub(calcDeposit[0]))
    assert.equal(unregisterDepositAfter.toString(), '0')
    assert.equal(await test.getNodeCountFromContract(), 1)

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'returnDeposit(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "deposit still locked")

    await test.increaseTime(toNumber(lockedTimeAfter))

    const depositBeforeReturn = await test.getFromServer('eth_getBalance', util.getAddress(test.getHandlerConfig(0).privateKey), 'latest')

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'returnDeposit(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(1).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "only owner can claim deposit")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'returnDeposit(address)', [util.getAddress(test.getHandlerConfig(1).privateKey)], { privateKey: test.getHandlerConfig(1).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "nothing to transfer")

    await tx.callContract(test.url, test.nodeList.contract, 'returnDeposit(address)', [util.getAddress(test.getHandlerConfig(0).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 })

    const depositAfterReturn = await test.getFromServer('eth_getBalance', util.getAddress(test.getHandlerConfig(0).privateKey), 'latest')

    assert.equal(toBN(depositAfterReturn).toString(), toBN(depositBeforeReturn).add(depositAmountAfter))

  })

  it('requestUnregisteringNode - prove activity', async () => {

    const test = await TestTransport.createWithRegisteredNodes(4)

    const unregisterCallerPK = await test.createAccount(null, toBN('49000000000000000000'))

    const calcDeposit = await tx.callContract(test.url, test.nodeList.contract, 'calcUnregisterDeposit(address):(uint)', [util.getAddress(test.getHandlerConfig(0).privateKey)])

    await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(test.getHandlerConfig(1).privateKey)], { privateKey: unregisterCallerPK, value: toBN(calcDeposit[0].toString()), confirm: true, gas: 3000000 })

    let currentBlock = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'proveActivity(uint,uint,address)', [toNumber(currentBlock.number), 0, util.getAddress(test.getHandlerConfig(3).privateKey)], { privateKey: test.getHandlerConfig(3).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "proof only when being challenged")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'proveActivity(uint,uint,address)', [toNumber(currentBlock.number), 0, util.getAddress(test.getHandlerConfig(1).privateKey)], { privateKey: test.getHandlerConfig(0).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "only owner or signer can prove activity")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'proveActivity(uint,uint,address)', [toNumber(0), 0, util.getAddress(test.getHandlerConfig(1).privateKey)], { privateKey: test.getHandlerConfig(1).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "block not found")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'proveActivity(uint,uint,address)', [toNumber(currentBlock.number), 0, util.getAddress(test.getHandlerConfig(1).privateKey)], { privateKey: test.getHandlerConfig(1).privateKey, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "not enough proof of work")


    if (process.env.GITLAB_CI) {
      let nonce = 0

      while (true) {

        const cHash = (calcHash(nonce, util.getAddress(test.getHandlerConfig(1).privateKey), currentBlock.hash).slice(0, 4))
        if (toNumber(cHash) < 4095) break
        nonce++
      }

      await tx.callContract(test.url, test.nodeList.contract, 'proveActivity(uint,uint,address)', [toNumber(currentBlock.number), nonce, util.getAddress(test.getHandlerConfig(1).privateKey)], { privateKey: test.getHandlerConfig(1).privateKey, value: 0, confirm: true, gas: 3000000 })

    }

  }).timeout(300000)

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

    assert.include(await test.getErrorReason(), "a node with the same url or signer is already registered")


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
    assert.include(await test.getErrorReason(), "a node with the same url or signer is already registered")

  })

  it('registerNodeFor', async () => {
    const test = await TestTransport.createWithRegisteredNodes(1)

    const signerAccount = await test.createAccount()
    const ownerAccount = await test.createAccount(null, toBN('490000000000000000000'))
    const newOwner = await test.createAccount(null, toBN('49000000000000000000'))
    const timeoutAccount = await test.createAccount()


    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'registerNodeFor(string,uint64,uint64,address,uint64)',
      ["#1", 1000, 10000, util.getAddress(signerAccount), 2000], { privateKey: ownerAccount, value: toBN('49000000000000000000'), confirm: true, gas: 3000000 }).catch(_ => false)
      , "must fail because url is already registered")
    assert.include(await test.getErrorReason(), "a node with the same url or signer is already registered")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'registerNodeFor(string,uint64,uint64,address,uint64)',
      ["#10", 1000, 10000, util.getAddress(test.getHandlerConfig(0).privateKey), 2000], { privateKey: ownerAccount, value: toBN('49000000000000000000'), confirm: true, gas: 3000000 }).catch(_ => false)
      , "must fail because signer is already registered")
    assert.include(await test.getErrorReason(), "a node with the same url or signer is already registered")

    await tx.callContract(test.url, test.nodeList.contract, 'registerNodeFor(string,uint64,uint64,address,uint64)',
      ["#10", 1000, 10000, util.getAddress(signerAccount), 2000], { privateKey: ownerAccount, value: toBN('1000000000000000000'), confirm: true, gas: 3000000 })

    const currentBlock = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

    const server = await test.getNodeFromContract(1)

    const proofcalc = ethUtil.keccak(
      Buffer.concat([
        bytes32(toBN('1000000000000000000')),
        uint64('10000'),
        uint64(currentBlock.timestamp),
        uint64('0'),
        uint64('1000'),
        address(util.getAddress(signerAccount)),
        serialize.bytes('#10')
      ])
    )

    assert.equal(server.url, "#10")
    assert.equal(server.deposit.toString(), '1000000000000000000')
    assert.equal(server.timeout.toString(), '10000')
    assert.equal(server.registerTime.toString(), Number(currentBlock.timestamp).toString())
    assert.equal(server.unregisterTime.toString(), '0')
    assert.equal(server.props.toString(), '1000')
    assert.equal(server.weight.toString(), '2000')
    assert.equal(server.signer.toLowerCase(), util.getAddress(signerAccount).substr(2).toLowerCase())
    assert.equal(server.proofHash.toString('hex'), proofcalc.toString('hex'))

    const [unregisterTimeout, used, owner, lockedTime, unregisterCaller, depositAmount, unregisterDeposit, index] = await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint64,address,uint,uint,uint)', [util.getAddress(signerAccount)])
    assert.equal(unregisterTimeout.toString(), '0')
    assert.isTrue(used)
    assert.equal(lockedTime.toString(), '0')
    assert.equal(unregisterCaller, '0000000000000000000000000000000000000000')
    assert.equal(depositAmount.toString(), '0')
    assert.equal(unregisterDeposit.toString(), '0')
    assert.equal(owner, util.getAddress(ownerAccount).substr(2).toLowerCase())
    assert.equal(index.toString(), '1')

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'transferOwnership(address,address)',
      [util.getAddress(ownerAccount), util.getAddress(newOwner)], { privateKey: ownerAccount, value: 0, confirm: true, gas: 3000000 }).catch(_ => false), "must fail as the owner is not a signer")
    assert.include(await test.getErrorReason(), "owner changes only on active nodes")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'transferOwnership(address,address)',
      [util.getAddress(signerAccount), "0x0000000000000000000000000000000000000000"], { privateKey: ownerAccount, value: 0, confirm: true, gas: 3000000 }).catch(_ => false), "must fail as the 0x0 as new owner is invalid")
    assert.include(await test.getErrorReason(), "0x0 address is invalid")

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'transferOwnership(address,address)',
      [util.getAddress(signerAccount), util.getAddress(newOwner)], { privateKey: newOwner, value: 0, confirm: true, gas: 3000000 }).catch(_ => false), "must fail as the 0x0 as new owner is invalid")
    assert.include(await test.getErrorReason(), "only current owner can transfer ownership")

    await tx.callContract(test.url, test.nodeList.contract, 'transferOwnership(address,address)',
      [util.getAddress(signerAccount), util.getAddress(newOwner)], { privateKey: ownerAccount, value: 0, confirm: true, gas: 3000000 })

    const [, , ownerNew, , , , , indexnew] = await tx.callContract(test.url, test.nodeList.contract, 'signerIndex(address):(uint64,bool,address,uint64,address,uint,uint,uint)', [util.getAddress(signerAccount)])

    assert.equal(ownerNew, util.getAddress(newOwner).substr(2).toLowerCase())
    assert.equal(indexnew.toString(), '1')

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'registerNodeFor(string,uint64,uint64,address,uint64)', ['timeout', 1000, 86400 * 365 * 10 + 1, util.getAddress(timeoutAccount), 2000], { privateKey: ownerAccount, value: toBN('4900000000000000000'), confirm: true, gas: 5000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "exceeded maximum timeout")

  })

  it('updateServer', async () => {

    const test = await TestTransport.createWithRegisteredNodes(2)
    let serverBefore = await test.getNodeFromContract(0)
    assert.equal(serverBefore.timeout.toNumber(), 3600)
    assert.equal(toHex(serverBefore.props), "0xffff")

    const pk1 = await test.createAccount(null, toBN('4900000000000000000'))
    const pk2 = await test.createAccount(null, toBN('4900000000000000000'))

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

    await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(pk1), "test3.com", 0x0fff, 0, 2000], { privateKey: pk1, value: 0, confirm: true, gas: 3000000 })
    let serverAfter = await test.getNodeFromContract(2)

    assert.equal(toNumber(serverAfter.timeout), 7200)
    assert.equal(toHex(serverAfter.props), "0x0fff")

    let calcHashContract = ethUtil.keccak(
      Buffer.concat([
        bytes32(serverAfter.deposit),
        uint64(serverAfter.timeout),
        uint64(serverAfter.registerTime),
        uint64(serverAfter.unregisterTime),
        uint64(serverAfter.props),
        address("0x" + serverAfter.signer.toLowerCase()),
        serialize.bytes(serverAfter.url)
      ])
    )
    assert.equal(calcHashContract.toString(), serverAfter.proofHash.toString())

    await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(pk1), "test3.com", 0x0fff, 14400, 2000], { privateKey: pk1, value: 0, confirm: true, gas: 3000000 })
    serverAfter = await test.getNodeFromContract(2)
    assert.equal(toHex(serverAfter.props), "0x0fff")
    assert.equal(toNumber(serverAfter.timeout), 14400)

    calcHashContract = ethUtil.keccak(
      Buffer.concat([
        bytes32(serverAfter.deposit),
        uint64(serverAfter.timeout),
        uint64(serverAfter.registerTime),
        uint64(serverAfter.unregisterTime),
        uint64(serverAfter.props),
        address("0x" + serverAfter.signer.toLowerCase()),
        serialize.bytes(serverAfter.url)
      ])
    )
    assert.equal(calcHashContract.toString(), serverAfter.proofHash.toString())

    await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(pk1), "test3.com", 0xffff, 16400, 2000], { privateKey: pk1, value: 0, confirm: true, gas: 3000000 })
    serverAfter = await test.getNodeFromContract(2)
    assert.equal(toHex(serverAfter.props), "0xffff")
    assert.equal(toNumber(serverAfter.timeout), 16400)

    calcHashContract = ethUtil.keccak(
      Buffer.concat([
        bytes32(serverAfter.deposit),
        uint64(serverAfter.timeout),
        uint64(serverAfter.registerTime),
        uint64(serverAfter.unregisterTime),
        uint64(serverAfter.props),
        address("0x" + serverAfter.signer.toLowerCase()),
        serialize.bytes(serverAfter.url)
      ])
    )
    assert.equal(calcHashContract.toString(), serverAfter.proofHash.toString())

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

    await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['unregisterServer', 1000, 1000, 2000], { privateKey: pk2, value: toBN('4900000000000000000'), confirm: true, gas: 5000000 })
    await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringNode(address)', [util.getAddress(pk2)], { privateKey: pk2, value: 0, confirm: true, gas: 3000000 })

    await test.increaseTime(3600)
    await tx.callContract(test.url, test.nodeList.contract, 'confirmUnregisteringNode(address)', [util.getAddress(pk2)], { privateKey: pk2, value: 0, confirm: true, gas: 3000000 })

    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(pk2), "test3.com", 0x0fff, 0, 2000], { privateKey: pk2, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "signer does not own a node")

    const timeoutPK = await test.createAccount(null, toBN('4900000000000000000'))
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['timeout', 1000, 86400 * 365 + 1, 2000], { privateKey: timeoutPK, value: toBN('4900000000000000000'), confirm: true, gas: 5000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "exceeded maximum timeout")
    await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['timeout', 1000, 86400 * 365 - 1, 2000], { privateKey: timeoutPK, value: toBN('4900000000000000000'), confirm: true, gas: 5000000 })
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(timeoutPK), "timeout", 0x0fff, 86400 * 365 * 1 + 1, 2000], { privateKey: timeoutPK, value: 0, confirm: true, gas: 3000000 }).catch(_ => false))
    assert.include(await test.getErrorReason(), "exceeded maximum timeout")

    await test.increaseTime(365 * 86400 + 1)
    await tx.callContract(test.url, test.nodeList.contract, 'updateNode(address,string,uint64,uint64,uint64)', [util.getAddress(richUser), 'abc', 0xffff, 16400, 2000], { privateKey: richUser, value: toBN('50000000000000000000'), confirm: true, gas: 5000000 })
    const richUserTwo = await test.createAccount(null, toBN("100000000000000000000"))
    await tx.callContract(test.url, test.nodeList.contract, 'registerNode(string,uint64,uint64,uint64)', ['richNode', 1000, 10000, 2000], { privateKey: richUserTwo, value: toBN('50000000000000000000'), confirm: true, gas: 5000000 })


  })

})
