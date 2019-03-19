
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
import { util, BlockData, serialize, Signature, RPCRequest, RPCResponse } from 'in3'
import * as tx from '../../src/util/tx'
import * as ethUtil from 'ethereumjs-util'
import { TestTransport, LoggingAxiosTransport } from '../utils/transport'
import Watcher from '../../src/chains/watch'
import { registerServers } from '../../src/util/registry'




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

    // make sure we have more than 256 blocks in order to test older blocks
    const currentBlock = parseInt(await test.getFromServer('eth_blockNumber'))
    for (let b = 0; b < 256 - currentBlock; b++)
      await test.createAccount()

    // read current Block
    const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData
    // create a event-watcher starting with the current block
    const watcher = new Watcher(test.getHandler(0), 0, null, toNumber(block.number))

    // sign the correct blockhash 
    let s = sign(block, test.getHandlerConfig(0).privateKey)

    // must fail, since we cannot convict with a correct blockhash
    let rc = await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32,uint,uint8,bytes32,bytes32)', [0, s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false)

    assert.isFalse(rc, 'Transaction must fail, because we sent the correct hash')

    // now test if we can send a wrong blockhash, but the block is older than 256 blocks:

    // wrong blockhash signed by first node
    s = sign({ number: 1 } as any, test.getHandlerConfig(0).privateKey, '0x0000000000000000000000000000000000000000000000000000000000001234')
    // must fail, since we cannot convict with a correct blockhash
    rc = await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32,uint,uint8,bytes32,bytes32)', [0, s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false)

    assert.isFalse(rc, 'Transaction must fail, because the block is too old')

    // now try a successfull convict with a wrong blockhash


    // wrong blockhash signed by first node
    s = sign(block, test.getHandlerConfig(0).privateKey, '0x0000000000000000000000000000000000000000000000000000000000001234')

    // the sender to convit will be second node
    const sender = util.getAddress(test.getHandlerConfig(1).privateKey)

    // get the balance
    const balanceSenderBefore = toNumber(await test.getFromServer('eth_getBalance', sender, 'latest'))
    const balanceRegistryBefore = toNumber(await test.getFromServer('eth_getBalance', test.nodeList.contract, 'latest'))

    // send the transaction to convict with the wrong hash
    rc = await tx.callContract(test.url, test.nodeList.contract, 'convict(uint,bytes32,uint,uint8,bytes32,bytes32)', [0, s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: test.getHandlerConfig(1).privateKey,
      gas: 300000,
      value: 0,
      confirm: true
    })

    const balanceSenderAfter = toNumber(await test.getFromServer('eth_getBalance', sender, 'latest'))
    const balanceRegistryAfter = toNumber(await test.getFromServer('eth_getBalance', test.nodeList.contract, 'latest'))

    assert.equal(balanceSenderAfter - balanceSenderBefore, 10000 / 2)
    assert.equal(balanceRegistryBefore - balanceRegistryAfter, 10000)
    const events = await watcher.update()
    assert.equal(events.length, 2)
    assert.equal(events.map(_ => _.event).join(), 'LogServerConvicted,LogServerRemoved')


  }).timeout(50000)



  it('verify and convict', async () => {

    const test = await TestTransport.createWithRegisteredServers(2)
    const watcher = test.getHandler(0).watcher

    const pk1 = test.getHandlerConfig(0).privateKey
    const pk2 = test.getHandlerConfig(1).privateKey

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


  it('requestUnregisteringServer', async () => {

    const test = await TestTransport.createWithRegisteredServers(2)
    const watcher = test.handlers['#1'].getHandler().watcher
    // read all events (should be only the 2 register-events
    assert.equal((await watcher.update()).length, 2)
    const unregisterDeposit = 10000 / 50

    const user = await test.createAccount()

    // the user regquests to unregister this server
    assert.isFalse(await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringServer(uint)', [0], { privateKey: user, value: unregisterDeposit - 1, confirm: true, gas: 300000 }).catch(_ => false), 'Must fail, because the wrong value was sent')

    // the user regquests to unregister this server
    await tx.callContract(test.url, test.nodeList.contract, 'requestUnregisteringServer(uint)', [0], { privateKey: user, value: unregisterDeposit, confirm: true, gas: 300000 })


    const balanceOwnerBefore = toNumber(await test.getFromServer('eth_getBalance', test.nodeList.nodes[0].address, 'latest'))

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

    const balanceOwnerAfter = toNumber(await test.getFromServer('eth_getBalance', test.nodeList.nodes[0].address, 'latest'))

    // the owner now got the deposit from the
    assert.equal(balanceOwnerAfter - balanceOwnerBefore, unregisterDeposit)
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
      props: '0xff'
    }, {
      url: 'test2.com',
      deposit: 0,
      pk: pk2,
      props: '0xff'
    }], test.chainId, null, test.url, transport, false)

    // register same url servers should not work
    await test.mustFail(
      registerServers(pk1, null, [{
        url: 'test1.com',
        deposit: 0,
        pk: pk1,
        props: '0xff'
      }, {
        url: 'test1.com',
        deposit: 0,
        pk: pk2,
        props: '0xff'
      }], test.chainId, null, test.url, transport, false)
    )

    // register same pk servers should not work
    await test.mustFail(
      registerServers(pk1, null, [{
        url: 'test1.com',
        deposit: 0,
        pk: pk1,
        props: '0xff'
      }, {
        url: 'test2.com',
        deposit: 0,
        pk: pk1,
        props: '0xff'
      }], test.chainId, null, test.url, transport, false)
    )
  })

  /*
  describe('Blockheader contract', () => {

    let blockHashRegAddress
    let block
    let test

    it('deploy blockheader contract', async () => {
      test = await TestTransport.createWithRegisteredServers(2)
      const pk1 = test.getHandlerConfig(0).privateKey
      block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

      const blockNumber = toNumber(block.number)
      blockHashRegAddress = await deployBlockhashRegistry(pk1, test.url)
      const contractBlockHash = "0x" + (await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber]))[0].toString('hex')
      assert.equal(block.hash, contractBlockHash)

    })

    it('getParentAndBlockhash', async () => {

      const b = new Block(block)
      const serializedHeader = b.serializeHeader()


      const contractResult = await tx.callContract(test.url, blockHashRegAddress, 'getParentAndBlockhash(bytes):(bytes32,bytes32)', [serializedHeader])

      const parentHash = "0x" + contractResult[0].toString('hex')
      const blockHash = "0x" + contractResult[1].toString('hex')

      assert.equal(parentHash, ((await test.getFromServer('eth_getBlockByHash', block.parentHash, false)) as BlockData).hash)
      assert.equal(blockHash, block.hash)
    })

    it('snapshot', async () => {
      const user1 = await test.createAccount()
      const user2 = await test.createAccount()


      const txReceipt = (await tx.callContract(test.url, blockHashRegAddress, 'snapshot()', [], { privateKey: user1, to: blockHashRegAddress, value: 0, confirm: true, gas: 5000000 }))
      const blockNumber = (toHex(txReceipt.blockNumber) as any) - 1

      const blockhashRPC = ((await test.getFromServer('eth_getBlockByNumber', toHex(blockNumber), false)) as BlockData).hash
      const blockHashContract = "0x" + (await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber]))[0].toString('hex')

      assert.equal(blockhashRPC, blockHashContract)
    })

    it('calculateBlockheaders', async () => {

      Object.keys(blockHeaderFile).forEach(async (key, index) => {

        const allBlocks = blockHeaderFile[key]

        console.log(key + " # blocks: " + allBlocks.length)

        const firstBlock = allBlocks.shift()

        const startHash = allBlocks[allBlocks.length - 1].hash;

        let serialzedBlocks = [];


        for (const b of allBlocks) {

          const s = new serialize.Block(b as any);

          serialzedBlocks.push(s.serializeHeader());

        }

        serialzedBlocks = serialzedBlocks.reverse()

        const result = (await tx.callContract(test.url, blockHashRegAddress, 'calculateBlockheaders(bytes[],bytes32):(bytes32)', [serialzedBlocks, startHash]))

        const calculatedBock = '0x' + result[0].toString('hex')

        assert.equal(calculatedBock, firstBlock.hash)


        // key: the name of the object key
        // index: the ordinal position of the key within the object 
      });

      /*
      const blocksgoerli30k = blockHeaderFile.goerli30k;

      const firstBlock = blocksgoerli30k.shift();

      const startHash = blocksgoerli30k[blocksgoerli30k.length - 1].hash;

      let serialzedBlocks = [];


      for (const b of blocksgoerli30k) {

        const s = new serialize.Block(b as any);

        serialzedBlocks.push(s.serializeHeader());

      }

      serialzedBlocks = serialzedBlocks.reverse()

      const result = (await tx.callContract(test.url, blockHashRegAddress, 'calculateBlockheaders(bytes[],bytes32):(bytes32)', [serialzedBlocks, startHash]))

      const calculatedBock = '0x' + result[0].toString('hex')

      assert.equal(calculatedBock, firstBlock.hash)


      console.log(Object.keys(blockHeaderFile))

      /**
      ethereumjs-abi
      0xf351cd0a0000000000000000000000000000000000000000000000000000000000000040ca0a09b824ee6e39964817d7db39c8593d235ed676e95a5972b6d560619091110000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000025bf90258a02d3dccc694cd04aebd31d973e9d071befad2fc781c4207441e135b9700c98292a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347940000000000000000000000000000000000000000a01fa2cff1d34fe2062404548f5d330e2bebdcbcb0d06eec3af7ae064a69ac582fa056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b90100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000182733d837a120080845c59da6db861506172697479205465636820417574686f726974790000000000000000000000ce19fe489fd036617a341425d103fac83954f64db2af57cd4e4942e826607ad0554931e02e48a15b885757163133eb36d1f81303b1263e3e6192a2700e65c33201a000000000000000000000000000000000000000000000000000000000000000008800000000000000000000000000
      
      raw
      0xf351cd0a0000000000000000000000000000000000000000000000000000000000000040ca0a09b824ee6e39964817d7db39c8593d235ed676e95a5972b6d560619091110000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000025bf90258a02d3dccc694cd04aebd31d973e9d071befad2fc781c4207441e135b9700c98292a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347940000000000000000000000000000000000000000a01fa2cff1d34fe2062404548f5d330e2bebdcbcb0d06eec3af7ae064a69ac582fa056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b90100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000182733d837a120080845c59da6db861506172697479205465636820417574686f726974790000000000000000000000ce19fe489fd036617a341425d103fac83954f64db2af57cd4e4942e826607ad0554931e02e48a15b885757163133eb36d1f81303b1263e3e6192a2700e65c33201a000000000000000000000000000000000000000000000000000000000000000008800000000000000000000000000000000000000000000000000000000000000000000000000000000000000004030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303230

      web3 
      0xf351cd0a0000000000000000000000000000000000000000000000000000000000000040ca0a09b824ee6e39964817d7db39c8593d235ed676e95a5972b6d5606190911100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000025bf90258a02d3dccc694cd04aebd31d973e9d071befad2fc781c4207441e135b9700c98292a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347940000000000000000000000000000000000000000a01fa2cff1d34fe2062404548f5d330e2bebdcbcb0d06eec3af7ae064a69ac582fa056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b90100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000182733d837a120080845c59da6db861506172697479205465636820417574686f726974790000000000000000000000ce19fe489fd036617a341425d103fac83954f64db2af57cd4e4942e826607ad0554931e02e48a15b885757163133eb36d1f81303b1263e3e6192a2700e65c33201a000000000000000000000000000000000000000000000000000000000000000008800000000000000000000000000
      
      ethers
      0xf351cd0a0000000000000000000000000000000000000000000000000000000000000040ca0a09b824ee6e39964817d7db39c8593d235ed676e95a5972b6d5606190911100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000025bf90258a02d3dccc694cd04aebd31d973e9d071befad2fc781c4207441e135b9700c98292a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347940000000000000000000000000000000000000000a01fa2cff1d34fe2062404548f5d330e2bebdcbcb0d06eec3af7ae064a69ac582fa056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b90100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000182733d837a120080845c59da6db861506172697479205465636820417574686f726974790000000000000000000000ce19fe489fd036617a341425d103fac83954f64db2af57cd4e4942e826607ad0554931e02e48a15b885757163133eb36d1f81303b1263e3e6192a2700e65c33201a000000000000000000000000000000000000000000000000000000000000000008800000000000000000000000000

      encoding
      0xf351cd0a --> function has
      0000000000000000000000000000000000000000000000000000000000000040 --> offset (64 bytes -> #elements)
      ca0a09b824ee6e39964817d7db39c8593d235ed676e95a5972b6d56061909111 --> blockhash
      0000000000000000000000000000000000000000000000000000000000000001 --> # elements in array?
      0000000000000000000000000000000000000000000000000000000000000020 --> # elements in bytes-array?
      000000000000000000000000000000000000000000000000000000000000025b --> --> length -> 603
      f90258a02d3dccc694cd04aebd31d973e9d071befad2fc781c4207441e135b9700c98292a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347940000000000000000000000000000000000000000a01fa2cff1d34fe2062404548f5d330e2bebdcbcb0d06eec3af7ae064a69ac582fa056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b90100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000182733d837a120080845c59da6db861506172697479205465636820417574686f726974790000000000000000000000ce19fe489fd036617a341425d103fac83954f64db2af57cd4e4942e826607ad0554931e02e48a15b885757163133eb36d1f81303b1263e3e6192a2700e65c33201a000000000000000000000000000000000000000000000000000000000000000008800000000000000000000000000
      
      */

  /*
  console.log("ethers")
  console.log(ethers.utils.defaultAbiCoder.encode(["bytes[]", "bytes32"], [serialzedBlocks, startHash]))

  console.log('serializedBlocks');
  console.log(serialzedBlocks);
  console.log(serialzedBlocks.length);
  console.log('\nstartHash');
  console.log(startHash);
  console.log('');
  //  console.log(serialzedBlocks)
  

})

})  */
})

