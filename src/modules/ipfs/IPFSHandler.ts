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

import { Transport } from 'in3-common'
import { RPCRequest, RPCResponse, ServerList, IN3RPCHandlerConfig } from '../../types/types'
import axios from 'axios'
import BaseHandler from '../../chains/BaseHandler'
import * as FormData from 'form-data'


/**
 * handles EVM-Calls
 */
export default class IPFSHandler extends BaseHandler {

  ipfsCache: Map<string, Buffer>
  maxCacheSize: number
  maxCacheBufferLength: number

  constructor(config: IN3RPCHandlerConfig, transport?: Transport, nodeList?: ServerList) {
    super(config, transport, nodeList)
    this.ipfsCache = new Map()
    this.maxCacheBufferLength = 5000
    this.maxCacheSize = 100
  }


  /** main method to handle a request */
  async handle(request: RPCRequest): Promise<RPCResponse> {

    // handle special jspn-rpc
    switch (request.method) {

      case 'ipfs_get':
        return this.getHash(request.params[0]).then(
          r => this.toResult(request.id, r && encode(r, 'binary', request.params[1] || 'base64')),
          err => this.toError(request.id, 'IPFS Hash not found : ' + err.message))

      case 'ipfs_put':
        const formData = new FormData()
        formData.append('file', Buffer.from(request.params[0], request.params[1] || 'base64') as any)
        return axios.post(this.config.ipfsUrl + '/api/v0/add', formData, {
          headers: formData.getHeaders(),
          timeout: this.config.timeout || 30000,
          maxContentLength: 3000000,
        }).then(
          r => this.toResult(request.id, r.data.Hash),
          err => this.toError(request.id, err.message))

      default:
        return super.handle(request)
    }
  }

  async getHash(hash: string) {
    // in cache?
    const cached = this.ipfsCache.get(hash)
    if (cached) return cached

    // read from ipfs
    const result: Buffer = await axios.get(
      this.config.ipfsUrl + '/api/v0/cat?arg=' + hash,
      {
        timeout: this.config.timeout || 30000,
        responseType: 'arraybuffer'
      })
      .then(r => r.data)

    // should we cache it?
    if (result.length < this.maxCacheBufferLength) {
      if (this.ipfsCache.size === this.maxCacheSize)
        this.ipfsCache.delete(this.ipfsCache.keys().next().value)
      this.ipfsCache[hash] = result
    }

    return result
  }

}


function encode(data: string | Buffer, inEncoding: string, outEncoding: string) {
  if (inEncoding === outEncoding) return data
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data, inEncoding as any) // dirty, but needed
  return b.toString(outEncoding)
}
