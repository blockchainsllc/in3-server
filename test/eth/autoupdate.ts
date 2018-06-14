
import { assert } from 'chai'
import 'mocha'
import { util, BlockData, serialize, Signature } from 'in3'
import { registerServers } from '../../src/util/registry';
import * as ethUtil from 'ethereumjs-util'
import { TestTransport } from '../utils/transport';
import Watcher from '../../src/chains/watch'
import EventWatcher from '../utils/EventWatcher'

const bytes32 = serialize.bytes32
const toNumber = util.toNumber
const toHex = util.toHex

describe('Autoupdate', () => {

  it('check update', async () => {

    // create a new key  
    const pk = await new TestTransport().createAccount()


    const test = await TestTransport.createWithRegisteredServers(2)
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
    assert.equal(response.in3.lastNodeList, currentBlock)
    assert.equal(watcher.block.number, currentBlock)

    // this starts an update of the nodelist in the client
    await events.waitFor(['nodeUpdateStarted'])

    // and we wait until it is finished
    await events.waitFor(['nodeUpdateFinished'])
    events.clear()

    // now we register another server
    await registerServers(pk, test.nodeList.contract, [{
      url: '#3',
      pk,
      props: '0xffff',
      deposit: 20000
    }], test.chainRegistry, test.chainRegistry, test.url)


    // the watcher will find an register-event and triggers an update of the server-nodelist
    const logs = await watcher.update()
    assert.equal(logs.length, 1)
    assert.equal(logs[0].event, 'LogServerRegistered')
    assert.equal(logs[0].url, '#3')
    assert.equal(logs[0].props, 0xffff)
    assert.equal(logs[0].owner, util.getAddress(pk))

    // we still have only 2 nodes since the watchers has not been triggered yet
    assert.equal(client.defConfig.servers[test.chainId].nodeList.length, 2)

    // now we send a request and automaticly trigger another auto-update
    response = await client.sendRPC('eth_blockNumber')

    // the response contained a new blocknumber
    assert.equal(response.in3.lastNodeList, currentBlock + 2)


    // we should now get a nodeUpdateStarted-event
    assert.equal((await events.waitFor(['nodeUpdateStarted'])).name, 'nodeUpdateStarted')

    // and we wait until it is finished
    await events.waitFor(['nodeUpdateFinished'])

    // now the client has 3 servers
    assert.equal(client.defConfig.servers[test.chainId].nodeList.length, 3)
  })

})

