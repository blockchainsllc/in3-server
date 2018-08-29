import { RPCRequest, RPCResponse, ServerList, Transport, AxiosTransport, IN3RPCHandlerConfig, serialize, util as in3Util } from 'in3'
import axios from 'axios'
import BaseHandler from './BaseHandler'
import * as FormData from 'form-data'


/**
 * handles EVM-Calls
 */
export default class IPFSHandler extends BaseHandler {

  cache: Map<string, Buffer>
  maxCacheSize: number
  maxCacheBufferLength: number

  constructor(config: IN3RPCHandlerConfig, transport?: Transport, nodeList?: ServerList) {
    super(config, transport, nodeList)
    this.cache = new Map()
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
    const cached = this.cache.get(hash)
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
      if (this.cache.size === this.maxCacheSize)
        this.cache.delete(this.cache.keys().next().value)
      this.cache[hash] = result
    }

    return result
  }

}


function encode(data: string | Buffer, inEncoding: string, outEncoding: string) {
  if (inEncoding === outEncoding) return data
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data, inEncoding)
  return b.toString(outEncoding)
}

