
import Client from 'in3'
import * as txUtils from '../../src/util/tx'

export async function callContractWithClient(client: Client, contract: string, signature: string, ...args: any[]) {
    const data = '0x' + txUtils.encodeFunction(signature, args)
  
    return client.sendRPC('eth_call', [{ to: contract, data }, 'latest'], client.defConfig.chainId)
  }