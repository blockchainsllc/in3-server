import EthHandler from './eth'
import { BlockData, RPCRequest, RPCResponse, Signature, util, serialize } from 'in3'
import { sha3, pubToAddress, ecrecover, ecsign } from 'ethereumjs-util'
import { callContract } from '../util/tx'

const toHex = util.toHex
const toNumber = util.toNumber
const bytes32 = serialize.bytes32
const address = serialize.address
const bytes = serialize.bytes

export async function collectSignatures(handler: EthHandler, addresses: string[], requestedBlocks: { blockNumber: number, hash?: string }[]): Promise<Signature[]> {
  // nothing to do?
  if (!addresses || !addresses.length || !requestedBlocks || !requestedBlocks.length) return []

  // make sure the 
  const blocks = await Promise.all(requestedBlocks.map(async b => ({
    blockNumber: toNumber(b.blockNumber),
    hash: toHex(b.hash || await handler.getFromServer({ method: 'eth_getBlockByNumber', params: [toHex(b.blockNumber), false] })
      .then(_ => _.result && _.result.hash), 32)
  })))

  // get our own nodeList
  const nodes = await handler.getNodeList(false)
  return Promise.all(addresses.map(async adr => {

    // find the requested address in our list
    const config = nodes.nodes.find(_ => _.address === adr)
    if (!config) // TODO do we need to throw here or is it ok to simply not deliver the signature?
      throw new Error('The requested signature ' + adr + ' does not exist within the current nodeList!')

    // send the sign-request
    const response = await handler.transport.handle(config.url, { id: handler.counter++, jsonrpc: '2.0', method: 'in3_sign', params: [...blocks] }) as RPCResponse
    if (response.error)
      throw new Error('Could not get the signature from ' + adr + ' for blocks ' + blocks.map(_ => _.blockNumber).join() + ':' + response.error)

    const signatures = response.result as Signature[]

    // if there are signature, we only return the valid ones
    if (signatures && signatures.length)
      return Promise.all(signatures.map(async s => {

        // first check the signature
        const signatureMessageHash: Buffer = sha3(Buffer.concat([bytes32(s.blockHash), bytes32(s.block)]))
        if (!bytes32(s.msgHash).equals(signatureMessageHash)) // the message hash is wrong and we don't know what he signed
          return null // can not use it to convict

        // recover the signer from the signature
        const signer: Buffer = pubToAddress(ecrecover(signatureMessageHash, toNumber(s.v), bytes(s.r), bytes(s.s)))
        const singingNode = signer.equals(address(adr))
          ? config
          : nodes.nodes.find(_ => address(_.address).equals(signer))

        if (!singingNode) return null // if we don't know the node, we can not convict anybody.

        const expectedBlock = blocks.find(_ => toNumber(_.blockNumber) === toNumber(s.block))
        if (!expectedBlock) {
          // hm... handler node signed a different block, then we expected, but the signature is valid.
          // TODO so at least we should check if the blockhash is incorrect, so we can convict him anyway
          return null
        }


        // is the blockhash correct all is fine
        if (bytes32(s.blockHash).equals(bytes32(expectedBlock.hash)))
          return s

        // so he signed the wrong blockhash and we have all data to convict him!
        const txHash = await callContract(handler.config.rpcUrl, nodes.contract, 'convict(uint,bytes32,uint,uint8,bytes32,bytes32)', [toNumber(singingNode.index), s.blockHash, s.block, s.v, s.r, s.s], {
          privateKey: handler.config.privateKey,
          gas: 300000,
          value: 0,
          confirm: false  //  we are not waiting for confirmation, since we want to deliver the answer to the client.
        })
        return null
      }))

    return signatures

    // merge all signatures
  })).then(a => a.filter(_ => _).reduce((p, c) => [...p, ...c], []))
}

export function sign(pk: string, blocks: { blockNumber: number, hash: string }[]): Signature[] {
  return blocks.map(b => {
    const msgHash = sha3('0x' + toHex(b.hash).substr(2).padStart(64, '0') + toHex(b.blockNumber).substr(2).padStart(64, '0'))
    const sig = ecsign(msgHash, bytes32(pk))
    return {
      blockHash: toHex(b.hash),
      block: toNumber(b.blockNumber),
      r: toHex(sig.r),
      s: toHex(sig.s),
      v: toNumber(sig.v),
      msgHash: toHex(msgHash)
    }
  })
}

export async function handleSign(handler: EthHandler, request: RPCRequest): Promise<RPCResponse> {
  const blocks = request.params as { blockNumber: number, hash: string }[]
  const blockData = await handler.getAllFromServer([
    ...blocks.map(b => ({ method: 'eth_getBlockByNumber', params: [toHex(b.blockNumber), false] })),
    { method: 'eth_blockNumber', params: [] },
  ]).then(a => a.map(_ => _.result as BlockData))
  const blockNumber = blockData.pop() as any as string // the first arg is just the current blockNumber

  if (!blockNumber) throw new Error('no current blocknumber detectable ')
  if (blockData.find(_ => !_)) throw new Error('requested block could not be found ')

  const blockHeight = handler.config.minBlockHeight === undefined ? 6 : handler.config.minBlockHeight

  const tooYoungBlock = blockData.find(block => toNumber(blockNumber) - toNumber(block.number) < blockHeight)
  if (tooYoungBlock)
    throw new Error(' cannot sign for block ' + tooYoungBlock.number + ', because the blockHeight must be at least ' + blockHeight)

  return {
    id: request.id,
    jsonrpc: request.jsonrpc,
    result: sign(handler.config.privateKey, blockData.map(b => ({ blockNumber: toNumber(b.number), hash: b.hash })))
  }
}
