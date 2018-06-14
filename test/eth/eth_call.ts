
import { assert } from 'chai'
import 'mocha'
import { serialize, BlockData, RPCResponse, util, Proof, LogData } from 'in3'
import { TestTransport } from '../utils/transport'
import { deployChainRegistry, registerServers, deployContract } from '../../src/util/registry';
import * as tx from '../../src/util/tx'
import * as logger from 'in3/js/test/util/memoryLogger'
import { simpleEncode } from 'ethereumjs-abi'
const toHex = util.toHex
const getAddress = util.getAddress
const toNumber = util.toNumber

// our test private key
const pk = '0xb903239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238'


describe('eth_call', () => {


  it('getBalance', async () => {
    let test = new TestTransport(1) // create a network of 3 nodes
    let client = await test.createClient({ proof: true, requestCount: 1 })

    // create a account with 500 wei
    const user = getAddress(await test.createAccount(undefined, 500))


    // check deployed code
    const adr = await deployContract('TestContract', await test.createAccount())

    const balance = toNumber(await test.getFromServer('eth_getBalance', user, 'latest'))

    const response = await tx.callContractWithClient(client, adr, 'getBalance(address)', user)

    assert.equal(balance, 500)
    assert.equal(toNumber(response.result), 500)

    // now manipulate the result
    test.injectResponse({ method: 'eth_call' }, (req, re: RPCResponse) => {
      // we change the returned balance
      re.result = '0x09'
      return re
    })

    await test.mustFail(tx.callContractWithClient(client, adr, 'getBalance(address)', user))

  })



})

