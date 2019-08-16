
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
import { util, serialize } from 'in3-common'
import { ServerList } from '../../src/model/types'
import { RPCResponse } from '../../src/model/types'
import EthChainContext from 'in3/js/src/modules/eth/EthChainContext'
import { registerNodes, deployContract } from '../../src/util/registry';
import { TestTransport, getTestClient } from '../utils/transport';
import Watcher from '../../src/chains/watch'
import EventWatcher from '../utils/EventWatcher';
import * as tx from '../../src/util/tx'
import { RPC } from '../../src/server/rpc';
import * as clientRPC from '../utils/clientRPC'

const toNumber = util.toNumber
const getAddress = util.getAddress

describe('Features', () => {

  it('check auto update nodelist', async () => {

    // create a new key  
    const pk = await new TestTransport().createAccount()


    const test = await TestTransport.createWithRegisteredNodes(2)
    let lastChangeBlock = toNumber(await test.getFromServer('eth_blockNumber')) - 2
    const client = await test.createClient({ requestCount: 1 })
    const watcher: Watcher = test.handlers['#1'].getHandler().watcher
    const events = new EventWatcher(client, 'nodeUpdateStarted', 'nodeUpdateFinished')

    // this will find the 2 events from registering in the beginnging and start an update of the server nodelist
    assert.equal((await watcher.update()).length, 2)

    // the servlist is now up to date


    // get the current blocknumber directly from parity without asking the in3-server
    let currentBlock = toNumber(await test.getFromServer('eth_blockNumber'))


    // now we send a request through the client. 
    let response = await client.sendRPC('eth_blockNumber')

    // This will now get an updated blocknumber with the current block
    assert.equal(response.in3.lastNodeList, lastChangeBlock)
    assert.equal(watcher.block.number, currentBlock)

    // this starts an update of the nodelist in the client
    await events.waitFor(['nodeUpdateStarted'])

    // and we wait until it is finished
    await events.waitFor(['nodeUpdateFinished'])
    events.clear()

    // now we register another server
    await registerNodes(pk, test.nodeList.contract, [{
      url: '#3',
      pk,
      props: '0xffff',
      deposit: util.toBN('10000000000000000'),
      timeout: 7200,
    }], test.chainRegistry, test.chainRegistry, test.url)
    lastChangeBlock = toNumber(await test.getFromServer('eth_blockNumber')) - 1


    // the watcher will find an register-event and triggers an update of the server-nodelist
    const logs = await watcher.update()
    assert.equal(logs.length, 1)
    assert.equal(logs[0].event, 'LogNodeRegistered')
    assert.equal(logs[0].url, '#3')
    assert.equal(logs[0].props, 0xffff)
    assert.equal(logs[0].signer, util.getAddress(pk))

    // we still have only 2 nodes since the watchers has not been triggered yet
    assert.equal(client.defConfig.servers[test.chainId].nodeList.length, 2)

    // now we send a request and automaticly trigger another auto-update
    response = await client.sendRPC('eth_blockNumber')

    // the response contained a new blocknumber
    assert.equal(response.in3.lastNodeList, lastChangeBlock)


    // we should now get a nodeUpdateStarted-event
    assert.equal((await events.waitFor(['nodeUpdateStarted'])).name, 'nodeUpdateStarted')

    // and we wait until it is finished
    await events.waitFor(['nodeUpdateFinished'])

    // now the client has 3 servers
    assert.equal(client.defConfig.servers[test.chainId].nodeList.length, 3)
  })


  it('updateLatestBlock', async () => {

    const test = new TestTransport()
    const client = await test.createClient({ requestCount: 1 })
    const pk = await test.createAccount()

    const contract = await deployContract('TestContract', pk, getTestClient())
    const startBlock = toNumber(await test.getFromServer('eth_blockNumber'))

    // increment the counter only on adr1
    await tx.callContract(test.url, contract, 'increase()', [], { confirm: true, privateKey: pk, gas: 3000000, value: 0 })


    // call with latest block and expect 1 because the counter was incremented
    assert.equal(
      await client.sendRPC('eth_getStorageAt', [contract, '0x00', 'latest']).then(_ => toNumber(_.result)),
      1)

    // call with latest block of 1 which is the state before incrementing
    assert.equal(
      await client.sendRPC('eth_getStorageAt', [contract, '0x00', 'latest'], undefined, { replaceLatestBlock: 1 }).then(_ => toNumber(_.result)),
      0)

  })



  it('autoregister', async () => {

    const test = await TestTransport.createWithRegisteredNodes(2)
    const watcher = test.getHandler(0).watcher
    // update the nodelist
    await watcher.update()

    const client = await test.createClient({ requestCount: 1 })
    const pk = await test.createAccount(null, util.toBN('100000000000000000'))
    const rpc = new RPC({
      port: 1,
      chains: {
        [test.chainId]: {
          watchInterval: -1,
          minBlockHeight: 0,
          autoRegistry: {
            url: 'dummy',
            deposit: util.toBN('10000000000000000'),
            depositUnit: 'wei',
            capabilities: {
              proof: true,
              multiChain: true
            },
          },
          privateKey: pk,
          rpcUrl: test.url,
          registry: test.nodeList.contract
        }
      }
    }, test, test.nodeList)

    await rpc.init()

    const events = await watcher.update()
    assert.equal(events.length, 1)
    assert.equal(events[0].event, 'LogNodeRegistered')
    assert.equal(events[0].signer, getAddress(pk))
    assert.equal(events[0].url, 'dummy')
    assert.equal(events[0].props, 3)
    assert.equal(events[0].deposit, util.toBN('10000000000000000'))

    const nl = await rpc.getHandler().getNodeList(false)
    assert.equal(nl.totalServers, 3)


  })

  it('partial Server List', async () => {

    // create  10 nodes
    const test = await TestTransport.createWithRegisteredNodes(10)

    const client = await test.createClient({ nodeLimit: 6, requestCount: 1, proof: 'standard' })

    const evWatcher = new EventWatcher(client, 'nodeUpdateFinished')

    // update the nodelist in the server
    await test.getHandler(0).updateNodeList(undefined)
    await client.updateNodeList()

    const ev: { name: string, arg: { nlResponse: RPCResponse, nodeList: ServerList } } = await evWatcher.getEvent('nodeUpdateFinished')
    assert.isDefined(ev)

    const proof = ev.arg.nlResponse.in3.proof

    assert.isDefined(proof)
    assert.equal(proof.type, 'accountProof')
    assert.equal(ev.arg.nodeList.totalServers, 10)
    assert.equal(ev.arg.nodeList.nodes.length, 6)
    assert.isDefined(proof.accounts[test.nodeList.contract])

  })

  it('code cache', async () => {

    // create  10 nodes
    const test = new TestTransport(2)
    const client = await test.createClient({ maxCodeCache: 100000, requestCount: 1, proof: 'standard', includeCode: false })

    // deploy testcontract
    const pk = await test.createAccount()
    const adr = await deployContract('TestContract', pk, getTestClient())

    const ctx = client.getChainContext(client.defConfig.chainId) as EthChainContext

    assert.equal(ctx.codeCache.data.size, 0)
    const response = await clientRPC.callContractWithClient(client, adr, 'counter()')

    assert.equal(ctx.codeCache.data.size, 1)

  })
  // TODO: remove
  it('block cache', async () => {

    // create  10 nodes
    const test = new TestTransport(2)
    const client = await test.createClient({ maxBlockCache: 3, requestCount: 1, proof: 'standard', signatureCount: 1 })

    // deploy testcontract
    const pk = await test.createAccount()

    const ctx = client.getChainContext(client.defConfig.chainId) as EthChainContext

    assert.equal(ctx.blockCache.length, 0)
    const resp1 = await client.sendRPC('eth_getBalance', [getAddress(pk), 'latest'])
    assert.equal(ctx.blockCache.length, 1)
    assert.equal(resp1.in3.proof.signatures.length, 1)

    const resp2 = await client.sendRPC('eth_getBalance', [getAddress(pk), 'latest'])
    assert.equal(ctx.blockCache.length, 1)
    assert.equal(resp2.in3.proof.signatures.length, 0)
  })

})

