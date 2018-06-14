
import { RPCRequest, RPCResponse, Signature, IN3ResponseConfig, util, ServerList } from 'in3'

import config from './config'
import EthHandler from '../chains/eth'


export class RPC {
  conf: any
  handlers: { [chain: string]: RPCHandler }

  constructor(conf: any) {
    this.handlers = {}
    // register Handlers 
    this.handlers[''] = this.handlers['0x00'] = new EthHandler({ ...conf })
    conf.chainIds.forEach(id => {
      const chain = util.toHex(id, 32)
      this.handlers[chain] = new EthHandler({ ...config })
      this.handlers[chain].chainId = chain
    })

    this.conf = conf
  }

  async  handle(request: RPCRequest[]): Promise<RPCResponse[]> {
    return Promise.all(request.map(r => {
      const in3Request = r.in3 || { chainId: util.toHex((this.conf.chainIds && this.conf.chainIds[0]) || '0x2a', 32) }
      const handler = this.handlers[in3Request.chainId] || this.handlers['']
      const in3: IN3ResponseConfig = {}

      if (r.method === 'in3_nodeList')
        return handler.getNodeList(
          in3Request.verification && in3Request.verification.startsWith('proof'),
          r.params[0] || 0,
          r.params[1],
          r.params[2] || [],
          in3Request.signatures
        ).then(async result => {
          const res = {
            id: r.id,
            result: result as any,
            jsonrpc: r.jsonrpc,
            in3: { ...in3 }
          }
          const proof = res.result.proof
          if (proof) {
            delete res.result.proof
            res.in3.proof = proof
          }
          return res as RPCResponse
        })

      return Promise.all([
        handler.getNodeList(false).then(_ => in3.lastNodeList = _.lastBlockNumber),
        handler.handle(r)
      ])
        .then(_ => ({ ..._[1], in3: { ...(_[1].in3 || {}), ...in3 } }))
    }))
  }



  updateNodelists() {
    return Promise.all(this.conf.chainIds.map(id => this.handlers[util.toHex(id, 32)].getNodeList(true)))
  }

}



export interface RPCHandler {
  chainId: string
  handle(request: RPCRequest): Promise<RPCResponse>
  sign(blocks: { blockNumber: number, hash: string }[]): Signature[]
  getFromServer(request: Partial<RPCRequest>): Promise<RPCResponse>
  getAllFromServer(request: Partial<RPCRequest>[]): Promise<RPCResponse[]>
  getNodeList(includeProof: boolean, limit?: number, seed?: string, addresses?: string[], signers?: string[]): Promise<ServerList>
  updateNodeList(blockNumber: number): Promise<void>
  config: any
}
