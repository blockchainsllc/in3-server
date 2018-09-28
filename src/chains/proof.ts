import { rlp, toChecksumAddress } from 'ethereumjs-util'
import { LogProof, LogData, RPCRequest, RPCResponse, BlockData, Signature, Proof, ReceiptData, serialize, util, TransactionData } from 'in3'
import * as Trie from 'merkle-patricia-tree'
import EthHandler from './EthHandler';
import { collectSignatures } from './signatures'
import * as evm from './evm'

const toHex = util.toHex
const bytes32 = serialize.bytes32
const toNumber = util.toNumber

function createBlock(block: BlockData, verifiedHashes: string[]) {
  if (verifiedHashes && verifiedHashes.indexOf(block.hash) >= 0)
    return '' + parseInt(block.number as any)
  else
    return serialize.blockToHex(block)
}

/** creates the merkle-proof for a transation */
export async function createTransactionProof(block: BlockData, txHash: string, signatures: Signature[], verifiedHashes: string[]): Promise<Proof> {
  // we always need the txIndex, since this is used as path inside the merkle-tree
  const txIndex = block.transactions.findIndex(_ => _.hash === txHash)
  if (txIndex < 0) throw new Error('tx not found')

  // create trie
  const trie = new Trie()
  // fill in all transactions
  await Promise.all(block.transactions.map(tx => new Promise((resolve, reject) =>
    trie.put(
      rlp.encode(parseInt(tx.transactionIndex)), // path as txIndex
      serialize.createTx(tx).serialize(),  // raw transactions
      error => error ? reject(error) : resolve(true)
    )
  )))

  // check roothash
  if (block.transactionsRoot !== '0x' + trie.root.toString('hex'))
    throw new Error('The transactionHash is wrong! : ' + block.transactionsRoot + '!==0x' + trie.root.toString('hex'))

  // create prove
  return new Promise<Proof>((resolve, reject) =>
    Trie.prove(trie, rlp.encode(txIndex), (err, prove) => {
      if (err) return reject(err)
      resolve({
        type: 'transactionProof',
        block: createBlock(block, verifiedHashes),
        merkleProof: prove.map(toHex),
        txIndex, signatures
      })
    }))
}

/** creates the merkle-proof for a transation */
export async function createTransactionReceiptProof(block: BlockData, receipts: ReceiptData[], txHash: string, signatures: Signature[], verifiedHashes: string[]): Promise<Proof> {
  // we always need the txIndex, since this is used as path inside the merkle-tree
  const txIndex = block.transactions.findIndex(_ => _.hash === txHash)
  if (txIndex < 0)
    throw new Error('tx not found')

  const [txProof, merkleProof] = await Promise.all([
    createMerkleProof(
      block.transactions.map((t, i) => ({
        key: rlp.encode(i),
        value: serialize.serialize(serialize.toTransaction(t))
      })),
      rlp.encode(txIndex),
      bytes32(block.transactionsRoot)
    ),
    createMerkleProof(
      receipts.map(r => ({
        key: rlp.encode(toNumber(r.transactionIndex)),
        value: serialize.serialize(serialize.toReceipt(r))
      })),
      rlp.encode(txIndex),
      bytes32(block.receiptsRoot)
    )
  ]).then(a => a.map(_ => _.map(toHex)))


  return {
    type: 'receiptProof',
    block: createBlock(block, verifiedHashes),
    txProof, merkleProof,
    txIndex, signatures
  }
}



export async function createMerkleProof(values: { key: Buffer, value: Buffer }[], key: Buffer, expectedRoot?: Buffer) {
  const trie = new Trie()
  // fill in all values
  await Promise.all(values.map(val => new Promise((resolve, reject) =>
    trie.put(val.key, val.value, error => error ? reject(error) : resolve(true))
  )))

  if (expectedRoot && !expectedRoot.equals(trie.root))
    throw new Error('The rootHash is wrong! : ' + toHex(expectedRoot) + '!==' + toHex(trie.root))

  // create prove
  return new Promise<Buffer[]>((resolve, reject) =>
    Trie.prove(trie, key, (err, prove) => {
      if (err) return reject(err)
      resolve(prove as Buffer[])
    }))
}









export async function handleBlock(handler: EthHandler, request: RPCRequest): Promise<RPCResponse> {

  // ask the server for the block with all transactions
  const response = await handler.getFromServer(
    request.method.indexOf('Count') > 0
      ? { method: 'eth_getBlockBy' + request.method.substr(30), params: [request.params[0], true] }
      : { ...request, params: [request.params[0], true] })

  const blockData = response && response.result as BlockData

  // if we found the block....
  if (blockData && blockData.number) {

    // create the proof
    response.in3 = {
      proof: {
        type: 'blockProof',
        signatures: await collectSignatures(handler, request.in3.signatures, [{ blockNumber: toNumber(blockData.number), hash: blockData.hash }], request.in3.verifiedHashes)
      }
    }

    const transactions: TransactionData[] = blockData.transactions
    if (!request.params[1]) {
      // since we fetched the block with all transactions, but the request said, we only want hashes, we put the full ransactions in the proof and only the hashes in the result.
      (response.in3.proof as any).transactions = transactions
      blockData.transactions = transactions.map(_ => _.hash)

      if (request.method.indexOf('Count') > 0) {
        (response.in3.proof as any).block = createBlock(blockData, request.in3.verifiedHashes)
        response.result = '0x' + blockData.transactions.length.toString(16)
      }
    }
  }

  return response
}



export async function handeGetTransaction(handler: EthHandler, request: RPCRequest): Promise<RPCResponse> {
  // ask the server for the tx
  const response = await handler.getFromServer(request)
  const tx = response && response.result as any
  // if we have a blocknumber, it is mined and we can provide a proof over the blockhash
  if (tx && tx.blockNumber) {
    // get the block including all transactions from the server
    const block = await handler.getFromServer({ method: 'eth_getBlockByNumber', params: [toHex(tx.blockNumber), true] }).then(_ => _ && _.result as any)
    if (block)
      // create the proof
      response.in3 = {
        proof: await createTransactionProof(block, request.params[0] as string,
          await collectSignatures(handler, request.in3.signatures, [{ blockNumber: tx.blockNumber, hash: block.hash }], request.in3.verifiedHashes),
          request.in3.verifiedHashes) as any
      }
  }
  return response
}


export async function handeGetTransactionReceipt(handler: EthHandler, request: RPCRequest): Promise<RPCResponse> {
  // ask the server for the tx
  const response = await handler.getFromServer(request)
  const tx = response && response.result as ReceiptData
  // if we have a blocknumber, it is mined and we can provide a proof over the blockhash
  if (tx && tx.blockNumber) {
    // get the block including all transactions from the server
    const block = await handler.getFromServer({ method: 'eth_getBlockByNumber', params: [toHex(tx.blockNumber), true] }).then(_ => _ && _.result as BlockData)
    if (block) {

      const [signatures, receipts] = await Promise.all([
        collectSignatures(handler, request.in3.signatures, [{ blockNumber: toNumber(tx.blockNumber), hash: block.hash }], request.in3.verifiedHashes),
        handler.getAllFromServer(block.transactions.map(_ => ({ method: 'eth_getTransactionReceipt', params: [_.hash] })))
          .then(a => a.map(_ => _.result as ReceiptData))
      ])

      // create the proof
      response.in3 = {
        proof: await createTransactionReceiptProof(
          block,
          receipts,
          request.params[0] as string,
          signatures,
          request.in3.verifiedHashes)
      }
    }
  }
  // if we don't have a block, we will return nu result, since pending can not be proofed
  else
    return {...response, result:null}
  return response
}

export async function handleLogs(handler: EthHandler, request: RPCRequest): Promise<RPCResponse> {
  // ask the server for the tx
  const response = await handler.getFromServer(request)
  const logs = response && response.result as LogData[]
  // if we have a blocknumber, it is mined and we can provide a proof over the blockhash
  if (logs && logs.length) {

    // find all needed blocks
    const proof: LogProof = {}
    logs.forEach(l => {
      const b = proof[toHex(l.blockNumber)] || (proof[toHex(l.blockNumber)] = { receipts: {}, allReceipts: [] } as any)
    })

    // get the blocks from the server
    const blocks = await handler.getAllFromServer(Object.keys(proof).map(bn => ({ method: 'eth_getBlockByNumber', params: [bn, true] }))).then(all => all.map(_ => _.result as BlockData))

    // fetch in parallel
    await Promise.all([
      // collect signatures for all the blocks
      collectSignatures(handler, request.in3.signatures, blocks.map(b => ({ blockNumber: parseInt(b.number as string), hash: b.hash })), request.in3.verifiedHashes),
      // and get all receipts in all blocks and afterwards reasign them to their block
      handler.getAllFromServer(
        blocks.map(_ => _.transactions).reduce((p, c) => [...p, ...c], []).map(t => ({ method: 'eth_getTransactionReceipt', params: [t.hash] }))
      ).then(a => a.forEach(r => proof[toHex(r.result.blockNumber)].allReceipts.push(r.result)))
    ])

    // create the proof per block
    await Promise.all(blocks.map(b => {
      const blockProof = proof[toHex(b.number)]

      // add the blockheader
      blockProof.block = createBlock(b, request.in3.verifiedHashes)

      // we only need all receipts in order to create the full merkletree, but we do not return them all.
      const allReceipts = blockProof.allReceipts
      delete blockProof.allReceipts

      // find all the involved transactionshashes, we need to proof
      const toProof = logs.filter(_ => toHex(_.blockNumber) === toHex(b.number))
        .map(_ => _.transactionHash) // we only need the transaction hash
        .filter((th, i, a) => a.indexOf(th) === i) // there could be more than one event in one transaction, so make it unique

      // create receipt-proofs for all these transactions
      return Promise.all(toProof.map(th =>
        createTransactionReceiptProof(b, allReceipts, th, [], request.in3.verifiedHashes)
          .then(p => blockProof.receipts[th] = {
            txIndex: parseInt(allReceipts.find(_ => _.transactionHash).transactionIndex),
            proof: p.merkleProof,
            txProof: p.txProof,
          })
      ))
    }))

    // attach prood to answer
    response.in3 = {
      proof: {
        type: 'logProof',
        logProof: proof
      }
    }
  }
  return response
}



export async function handleCall(handler: EthHandler, request: RPCRequest): Promise<RPCResponse> {
  //    console.log('handle call', this.config)
  // read the response,blockheader and trace from server
  const [response, blockResponse, trace] = await handler.getAllFromServer([
    request,
    { method: 'eth_getBlockByNumber', params: [request.params[1] || 'latest', false] },
    { method: 'trace_call', params: [request.params[0], ['vmTrace'], request.params[1] || 'latest'] }
  ])

  // error checking
  if (response.error) return response
  if (blockResponse.error) throw new Error('Could not get the block for ' + request.params[1] + ':' + blockResponse.error)
  if (trace.error) throw new Error('Could not get the trace :' + trace.error)

  // anaylse the transaction in order to find all needed storage
  const block = blockResponse.result as any
  const neededProof = evm.analyse((trace.result as any).vmTrace, request.params[0].to)

  // ask for proof for the storage
  const [accountProofs, signatures] = await Promise.all([
    handler.getAllFromServer(Object.keys(neededProof.accounts).map(adr => (
      { method: 'eth_getProof', params: [toHex(adr, 20), Object.keys(neededProof.accounts[adr].storage).map(_ => toHex(_, 32)), block.number] }
    ))),
    collectSignatures(handler, request.in3.signatures, [{ blockNumber: block.number, hash: block.hash }], request.in3.verifiedHashes)
  ])

  // add the codes to the accounts
  if (request.in3.includeCode) {
    const accounts = accountProofs
      .filter(a => (a.result as any).codeHash !== '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
    const codes = await handler.getAllFromServer(accounts.map(a => ({ method: 'eth_getCode', params: [toHex((a.result as any).address, 20), request.params[1] || 'latest'] })))
    accounts.forEach((r, i) => (accounts[i].result as any).code = codes[i].result)
  }

  // bundle the answer
  return {
    ...response,
    in3: {
      proof: {
        type: 'callProof',
        block: createBlock(block, request.in3.verifiedHashes),
        signatures,
        accounts: Object.keys(neededProof.accounts).reduce((p, v, i) => { p[v] = accountProofs[i].result; return p }, {})
      }
    }
  }
}


/**
 * handle account-base requests.
 */
export async function handleAccount(handler: EthHandler, request: RPCRequest): Promise<RPCResponse> {

  const address = request.params[0] as string
  const blockNr = request.params[request.method === 'eth_getStorageAt' ? 2 : 1] || 'latest'
  const storage = request.method === 'eth_getStorageAt' ? [request.params[1]] : []

  // read the response,blockheader and trace from server
  const [blockResponse, proof, code] = await handler.getAllFromServer([
    { method: 'eth_getBlockByNumber', params: [blockNr, false] },
    { method: 'eth_getProof', params: [toHex(address, 20), storage.map(_ => toHex(_, 32)), blockNr] },
    request.method === 'eth_getCode' ? request : null
  ])

  // error checking
  if (blockResponse.error) throw new Error('Could not get the block for ' + request.params[1] + ':' + blockResponse.error)
  if (proof.error) throw new Error('Could not get the proof :' + JSON.stringify(proof.error, null, 2) + ' for request ' + JSON.stringify({ method: 'eth_getProof', params: [toHex(address, 20), storage.map(_ => toHex(_, 32)), blockNr] }, null, 2))

  // anaylse the transaction in order to find all needed storage
  const block = blockResponse.result as any
  const account = proof.result as any
  let result;
  if (request.method === 'eth_getBalance')
    result = account.balance
  else if (request.method === 'eth_getCode')
    result = code.result
  else if (request.method === 'eth_getTransactionCount')
    result = account.nonce
  else if (request.method === 'eth_getStorageAt')
    result = account.storageProof[0].value

  // bundle the answer
  return {
    id: request.id,
    jsonrpc: '2.0',
    result,
    in3: {
      proof: {
        type: 'accountProof',
        block: createBlock(block, request.in3.verifiedHashes),
        signatures: await collectSignatures(handler, request.in3.signatures, [{ blockNumber: block.number, hash: block.hash }], request.in3.verifiedHashes),
        accounts: { [toChecksumAddress(address)]: proof.result }
      }
    }
  }
}





