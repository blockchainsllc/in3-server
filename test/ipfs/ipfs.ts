
import { assert } from 'chai'
import 'mocha'
import { TestTransport, getTestClient } from '../utils/transport'

// our test private key
const pk = '0xb903239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238'

const testIPFSClient = process.env.IPFS_URL || 'http://localhost:5001'

describe('ipfs', () => {


  it('ipfs_put', async () => {
    let test = new TestTransport(1, undefined, undefined, { handler: 'ipfs', ipfsUrl: testIPFSClient }) // create a network of 1 node
    let client = await test.createClient({ proof: 'none', requestCount: 1 })


    const res = await client.sendRPC('ipfs_put', ['01020304FF', 'hex'])
    const hash = res.result
    const data = await client.sendRPC('ipfs_get', [hash, 'hex'])

    assert.equal(data.result, '01020304ff')
  })




})

