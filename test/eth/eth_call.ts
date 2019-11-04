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
import { BlockData, util, LogData } from 'in3-common'
import { RPCResponse, Proof } from '../../src/types/types'
import { TestTransport, getTestClient } from '../utils/transport'
import { deployContract } from '../../src/util/registry';
import * as tx from '../../src/util/tx'
import * as clientRPC from '../utils/clientRPC'
const toHex = util.toHex
const getAddress = util.getAddress
const toNumber = util.toNumber

// our test private key
const pk = '0xb903239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238'


describe('eth_call', () => {


  it('getBalance', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1, includeCode: true })

    // create a account with 500 wei
    const user = await test.createAccount(undefined, 500).then(_ => _.address)


    // check deployed code
    const adr = await deployContract('TestContract', await test.createAccount(), getTestClient())

    const balance = toNumber(await test.getFromServer('eth_getBalance', user, 'latest'))

    const response = await clientRPC.callContractWithClient(client, adr, 'getBalance(address)', user)

    assert.equal(balance, 500)
    assert.equal(toNumber(response.result), 500)

    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      re.result = '0x09'
      return re
    })

    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'getBalance(address)', user))


    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = re.in3.proof.accounts
      // remove an account from proof
      delete ac[Object.keys(ac)[1]]
      return re
    })

    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'getBalance(address)', user))

    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = Object.values(re.in3.proof.accounts)[0]
      // remove an account from proof
      ac.nonce += '0'
      return re
    })

    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'getBalance(address)', user))

  })


  it('testInternCall', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1, includeCode: true })

    const pk1 = await test.createAccount(undefined, 500)
    const pk2 = await test.createAccount(undefined, 1500)

    // create a account with 500 wei
    const user = await test.createAccount(undefined, 500).then(_ => _.address)


    // check deployed code
    const adr1 = await deployContract('TestContract', pk1, getTestClient())
    const adr2 = await deployContract('TestContract', pk1, getTestClient())

    // increment the counter only on adr1
    await tx.callContract(test.url, adr1, 'increase()', [], { confirm: true, privateKey: pk1, gas: 3000000, value: 0 })


    // call a function of adr2 which then should call adr1
    //    function testInternCall(TestContract adr)  public view returns(uint){
    //      return adr.counter();
    //    }
    const response = await clientRPC.callContractWithClient(client, adr2, 'testInternCall(address)', adr1)
    assert.equal(toNumber(response.result), 1)

    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      re.result = '0x09'
      return re
    })
    await test.mustFail(clientRPC.callContractWithClient(client, adr2, 'testInternCall(address)', adr1))


    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = re.in3.proof.accounts
      // remove an account from proof
      delete ac[Object.keys(ac)[1]]
      return re
    })
    await test.mustFail(clientRPC.callContractWithClient(client, adr2, 'testInternCall(address)', adr1))


  })


  it('testBlockHash', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1, includeCode: true })

    // deploy testcontract
    const adr = await deployContract('TestContract', await test.createAccount(), getTestClient())
    const block = (await test.getFromServer('eth_getBlockByNumber', 'latest', false)) as BlockData

    const response = await clientRPC.callContractWithClient(client, adr, 'getBlockHash(uint)', toNumber(block.number))

    // TODO why is this returning 0x0?
    //    assert.equal(toHex(response.result, 32), toHex(block.hash, 32))


  })


  it('testExtCodeCopy', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1, includeCode: true })

    // deploy testcontract
    const pk = await test.createAccount()
    const adr = await deployContract('TestContract', pk, getTestClient())
    const adr2 = await deployContract('TestContract', pk, getTestClient())

    const response = await clientRPC.callContractWithClient(client, adr, 'getCodeAt(address)', adr2)

    // make sure the proof included the accountProof for adr2, since this was referenced
    assert.isTrue(response.in3.proof.accounts[toHex(adr2.toLowerCase(), 20)].accountProof.length > 0)

    // try to get the code from a non-existent account, so the merkleTree should prove it's not esiting
    const responseEmpty = await clientRPC.callContractWithClient(client, adr, 'getCodeAt(address)', "0x" + util.toBuffer(123, 20).toString('hex'))


    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = re.in3.proof.accounts
      // remove an account from proof
      delete ac[Object.keys(ac)[1]]
      return re
    })
    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'getCodeAt(address)', adr2))


    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = re.in3.proof.accounts
      // remove the target account 
      delete ac[util.toMinHex(adr2.toLowerCase())]
      // and change the result to a empty-value
      re.result = '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000'
      return re
    })
    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'getCodeAt(address)', adr2))



  })


  it('testDelegateCall', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1, includeCode: true })

    // deploy testcontract
    const pk = await test.createAccount()
    const adr = await deployContract('TestContract', pk, getTestClient())
    const adr2 = await deployContract('TestContract', pk, getTestClient())

    const response = await clientRPC.callContractWithClient(client, adr, 'testDelegateCall(address)', adr2)

    // make sure the proof included the accountProof for adr2, since this was referenced
    assert.isTrue(response.in3.proof.accounts[toHex(adr2.toLowerCase(), 20)].accountProof.length > 0)



    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = re.in3.proof.accounts
      // remove the target account 
      delete ac[util.toMinHex(adr2.toLowerCase())]
      // and change the result to a empty-value
      re.result = '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000'
      return re
    })
    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'testDelegateCall(address)', adr2))


  })




  it('testCall', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1, includeCode: true })

    // deploy testcontract
    const pk = await test.createAccount()
    const adr = await deployContract('TestContract', pk, getTestClient())
    const adr2 = await deployContract('TestContract', pk, getTestClient())

    const response = await clientRPC.callContractWithClient(client, adr, 'testCall(address)', adr2)

    // make sure the proof included the accountProof for adr2, since this was referenced
    assert.isTrue(response.in3.proof.accounts[toHex(adr2.toLowerCase(), 20)].accountProof.length > 0)



    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = re.in3.proof.accounts
      // remove the target account 
      delete ac[util.toMinHex(adr2.toLowerCase())]
      // and change the result to a empty-value
      re.result = '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000'
      return re
    })
    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'testCall(address)', adr2))


  })



  it('testCallCode', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: 'standard', requestCount: 1, includeCode: true })

    // deploy testcontract
    const pk = await test.createAccount()
    const adr = await deployContract('TestContract', pk, getTestClient())
    const adr2 = await deployContract('TestContract', pk, getTestClient())

    const response = await clientRPC.callContractWithClient(client, adr, 'testCallCode(address)', adr2)

    // make sure the proof included the accountProof for adr2, since this was referenced
    assert.isTrue(response.in3.proof.accounts[toHex(adr2.toLowerCase(), 20)].accountProof.length > 0)



    client.clearStats()
    test.clearInjectedResponsed()
    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      const ac = re.in3.proof.accounts
      // remove the target account 
      delete ac[util.toMinHex(adr2.toLowerCase())]
      // and change the result to a empty-value
      re.result = '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000'
      return re
    })
    await test.mustFail(clientRPC.callContractWithClient(client, adr, 'testCallCode(address)', adr2))


  })

  it('eth_call Gas Limit', async () => {

    let test = new TestTransport(1) // create a network of 1 nodes

    // check deployed code
    const adr = await deployContract('TestContract', await test.createAccount(), getTestClient())

    const signature = 'encodingTest(bytes[],bytes32):(bytes32,bytes[])'
    const data = '0x' + tx.encodeFunction(signature, [['0xabcd', '0xcdef'], "0x5b465c871cd5dbb1949ae0a8a34a5c5ab1e72edbc2c0d1bedfb9234c4339ac20"])

    // create a account with 500 wei
    const user = getAddress(await test.createAccount(undefined, 500))

    let res = await test.handle("#1", {
      jsonrpc: "2.0",
      method: "eth_call",
      params: [
        {
          from: user,
          to: adr,
          data: data,
          gas: "0x55D4A80"
        },
        "latest"
      ],
      id: 1
    }) as RPCResponse

    assert.isUndefined(res.result)
    assert.isTrue(res.error.includes("eth_call with a gaslimit > 10000000 are not allowed"))

    let res2 = await test.handle("#1", {
      jsonrpc: "2.0",
      method: "eth_call",
      params: [
        {
          from: user,
          to: adr,
          data: data,
          gas: "0x989680" //boundary check, 10M
        },
        "latest"
      ],
      id: 1
    }) as RPCResponse

    assert.isUndefined(res2.error)

    let res3 = await test.handle("#1", {
      jsonrpc: "2.0",
      method: "eth_call",
      params: [
        {
          from: user,
          to: adr,
          data: data
        },
        "latest"
      ],
      id: 1
    }) as RPCResponse
    
    assert.isUndefined(res3.error)

  })



})

