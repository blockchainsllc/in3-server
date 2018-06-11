import * as util from 'ethereumjs-util'
import { BlockData, Signature, Proof, ReceiptData, serialize, util as in3Util } from 'in3'
import * as Trie from 'merkle-patricia-tree'

const toHex = in3Util.toHex
const bytes32 = serialize.bytes32
const toNumber = in3Util.toNumber


/** creates the merkle-proof for a transation */
export async function createTransactionProof(block: BlockData, txHash: string, signatures: Signature[]): Promise<Proof> {
  // we always need the txIndex, since this is used as path inside the merkle-tree
  const txIndex = block.transactions.findIndex(_ => _.hash === txHash)
  if (txIndex < 0) throw new Error('tx not found')

  // create trie
  const trie = new Trie()
  // fill in all transactions
  await Promise.all(block.transactions.map(tx => new Promise((resolve, reject) =>
    trie.put(
      util.rlp.encode(parseInt(tx.transactionIndex)), // path as txIndex
      serialize.createTx(tx).serialize(),  // raw transactions
      error => error ? reject(error) : resolve(true)
    )
  )))

  // check roothash
  if (block.transactionsRoot !== '0x' + trie.root.toString('hex'))
    throw new Error('The transactionHash is wrong! : ' + block.transactionsRoot + '!==0x' + trie.root.toString('hex'))

  // create prove
  return new Promise<Proof>((resolve, reject) =>
    Trie.prove(trie, util.rlp.encode(txIndex), (err, prove) => {
      if (err) return reject(err)
      resolve({
        type: 'transactionProof',
        block: serialize.blockToHex(block),
        merkleProof: prove.map(toHex),
        txIndex, signatures
      })
    }))
}

/** creates the merkle-proof for a transation */
export async function createTransactionReceiptProof(block: BlockData, receipts: ReceiptData[], txHash: string, signatures: Signature[]): Promise<Proof> {
  // we always need the txIndex, since this is used as path inside the merkle-tree
  const txIndex = block.transactions.findIndex(_ => _.hash === txHash)
  if (txIndex < 0)
    throw new Error('tx not found')

  const [txProof, merkleProof] = await Promise.all([
    createMerkleProof(
      block.transactions.map((t, i) => ({
        key: util.rlp.encode(i),
        value: serialize.serialize(serialize.toTransaction(t))
      })),
      util.rlp.encode(txIndex),
      bytes32(block.transactionsRoot)
    ),
    createMerkleProof(
      receipts.map(r => ({
        key: util.rlp.encode(toNumber(r.transactionIndex)),
        value: serialize.serialize(serialize.toReceipt(r))
      })),
      util.rlp.encode(txIndex),
      bytes32(block.receiptsRoot)
    )
  ]).then(a => a.map(_ => _.map(toHex)))


  return {
    type: 'receiptProof',
    block: serialize.blockToHex(block),
    txProof, merkleProof,
    txIndex, signatures
  }
}



export async function createMerkleProof(values: { key: Buffer, value: Buffer }[], key: Buffer, expcetedRoot?: Buffer) {
  const trie = new Trie()
  // fill in all values
  await Promise.all(values.map(val => new Promise((resolve, reject) =>
    trie.put(val.key, val.value, error => error ? reject(error) : resolve(true))
  )))

  if (expcetedRoot && !expcetedRoot.equals(trie.root))
    throw new Error('The rootHash is wrong! : ' + toHex(expcetedRoot) + '!==' + toHex(trie.root))

  // create prove
  return new Promise<Buffer[]>((resolve, reject) =>
    Trie.prove(trie, key, (err, prove) => {
      if (err) return reject(err)
      resolve(prove as Buffer[])
    }))
}