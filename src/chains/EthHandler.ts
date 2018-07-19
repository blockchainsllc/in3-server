import { RPCRequest, RPCResponse, ServerList, Transport, AxiosTransport, IN3RPCHandlerConfig, serialize, util as in3Util } from 'in3'
import { handeGetTransaction, handeGetTransactionReceipt, handleAccount, handleBlock, handleCall, handleLogs } from './proof'
import axios from 'axios'
import { getNodeList, updateNodeList } from '../util/nodeListUpdater'
import Watcher from './watch'
import { checkPrivateKey, checkRegistry } from './initHandler'
import { collectSignatures, handleSign } from './signatures'

const toHex = in3Util.toHex
const toNumber = in3Util.toNumber
const bytes32 = serialize.bytes32
const address = serialize.address

/**
 * handles EVM-Calls
 */
export default class EthHandler {
  counter: number
  config: IN3RPCHandlerConfig
  nodeList: ServerList
  transport: Transport
  chainId: string
  watcher: Watcher

  constructor(config: IN3RPCHandlerConfig, transport?: Transport, nodeList?: ServerList) {
    this.config = config || {} as IN3RPCHandlerConfig
    this.transport = transport || new AxiosTransport()
    this.nodeList = nodeList || { nodes: undefined }
    const interval = config.watchInterval || 5

    // check that we have a valid private key and if needed decode it
    checkPrivateKey(this.config)

    // create watcher checking the registry-contract for events
    this.watcher = new Watcher(this, interval, config.persistentFile || 'lastBlock.json')

    // start the watcher in the background
    if (interval > 0)
      this.watcher.check()
  }


  checkRegistry(): Promise<any> {
    return checkRegistry(this)
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
        return toError(request.id, 'a in3 - node can not sign Messages, because the no unlocked key is allowed!')

      case 'eth_submitWork':
      case 'eth_submitHashrate':
        return toError(request.id, 'Incubed cannot be used for mining since there is no coinbase')

      case 'in3_sign':
        return handleSign(this, request)

      default:
        // default handling by simply getting the response from the server
        return this.getFromServer(request)
    }
  }


  /** returns the result directly from the server */
  getFromServer(request: Partial<RPCRequest>): Promise<RPCResponse> {
    if (!request.id) request.id = this.counter++
    if (!request.jsonrpc) request.jsonrpc = '2.0'
    return axios.post(this.config.rpcUrl, toCleanRequest(request)).then(_ => _.data)
  }

  /** returns a array of requests from the server */
  getAllFromServer(request: Partial<RPCRequest>[]): Promise<RPCResponse[]> {
    return request.length
      ? axios.post(this.config.rpcUrl, request.filter(_ => _).map(_ => toCleanRequest({ id: this.counter++, jsonrpc: '2.0', ..._ }))).then(_ => _.data)
      : Promise.resolve([])
  }

  /** uses the updater to read the nodes from the contract */
  async updateNodeList(blockNumber: number): Promise<void> {
    await updateNodeList(this, this.nodeList, blockNumber)
  }

  /** get the current nodeList */
  async getNodeList(includeProof: boolean, limit = 0, seed?: string, addresses: string[] = [], signers?: string[], verifiedHashes?: string[]): Promise<ServerList> {
    const nl = await getNodeList(this, this.nodeList, includeProof, limit, seed, addresses)
    if (nl.proof && signers && signers.length)
      nl.proof.signatures = await collectSignatures(this, signers, [{ blockNumber: nl.lastBlockNumber }], verifiedHashes)
    return nl
  }


}




function toCleanRequest(request: Partial<RPCRequest>): RPCRequest {
  return {
    id: request.id,
    method: request.method,
    params: request.params,
    jsonrpc: request.jsonrpc
  }
}

function toError(id: number | string, error: string): RPCResponse {
  return {
    id,
    error,
    jsonrpc: '2.0'
  }
}