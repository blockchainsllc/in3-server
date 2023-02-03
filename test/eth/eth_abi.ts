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
import { resetSupport } from '../../src/modules/eth/proof'
import * as serialize from '../../src/modules/eth/serialize'
import { BlockData, LogData } from '../../src/modules/eth/serialize'
import { Proof, RPCResponse } from '../../src/types/types'
import { deployContract } from '../../src/util/registry'
import * as tx from '../../src/util/tx'
import * as util from '../../src/util/util'
import * as logger from '../utils/memoryLogger'
import { getTestClient, TestTransport } from '../utils/transport'

const toHex = util.toHex
const toMinHex = util.toMinHex
const toNumber = util.toNumber

describe('ETH Standard JSON-RPC', () => {

  beforeEach(resetSupport)
  it('eth_blockNumber', async () => {
    const test = new TestTransport(1) // create a network of 3 nodes
    const client = await test.createClient()

    logger.info('3 different blocknumbers should result in the highest')

    // 3 different blocknumbers
    test.injectResponse({ method: 'eth_blockNumber' }, { result: '0x4' }, 'http://avalid.url/#1') // second node says 4


    // but we also ask for 3 answers
    const result = await client.eth.blockNumber()

    // so we must get the highest one
    assert.equal(result, 4)
  })

  it('eth_getTransactionByHash', async () => {
    const test = new TestTransport(3) // create a network of 3 nodes
    const client = await test.createClient({ proof: 'standard', requestCount: 1 })
    // create 2 accounts
    const pk1 = await test.createAccount('0x01')
    const pk2 = await test.createAccount('0x02')
    // send 1000 wei from a to b
    const receipt = await tx.sendTransaction(test.url, {
      privateKey: pk1,
      gas: 22000,
      to: pk2.address,
      data: '',
      value: 1000,
      confirm: true
    })

    const result = await client.in3.sendRPC('eth_getTransactionByHash', [receipt.transactionHash])

    const b = await client.in3.sendRPC('eth_getBlockByNumber', [result.blockNumber, true])
    logger.info('found Block:', b)
    const block = new serialize.Block(b)

    assert.equal('0x' + block.hash().toString('hex').toLowerCase(), (result as any).blockHash, 'the hash of the blockheader in the proof must be the same as the blockHash in the Transactiondata')

    // check blocknumber
    assert.equal(parseInt('0x' + block.number.toString('hex')), parseInt(result.blockNumber), 'we must use the same blocknumber as in the transactiondata')

    logger.info('result', result)

    await test.detectFraud(client, 'eth_getTransactionByHash', [receipt.transactionHash], null, (_req, re) => {
      re.result.to = re.result.from
    })

  })

  it('eth_getTransactionByBlockHashAndIndex', async () => {
    const test = new TestTransport(3) // create a network of 3 nodes
    const client = await test.createClient({ proof: 'standard', requestCount: 1 })

    // create 2 accounts
    const pk1 = await test.createAccount('0x01')
    const pk2 = await test.createAccount('0x02')

    // send 1000 wei from a to b
    const receipt = await tx.sendTransaction(test.url, {
      privateKey: pk1,
      gas: 22000,
      to: pk2.address,
      data: '',
      value: 1000,
      confirm: true
    })

    const result = await client.in3.sendRPC('eth_getTransactionByBlockHashAndIndex', [receipt.blockHash, receipt.transactionIndex])

    const b = await client.in3.sendRPC('eth_getBlockByHash', [receipt.blockHash, true])
    logger.info('found Block:', b)
    const block = new serialize.Block(b)

    assert.equal('0x' + block.hash().toString('hex').toLowerCase(), (result as any).blockHash, 'the hash of the blockheader in the proof must be the same as the blockHash in the Transactiondata')

    // check blocknumber
    assert.equal(parseInt('0x' + block.number.toString('hex')), parseInt(result.blockNumber), 'we must use the same blocknumber as in the transactiondata')

    logger.info('result', result)

    await test.detectFraud(client, 'eth_getTransactionByHash', [receipt.transactionHash], null, (_req, re) => {
      re.result.to = re.result.from
    })

  })

  it('eth_getTransactionByBlockNumberAndIndex', async () => {
    const test = new TestTransport(3) // create a network of 3 nodes
    const client = await test.createClient({ proof: 'standard', requestCount: 1 })

    // create 2 accounts
    const pk1 = await test.createAccount('0x01')
    const pk2 = await test.createAccount('0x02')

    // send 1000 wei from a to b
    const receipt = await tx.sendTransaction(test.url, {
      privateKey: pk1,
      gas: 22000,
      to: pk2.address,
      data: '',
      value: 1000,
      confirm: true
    })

    const result = await client.in3.sendRPC('eth_getTransactionByBlockNumberAndIndex', [receipt.blockNumber, receipt.transactionIndex])

    const b = await client.in3.sendRPC('eth_getBlockByNumber', [receipt.blockNumber, true])
    logger.info('found Block:', b)
    const block = new serialize.Block(b)

    assert.equal('0x' + block.hash().toString('hex').toLowerCase(), (result as any).blockHash, 'the hash of the blockheader in the proof must be the same as the blockHash in the Transactiondata')

    // check blocknumber
    assert.equal(parseInt('0x' + block.number.toString('hex')), parseInt(result.blockNumber), 'we must use the same blocknumber as in the transactiondata')

    logger.info('result', result)

    await test.detectFraud(client, 'eth_getTransactionByHash', [receipt.transactionHash], null, (_req, re) => {
      re.result.to = re.result.from
    })
  })

  it('eth_getTransactionByBlockHashAndIndex(failing)', async () => {
    const test = new TestTransport(3) // create a network of 3 nodes
    const client = await test.createClient({ proof: 'standard', requestCount: 1 })

    // create 2 accounts
    const pk1 = await test.createAccount('0x01')
    const pk2 = await test.createAccount('0x02')

    // send 1000 wei from a to b
    const receipt = await tx.sendTransaction(test.url, {
      privateKey: pk1,
      gas: 22000,
      to: pk2.address,
      data: '',
      value: 1000,
      confirm: true
    })

    const result = await client.in3.sendRPC('eth_getTransactionByBlockHashAndIndex', [receipt.blockHash, toMinHex(toNumber(receipt.transactionIndex) + 1)])
    assert.isNull(result)

    const b = await client.in3.sendRPC('eth_getBlockByHash', [receipt.blockHash, true])
    logger.info('found Block:', b)
    assert.isNotNull(b)
    assert.notExists(b.transactions[toNumber(receipt.transactionIndex) + 1])

  })

  it('eth_getTransactionByBlockNumberAndIndex(failing)', async () => {
    const test = new TestTransport(3) // create a network of 3 nodes
    const client = await test.createClient({ proof: 'standard', requestCount: 1 })

    // create 2 accounts
    const pk1 = await test.createAccount('0x01')
    const pk2 = await test.createAccount('0x02')

    // send 1000 wei from a to b
    const receipt = await tx.sendTransaction(test.url, {
      privateKey: pk1,
      gas: 22000,
      to: pk2.address,
      data: '',
      value: 1000,
      confirm: true
    })

    const result = await client.in3.sendRPC('eth_getTransactionByBlockNumberAndIndex', [receipt.blockNumber, toMinHex(toNumber(receipt.transactionIndex) + 1)])
    assert.isNull(result)

    const b = await client.in3.sendRPC('eth_getBlockByNumber', [receipt.blockNumber, true])
    logger.info('found Block:', b)
    assert.isNotNull(b)
    assert.notExists(b.transactions[toNumber(receipt.transactionIndex) + 1])
  })

  it('eth_getTransactionReceipt', async () => {
    const test = new TestTransport(3) // create a network of 3 nodes
    const client = await test.createClient({ proof: 'full', requestCount: 1 })

    // create 2 accounts
    const pk1 = await test.createAccount('0x01')
    await test.createAccount('0x02')

    // check deployed code
    const adr = await deployContract('TestContract', pk1, getTestClient())
    const receipt = await tx.callContract(getTestClient(), adr, 'increase()', [], {
      confirm: true,
      privateKey: pk1,
      gas: 3000000,
      value: 0
    })

    assert.equal(receipt.logs.length, 1)

    const result = await client.in3.sendRPC('eth_getTransactionReceipt', [receipt.transactionHash])
    const result1 = await client.in3.sendRPC('eth_getTransactionReceipt', [receipt.transactionHash])
    assert.deepEqual(result, result1)

    const b = await client.in3.sendRPC('eth_getBlockByNumber', [result.blockNumber, true])
    logger.info('found Block:', b)
    const block = new serialize.Block(b)

    assert.equal('0x' + block.hash().toString('hex').toLowerCase(), (result as any).blockHash, 'the hash of the blockheader in the proof must be the same as the blockHash in the Transactiondata')

    // check blocknumber
    assert.equal(parseInt('0x' + block.number.toString('hex')), parseInt(result.blockNumber), 'we must use the same blocknumber as in the transactiondata')

    logger.info('result', result)

    await test.detectFraud(client, 'eth_getTransactionReceipt', [receipt.transactionHash], null, (_req, re) => {
      re.result.cumulativeGasUsed += '00'
    })

    // await test.detectFraud(client, 'eth_getTransactionReceipt', [receipt.transactionHash], null, (_req, re) => {
    //   re.result.gasUsed += '00'
    // })
  })

  it('eth_getBlockByNumber', async () => {
    const test = new TestTransport(1) // create a network of 3 nodes
    const client = await test.createClient({ proof: 'standard', requestCount: 1 })

    // create 2 accounts
    const pk1 = await test.createAccount('0x01')

    // send 1000 wei from a to b
    await tx.sendTransaction(test.url, {
      privateKey: pk1,
      gas: 22000,
      to: pk1.address.substr(0, 34) + 'FFFFFFFF', // any address, we just need a simple transaction in the last block
      data: '',
      value: 1000,
      confirm: true
    })

    // get the last Block
    await client.in3.sendRPC('eth_getBlockByNumber', ['latest', false])
    const b = await client.in3.sendRPC('eth_getBlockByNumber', ['latest', true])
    const block = new serialize.Block(b)

    assert.equal('0x' + block.hash().toString('hex').toLowerCase(), (b as any as BlockData).hash, 'the hash of the blockheader in the proof must be the same as the blockHash in the Transactiondata')

    await test.detectFraud(client, 'eth_getBlockByNumber', [(b as BlockData).number, true], null, (_req, re) => {
      (re.result as any).gasUsed = (re.result as any).gasLimit
    })
  })

  it('eth_getBlockByHash', async () => {
    const test = new TestTransport(3) // create a network of 3 nodes
    const client = await test.createClient({ proof: 'standard', requestCount: 1 })

    // create 2 accounts
    const pk1 = await test.createAccount('0x01')

    // send 1000 wei from a to b
    const receipt = await tx.sendTransaction(test.url, {
      privateKey: pk1,
      gas: 22000,
      to: pk1.address.substr(0, 34) + 'FFFFFFFF', // any address, we just need a simple transaction in the last block
      data: '',
      value: 1000,
      confirm: true
    })

    // get the last Block
    const b = await client.in3.sendRPC('eth_getBlockByHash', [receipt.blockHash, true])
    const block = new serialize.Block(b)

    assert.equal('0x' + block.hash().toString('hex').toLowerCase(), receipt.blockHash, 'the hash of the blockheader in the proof must be the same as the blockHash in the Transactiondata')


    let failed = false
    try {
      // now manipulate the result
      test.injectResponse({ method: 'eth_getBlockByHash' }, (_req, re: RPCResponse) => {
        // we change a property
        (re.result as any).gasUsed = (re.result as any).gasLimit
        return re
      })
      await client.in3.sendRPC('eth_getBlockByHash', [receipt.blockHash, true])
    }
    catch {
      failed = true
    }
    assert.isTrue(failed, 'The manipulated block must fail!')
  })


  it('eth_getBalance', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1 })

    // create 2 accounts
    const pk1 = await test.createAccount('0x01')
    const adr = pk1.address

    // get the last Block
    const b = await client.in3.sendRPC('eth_getBalance', [adr, 'latest'])

    let failed = false
    try {
      // now manipulate the result
      test.injectResponse({ method: 'eth_getBalance' }, (_req, re: RPCResponse) => {
        // we change the returned balance
        re.result = re.result + '00'
        return re
      })
      await client.in3.sendRPC('eth_getBalance', [adr, 'latest'])
    }
    catch {
      failed = true
    }
    assert.isTrue(failed, 'The manipulated balance must fail!')
    test.clearInjectedResponses()

    // we need to create a new client since the old node is blacklisted
    test = new TestTransport(1) // create a network of 3 nodes
    client = await test.createClient({ proof: 'standard', requestCount: 1 })

    failed = false
    try {
      // now manipulate the result
      test.injectResponse({ method: 'eth_getBalance' }, (_req, re: RPCResponse) => {
        // we change the returned balance and the value in the proof
        (re.in3.proof as any).account.balance = re.result + '00';
        re.result = re.result + '00'
        return re
      })
      await client.in3.sendRPC('eth_getBalance', [adr, 'latest'])
    }
    catch {
      failed = true
    }
    assert.isTrue(failed, 'The manipulated balance must fail!')
  })

  it('eth_getTransactionCount', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1 })

    // create 2 accounts
    const pk1 = await test.createAccount('0x01')
    const adr = pk1.address

    // get the last Block
    await client.in3.sendRPC('eth_getTransactionCount', [adr, 'latest'])

    let failed = false
    try {
      // now manipulate the result
      test.injectResponse({ method: 'eth_getTransactionCount' }, (_req, re: RPCResponse) => {
        // we change the returned balance
        re.result = re.result + '00'
        return re
      })
      await client.in3.sendRPC('eth_getTransactionCount', [adr, 'latest'])
    }
    catch {
      failed = true
    }
    assert.isTrue(failed, 'The manipulated nonce must fail!')
    test.clearInjectedResponses()

    // we need to create a new client since the old node is blacklisted
    test = new TestTransport(1) // create a network of 3 nodes
    client = await test.createClient({ proof: 'standard', requestCount: 1 })

    failed = false
    try {
      // now manipulate the result
      test.injectResponse({ method: 'eth_getTransactionCount' }, (_req, re: RPCResponse) => {
        // we change the returned balance and the value in the proof
        (re.in3.proof as any).account.balance = re.result + '00';
        re.result = re.result + '00'
        return re
      })
      await client.in3.sendRPC('eth_getTransactionCount', [adr, 'latest'])
    }
    catch {
      failed = true
    }
    assert.isTrue(failed, 'The manipulated nonce must fail!')
  })



  it('eth_getCode', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1 })

    // create 2 accounts
    const pk1 = await test.createAccount('0x01')

    // check empty code
    await client.in3.sendRPC('eth_getCode', [pk1.address, 'latest'])

    // check deployed code
    const adr = await deployContract('TestContract', pk1, getTestClient())
    await client.in3.sendRPC('eth_getCode', [adr, 'latest'])

    let failed = false
    try {
      // now manipulate the result
      test.injectResponse({ method: 'eth_getCode' }, (_req, re: RPCResponse) => {
        // we change the returned balance
        re.result = re.result + '00'
        return re
      })
      await client.in3.sendRPC('eth_getCode', [adr, 'latest'])
    }
    catch {
      failed = true
    }
    assert.isTrue(failed, 'The manipulated nonce must fail!')
    test.clearInjectedResponses()

    // we need to create a new client since the old node is blacklisted
    test = new TestTransport(1) // create a network of 3 nodes
    client = await test.createClient({ proof: 'standard', requestCount: 1 })

    failed = false
    try {
      // now manipulate the result
      test.injectResponse({ method: 'eth_getCode' }, (_req, re: RPCResponse) => {
        // we change the returned balance and the value in the proof
        (re.in3.proof as any).account.balance = re.result + '00';
        re.result = re.result + '00'
        return re
      })
      await client.in3.sendRPC('eth_getCode', [adr, 'latest'])
    }
    catch {
      failed = true
    }
    assert.isTrue(failed, 'The manipulated code must fail!')
  })



  it('eth_getStorageAt', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1 })

    // create 2 accounts
    const pk1 = await test.createAccount()

    // check deployed code
    const adr = await deployContract('TestContract', pk1, getTestClient())
    await tx.callContract(getTestClient(), adr, 'increase()', [], {
      confirm: true,
      privateKey: pk1,
      gas: 3000000,
      value: 0
    })


    const result = await client.in3.sendRPC('eth_getStorageAt', [adr, '0x0', 'latest'])
    assert.equal(toHex(result), '0x01')


    let failed = false
    try {
      // now manipulate the result
      test.injectResponse({ method: 'eth_getStorageAt' }, (_req, re: RPCResponse) => {
        // we change the returned balance
        re.result = '0x09'
        return re
      })
      await client.in3.sendRPC('eth_getStorageAt', [adr, '0x0', 'latest'])
    }
    catch {
      failed = true
    }
    assert.isTrue(failed, 'The manipulated nonce must fail!')

    test = new TestTransport(1) // create a network of 3 nodes
    client = await test.createClient({ proof: 'standard', requestCount: 1 })

    failed = false
    try {
      // now manipulate the result
      test.injectResponse({ method: 'eth_getStorageAt' }, (_req, re: RPCResponse) => {
        // we change the returned balance
        re.result = '0x09';
        (re.in3.proof as any).account.storageProof[0].value = re.result
        return re
      })
      await client.in3.sendRPC('eth_getStorageAt', [adr, '0x00', 'latest'])
    }
    catch {
      failed = true
    }
    assert.isTrue(failed, 'The manipulated nonce must fail!')
  })


  it('eth_getBlockTransactionCountByNumber', async () => {
    const test = new TestTransport(1) // create a network of 3 nodes
    const client = await test.createClient({ proof: 'standard', requestCount: 1 })

    // create 2 accounts
    const pk1 = await test.createAccount('0x01')

    // send 1000 wei from a to b
    await tx.sendTransaction(test.url, {
      privateKey: pk1,
      gas: 22000,
      to: pk1.address.substr(0, 34) + 'FFFFFFFF', // any address, we just need a simple transaction in the last block
      data: '',
      value: 1000,
      confirm: true
    })

    // get the last Block
    const latest = await client.eth.blockNumber()
    const b1 = await client.eth.getBlockTransactionCountByNumber(latest)
    assert.equal(b1, toNumber('0x1'))

    let failed = false
    try {
      // now manipulate the result
      test.injectResponse({ method: 'eth_getBlockTransactionCountByNumber' }, (_req, re: RPCResponse) => {
        // we change a property
        re.result = '0x04'
        return re
      })
      await client.in3.sendRPC('eth_getBlockTransactionCountByNumber', ['latest'])
    }
    catch {
      failed = true
    }
    assert.isTrue(failed, 'The manipulated block must fail!')
  })

  it('eth_getBlockTransactionCountByHash', async () => {
    const test = new TestTransport(1) // create a network of 3 nodes
    const client = await test.createClient({ proof: 'standard', requestCount: 1 })

    // create 2 accounts
    const pk1 = await test.createAccount('0x01')

    // send 1000 wei from a to b
    await tx.sendTransaction(test.url, {
      privateKey: pk1,
      gas: 22000,
      to: pk1.address.substr(0, 34) + 'FFFFFFFF', // any address, we just need a simple transaction in the last block
      data: '',
      value: 1000,
      confirm: true
    })

    const block = await client.in3.sendRPC('eth_getBlockByNumber', ['latest', false])

    // get the last Block
    const b1 = await client.eth.getBlockTransactionCountByHash(block.hash)
    assert.equal(b1, toNumber('0x1'))

    let failed = false
    try {
      // now manipulate the result
      test.injectResponse({ method: 'eth_getBlockTransactionCountByHash' }, (_req, re: RPCResponse) => {
        // we change a property
        re.result = '0x04'
        return re
      })
      await client.eth.getBlockTransactionCountByHash(block.hash)
    }
    catch {
      failed = true
    }
    assert.isTrue(failed, 'The manipulated block must fail!')
  })

  it('eth_call', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1, includeCode: true })

    // create 2 accounts
    const pk1 = await test.createAccount()

    // check deployed code
    const adr = await deployContract('TestContract', pk1, getTestClient())

    // check deployed code
    const adr2 = await deployContract('TestContract', pk1, getTestClient())

    // increase the count
    await tx.callContract(getTestClient(), adr, 'increase()', [], {
      confirm: true,
      privateKey: pk1,
      gas: 3000000,
      value: 0
    })

    // increase the count
    await tx.callContract(getTestClient(), adr2, 'increase()', [], {
      confirm: true,
      privateKey: pk1,
      gas: 3000000,
      value: 0
    })

    const txArgs = {
      from: pk1.address,
      to: adr,
      data: '0x61bc221a'
    }

    const result1 = await client.in3.sendRPC('eth_call', [{ from: txArgs.from, to: adr2, data: '0x' + tx.encodeFunction('add(address)', [adr]) }, 'latest'])
    assert.equal(toHex(result1), '0x0000000000000000000000000000000000000000000000000000000000000002')


    const result = await client.in3.sendRPC('eth_call', [txArgs, 'latest'])
    assert.equal(toHex(result), '0x0000000000000000000000000000000000000000000000000000000000000001')


    let failed = false
    try {
      // now manipulate the result
      test.injectResponse({ method: 'eth_call' }, (_req, re: RPCResponse) => {
        // we change the returned balance
        re.result = '0x09'
        return re
      })
      await client.in3.sendRPC('eth_call', [txArgs, 'latest'])
    }
    catch {
      failed = true
    }
    assert.isTrue(failed, 'The manipulated nonce must fail!')

    test = new TestTransport(1) // create a network of 3 nodes
    client = await test.createClient({ proof: 'standard', requestCount: 1 })

    failed = false
    try {
      // now manipulate the result
      test.injectResponse({ method: 'eth_getStorageAt' }, (_req, re: RPCResponse) => {
        // we change the returned balance
        re.result = '0x09';
        (re.in3.proof as any).account.storageProof[0].value = re.result
        return re
      })
      await client.in3.sendRPC('eth_getStorageAt', [adr, '0x00', 'latest'])
    }
    catch {
      failed = true
    }
    assert.isTrue(failed, 'The manipulated nonce must fail!')
  })

  it('eth_getLogs', async () => {
    const test = new TestTransport(3) // create a network of 3 nodes
    const client = await test.createClient({ proof: 'standard', requestCount: 1, signatureCount: 1 })

    // create 2 accounts
    const pk1 = await test.createAccount('0x01')

    // check deployed code
    const adr = await deployContract('TestContract', pk1, getTestClient())
    const receipt = await tx.callContract(getTestClient(), adr, 'increase()', [], {
      confirm: true,
      privateKey: pk1,
      gas: 3000000,
      value: 0
    })

    assert.equal(receipt.logs.length, 1)

    const res = await client.in3.sendRPC('eth_getLogs', [{ fromBlock: util.toMinHex(receipt.blockNumber) }])
    logger.info('result', res)

    let failed = false
    try {
      // now manipulate the result
      test.injectResponse({ method: 'eth_getLogs' }, (_req, re: RPCResponse) => {
        // we change a property
        ((re.result as any)[0] as LogData).address = pk1.address
        return re
      })
      await client.in3.sendRPC('eth_getLogs', [{ fromBlock: util.toMinHex(receipt.blockNumber) }])
    }
    catch {
      failed = true
    }
    assert.isTrue(failed, 'The manipulated transaction must fail!')
  })


  it('eth_newBlockFilter', async () => {
    const test = new TestTransport(3) // create a network of 3 nodes
    const client = await test.createClient({ proof: 'standard', requestCount: 1 })

    // current blockNumber
    await client.in3.sendRPC('eth_blockNumber', []).then(_ => parseInt(_.result as any))

    // create filter
    const filterId = await client.in3.sendRPC('eth_newBlockFilter', [])

    // first call should return an empty array
    let changes = await client.in3.sendRPC('eth_getFilterChanges', [filterId])
    assert.equal(changes.length, 0)

    // create an accounts, which creates an block, so the filter should give us now 1 block.
    await test.createAccount('0x01')

    // now we should receive a new BlockHash
    changes = await client.in3.sendRPC('eth_getFilterChanges', [filterId])
    assert.equal(changes.length, 1)

    // but the second call should not return anything since no new blocks were produced
    changes = await client.in3.sendRPC('eth_getFilterChanges', [filterId])
    assert.equal(changes.length, 0)

  })

  it('eth_getFilterChanges', async () => {
    const test = new TestTransport(3) // create a network of 3 nodes
    const client = await test.createClient({ proof: 'standard', requestCount: 1 })

    // current blockNumber
    await client.in3.sendRPC('eth_blockNumber', []).then(_ => parseInt(_.result as any))

    // create filter
    const filterId = await client.in3.sendRPC('eth_newBlockFilter', [])

    // first call should return an empty array
    let changes = await client.in3.sendRPC('eth_getFilterChanges', [filterId])
    assert.equal(changes.length, 0)

    // create an accounts, which creates an block, so the filter should give us now 1 block.
    await test.createAccount('0x01')

    // now we should receive a new BlockHash
    changes = await client.in3.sendRPC('eth_getFilterChanges', [filterId])
    assert.equal(changes.length, 1)

    // current blockNumber
    const block = await client.in3.sendRPC('eth_getBlockByNumber', ['latest', false])
    assert.equal(changes[0], block.hash)

    // but the second call should not return anything since no new blocks were produced
    changes = await client.in3.sendRPC('eth_getFilterChanges', [filterId])
    assert.equal(changes.length, 0)

  })


  it('eth_newFilter', async () => {
    const test = new TestTransport(3) // create a network of 3 nodes
    const client = await test.createClient({ proof: 'standard', requestCount: 1 })
    // create 2 accounts
    const pk1 = await test.createAccount('0x01')

    // check deployed code
    const address = await deployContract('TestContract', pk1, getTestClient())

    // current blockNumber
    await client.in3.sendRPC('eth_blockNumber', []).then(_ => parseInt(_.result as any))

    // create filter for all events from the deployed contracts
    const filterId = await client.in3.sendRPC('eth_newFilter', [{ address }])

    // first call should return an empty array
    let changes = await client.in3.sendRPC('eth_getFilterChanges', [filterId])
    assert.equal(changes.length, 0)

    // now run a transaction and trigger an event
    await tx.callContract(getTestClient(), address, 'increase()', [], {
      confirm: true,
      privateKey: pk1,
      gas: 3000000,
      value: 0
    })

    // this filter should now return the event
    changes = await client.in3.sendRPC('eth_getFilterChanges', [filterId])
    assert.equal(changes.length, 1)

    // this filter should now an empty []
    changes = await client.in3.sendRPC('eth_getFilterChanges', [filterId])
    assert.equal(changes.length, 0)

  })


  it('eth_uninstallFilter', async () => {
    const test = new TestTransport(3) // create a network of 3 nodes
    const client = await test.createClient({ proof: 'standard', requestCount: 1 })

    // create filter
    const filterId = await client.in3.sendRPC('eth_newBlockFilter', [])

    let changes = await client.in3.sendRPC('eth_getFilterChanges', [filterId])
    assert.equal(changes.length, 0)

    assert.equal(await client.in3.sendRPC('eth_uninstallFilter', [filterId]), true)
    assert.equal(await client.in3.sendRPC('eth_uninstallFilter', [filterId]), false)
  })


})
