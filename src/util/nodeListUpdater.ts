import { RPCHandler } from '../server/rpc'
import config from '../server/config'
import * as tx from './tx'
import * as abi from 'ethereumjs-abi'
import Client, { Proof, ServerList, BlockData, AccountProof, RPCRequest, IN3Config, RPCResponse, IN3NodeConfig, util, storage, serialize, AxiosTransport } from 'in3'
import { toChecksumAddress, BN, keccak256, toBuffer } from 'ethereumjs-util'
const toHex = util.toHex
const toBuffer = util.toBuffer

export async function checkNodeList(handler: RPCHandler, nodeList: ServerList, includeProof = false, limit = 0, seed?: string, addresses: string[] = []): Promise<ServerList> {

  // TODO check blocknumber of last event.
  if (!nodeList.nodes)
    await updateNodeList(handler, nodeList)

  // if the client requires a portion of the list
  if (limit && limit < nodeList.nodes.length) {
    const nodes = nodeList.nodes


    // try to find the addresses in the node list
    const result = addresses.map(adr => nodes.findIndex(_ => _.address === adr))
    if (result.indexOf(-1) >= 0) throw new Error('The given addresses ' + addresses.join() + ' are not registered in the serverlist')

    createRandomIndexes(nodes.length, limit, seed, result)

    const nl: ServerList = {
      totalServers: nodeList.totalServers,
      contract: nodeList.contract,
      lastBlockNumber: nodeList.lastBlockNumber,
      nodes: result.map(i => nodeList.nodes[i])
    }

    if (includeProof) {
      const storageProof = nodeList.proof.accounts[nodeList.contract].storageProof
      nl.proof = {
        ...nodeList.proof,
        accounts: {
          [nodeList.contract]: {
            ...nodeList.proof.accounts[nodeList.contract],
            storageProof: getStorageKeys(nl.nodes).map(k => storageProof.find(_ => _.key === k))
          }
        }
      }
    }

    return nl
  }

  // clone result
  const list: ServerList = { ...nodeList, proof: { ...nodeList.proof } }
  if (!includeProof) delete list.proof
  return list

}

export function getStorageKeys(list: IN3NodeConfig[]) {
  // create the keys with the serverCount
  const keys: string[] = [storage.getStorageArrayKey(0)]

  for (const n of list) {
    for (let i = 0; i < 5; i++)
      keys.push(storage.getStorageArrayKey(0, n.index, 5, i))
    const urlKey = util.toBN(keccak256(keys[keys.length - 5]))
    for (let i = 0; i < Math.floor(n.url.length / 32); i++)
      keys.push(util.leftPad('0x' + urlKey.add(util.toBN(i)).toString(16), 64))
  }

  return keys
}

export async function createNodeListProof(handler: RPCHandler, nodeList: ServerList) {


  // create the keys with the serverCount
  const keys: string[] = getStorageKeys(nodeList.nodes)

  const address = nodeList.contract
  const blockNr = '0x' + nodeList.lastBlockNumber.toString(16)

  // read the response,blockheader and trace from server
  const [blockResponse, proof] = await handler.getAllFromServer([
    { method: 'eth_getBlockByNumber', params: [blockNr, false] },
    { method: 'eth_getProof', params: [toHex(address, 20), keys, blockNr] }
  ])

  // error checking
  if (blockResponse.error) throw new Error('Could not get the block for ' + blockNr + ':' + blockResponse.error)
  if (proof.error) throw new Error('Could not get the proof :' + JSON.stringify(proof.error, null, 2) + ' for request ' + JSON.stringify({ method: 'eth_getProof', params: [toHex(address, 20), keys, blockNr] }, null, 2))

  // anaylse the transaction in order to find all needed storage
  const block = blockResponse.result as BlockData
  const account = proof.result as AccountProof

  // bundle the answer
  return {
    type: 'accountProof',
    block: serialize.blockToHex(block),
    accounts: { [address]: account }
  } as Proof
}

export function createRandomIndexes(len: number, limit: number, seed: string, result: number[] = []) {
  let step = parseInt(seed.substr(0, 14))  // first 6 bytes
  let pos = parseInt('0x' + seed.substr(14, 12)) // next 6 bytes
  while (result.length < limit) {
    if (result.indexOf(pos) >= 0) {
      seed = keccak256(seed)
      step = parseInt(seed.substr(0, 14))
      continue
    }
    result.push(pos)
    pos = (pos + step) % len
  }
  return result
}


async function updateNodeList(handler: RPCHandler, list: ServerList) {

  // first get the registry
  const [owner, bootNodes, meta, registryContract, contractChain] = await tx.callContract(config.registryRPC || config.rpcUrl, config.registry, 'chains(bytes32):(address,string,string,address,bytes32)', [handler.chainId])

  // number of registered servers
  const [serverCount] = await tx.callContract(config.rpcUrl, '0x' + registryContract, 'totalServers():(uint)', [])
  list.lastBlockNumber = parseInt(await handler.getFromServer({ method: 'eth_blockNumber', params: [] }).then(_ => _.result as string))
  list.contract = toChecksumAddress('0x' + registryContract)
  list.totalServers = serverCount.toNumber()

  // build the requests per server-entry
  const nodeRequests: RPCRequest[] = []
  for (let i = 0; i < serverCount.toNumber(); i++)
    nodeRequests.push({
      jsonrpc: '2.0',
      id: i + 1,
      method: 'eth_call', params: [{
        to: '0x' + registryContract,
        data: '0x' + abi.simpleEncode('servers(uint)', toHex(i, 32)).toString('hex')
      },
        'latest']
    })

  list.nodes = await handler.getAllFromServer(nodeRequests).then(all => all.map((n, i) => {
    // invalid requests must be filtered out
    if (n.error) return null
    const [url, owner, deposit, props, unregisterRequestTime] = abi.simpleDecode('servers(uint):(string,address,uint,uint,uint)', toBuffer(n.result))

    return {
      address: toChecksumAddress(owner),
      url,
      index: i,
      deposit: deposit.toNumber(),
      props: props.toNumber(),
      chainIds: [handler.chainId],
      unregisterRequestTime: unregisterRequestTime.toNumber()
    } as IN3NodeConfig

  })).then(_ => _)

  // create the proof
  list.proof = await createNodeListProof(handler, list)


}

