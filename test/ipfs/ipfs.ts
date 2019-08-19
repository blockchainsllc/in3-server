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
import { TestTransport, getTestClient } from '../utils/transport'
import { RPCResponse } from '../../src/types/types';

// our test private key
const pk = '0xb903239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238'

const testIPFSClient = process.env.IPFS_URL || 'http://localhost:5001'

describe('ipfs', () => {


  it('ipfs_put', async () => {
    let test = new TestTransport(1, undefined, undefined, { handler: 'ipfs', ipfsUrl: testIPFSClient }) // create a network of 1 node
    let client = await test.createClient({ proof: 'standard', requestCount: 1 })


    const res = await client.sendRPC('ipfs_put', ['01020304FF', 'hex'])
    const hash = res.result
    const data = await client.sendRPC('ipfs_get', [hash, 'hex'])

    assert.equal(data.result, '01020304ff')
  })

  it('ipfs_get_cache', async () => {
    let test = new TestTransport(1, undefined, undefined, { handler: 'ipfs', ipfsUrl: testIPFSClient }) // create a network of 1 node
    let client = await test.createClient({ proof: 'standard', requestCount: 1 })


    const res = await client.sendRPC('ipfs_put', ['Hello World', 'utf8'])
    const hash = res.result
    for (let i = 0; i < 10; i++)
      assert.equal((await client.sendRPC('ipfs_get', [hash, 'utf8'])).result, 'Hello World')

  })




  it('ipfs_get_verify', async () => {
    let test = new TestTransport(1, undefined, undefined, { handler: 'ipfs', ipfsUrl: testIPFSClient }) // create a network of 1 node
    let client = await test.createClient({ proof: 'standard', requestCount: 1 })


    const res = await client.sendRPC('ipfs_put', ['Hello World', 'utf8'])
    const hash = res.result

    // now manipulate the result
    test.injectResponse({ method: 'ipfs_get' }, (req, re: RPCResponse) => {
      re.result = re.result + 'FF'
      return re
    })


    // this request mus fail because verification fails and there is no other node.
    await test.mustFail(client.sendRPC('ipfs_get', [hash, 'utf8']))

  })




})

