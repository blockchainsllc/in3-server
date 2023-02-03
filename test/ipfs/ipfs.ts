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



import { assert } from 'chai';
import 'mocha';
import { RPCResponse } from '../../src/types/types';
import { TestTransport } from '../utils/transport';

const testIPFSClient = process.env.IPFS_URL || 'http://localhost:5001'

describe('ipfs', () => {
  let test
  beforeEach(() => {
    test = new TestTransport(1, undefined, undefined, { handler: 'ipfs', ipfsUrl: testIPFSClient }, undefined, undefined, "0x7d0") // create a network of 1 node
  })

  it('ipfs_put', async () => {
    let client = await test.createClient({ proof: 'standard', requestCount: 1 })
    const toUpload = "MDEwMjAzMDRGRg=="

    const hash = await client.ipfs.put(toUpload)
    const fetched = await client.ipfs.get(hash)

    assert.equal(fetched, toUpload)
  })

  it('ipfs_get_cache', async () => {
    let client = await test.createClient({ proof: 'standard', requestCount: 1 })

    const hash = await client.ipfs.put('Hello World', "utf8")
    for (let i = 0; i < 10; i++)
      assert.equal(await client.ipfs.get(hash, "utf8"), 'Hello World')
  })

  it('ipfs_get_verify', async () => {
    let client = await test.createClient({ proof: 'standard', requestCount: 1 })

    const hash = await client.ipfs.put('Hello World', "utf8")

    // now manipulate the result
    test.injectResponse({ method: 'ipfs_get' }, (_req, re: RPCResponse) => {
      re.result = re.result + 'FF'
      return re
    })

    // this request mus fail because verification fails and there is no other node.
    await test.mustFail(client.ipfs.get(hash, "utf8"))
  })
})

