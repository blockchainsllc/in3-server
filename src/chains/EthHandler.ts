import { RPCRequest, RPCResponse, ServerList, Transport, IN3RPCHandlerConfig, util as in3Util } from 'in3'
import { handeGetTransaction, handeGetTransactionReceipt, handleAccount, handleBlock, handleCall, handleLogs } from './proof'
import BaseHandler from './BaseHandler'
import { handleSign } from './signatures';

const toHex = in3Util.toHex
const toNumber = in3Util.toNumber

/**
 * handles EVM-Calls
 */
export default class EthHandler extends BaseHandler {

  constructor(config: IN3RPCHandlerConfig, transport?: Transport, nodeList?: ServerList) {
    super(config, transport, nodeList)
  }

  /** main method to handle a request */
  async handle(request: RPCRequest): Promise<RPCResponse> {
    // replace the latest BlockNumber
    if (request.in3 && request.in3.latestBlock && Array.isArray(request.params)) {
      const i = request.params.indexOf('latest')
      if (i >= 0)
        request.params[i] = toHex((this.watcher.block.number || await this.getFromServer({ method: 'eth_blockNumber', params: [] }).then(_ => toNumber(_.result))) - request.in3.latestBlock)
    }

    // make sure the in3 params are set
    if (!request.in3)
      request.in3 = { verification: 'never', chainId: this.chainId }

    if (!request.in3.verification)
      request.in3.verification = 'never'

    // execute it
    return this.handleRPCMethod(request)
  }

  private async handleRPCMethod(request: RPCRequest) {

    // handle special jspn-rpc
    if (request.in3.verification.startsWith('proof'))
      switch (request.method) {
        case 'eth_getBlockByNumber':
        case 'eth_getBlockByHash':
        case 'eth_getBlockTransactionCountByHash':
        case 'eth_getBlockTransactionCountByNumber':
          return handleBlock(this, request)
        case 'eth_getTransactionByHash':
          return handeGetTransaction(this, request)
        case 'eth_getTransactionReceipt':
          return handeGetTransactionReceipt(this, request)
        case 'eth_getLogs':
          return handleLogs(this, request)
        case 'eth_call':
          return handleCall(this, request)

        case 'eth_getCode':
        case 'eth_getBalance':
        case 'eth_getTransactionCount':
        case 'eth_getStorageAt':
          return handleAccount(this, request)
        default:

      }

    // handle in3-methods  
    switch (request.method) {

      case 'eth_sign':
      case 'eth_sendTransaction':
        return this.toError(request.id, 'a in3 - node can not sign Messages, because the no unlocked key is allowed!')

      case 'eth_submitWork':
      case 'eth_submitHashrate':
        return this.toError(request.id, 'Incubed cannot be used for mining since there is no coinbase')

      case 'in3_sign':
        return handleSign(this, request)

      default:
        // default handling by simply getting the response from the server
        return this.getFromServer(request)
    }
  }


}


