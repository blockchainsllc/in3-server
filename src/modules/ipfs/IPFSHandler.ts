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

import { Transport } from 'in3-common'
import { RPCRequest, RPCResponse, ServerList, IN3RPCHandlerConfig } from '../../types/types'
import axios                                                                   from 'axios'
import BaseHandler                                                             from '../../chains/BaseHandler'
import * as FormData                                                           from 'form-data'


/**
 * handles EVM-Calls
 */
export default class IPFSHandler extends BaseHandler {

  ipfsCache           : Map<string, Buffer>
  maxCacheSize        : number
  maxCacheBufferLength: number

  constructor(config: IN3RPCHandlerConfig, transport?: Transport, nodeList?: ServerList) {
    super(config, transport, nodeList)
    this.ipfsCache            = new Map()
    this.maxCacheBufferLength = 5000
    this.maxCacheSize         = 100
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
          headers         : formData.getHeaders(),
          timeout         : this.config.timeout || 30000,
          maxContentLength: 3000000,
        }).then(
          r   => this.toResult(request.id, r.data.Hash),
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
        timeout     : this.config.timeout || 30000,
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
