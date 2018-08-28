import { RPCRequest, RPCResponse, ServerList, Transport, AxiosTransport, IN3RPCHandlerConfig, serialize, util as in3Util } from 'in3'
import axios from 'axios'
import BaseHandler from './BaseHandler'
import * as FormData from 'form-data'


/**
 * handles EVM-Calls
 */
export default class IPFSHandler extends BaseHandler {

  constructor(config: IN3RPCHandlerConfig, transport?: Transport, nodeList?: ServerList) {
    super(config, transport, nodeList)
  }


  /** main method to handle a request */
  async handle(request: RPCRequest): Promise<RPCResponse> {

    // handle special jspn-rpc
    switch (request.method) {

      case 'ipfs_get':
        return axios.get(
          this.config.ipfsUrl + '/api/v0/cat?arg=' + request.params[0],
          {
            timeout: this.config.timeout || 30000,
            responseType: 'arraybuffer'
          })
          .then(r => this.toResult(request.id, r.data && encode(r.data, 'binary', request.params[1] || 'base64')),
            err => this.toError(request.id, 'IPFS Hash not found : ' + err.message)
          )

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

}


function encode(data: string | Buffer, inEncoding: string, outEncoding: string) {
  if (inEncoding === outEncoding) return data
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data, inEncoding)
  return b.toString(outEncoding)
}

