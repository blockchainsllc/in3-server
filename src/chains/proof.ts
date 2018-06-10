import * as util from 'ethereumjs-util'
import { BlockData, Signature, Proof, serialize } from 'in3'
import * as Trie from 'merkle-patricia-tree'

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
        merkleProof: prove.map(_ => _.toString('hex')),
        txIndex, signatures
      })
    }))
}

/** creates the merkle-proof for a transation */
export async function createTransactionReceiptProof(block: BlockData, receipts: any[], txHash: string, signatures: Signature[]): Promise<Proof> {
  // we always need the txIndex, since this is used as path inside the merkle-tree
  const txIndex = block.transactions.indexOf(txHash)
  if (txIndex < 0)
    throw new Error('tx not found')

  // create trie
  const trie = new Trie()
  // fill in all transactions
  await Promise.all(receipts.map(tx => new Promise((resolve, reject) =>
    trie.put(
      util.rlp.encode(parseInt(tx.transactionIndex)), // path as txIndex
      serialize.serialize(serialize.toReceipt(tx)),  // raw transactions
      error => error ? reject(error) : resolve(true)
    )
  )))

  // check roothash
  if (block.receiptsRoot !== '0x' + trie.root.toString('hex'))
    throw new Error('The receiptHash is wrong! : ' + block.receiptsRoot + '!==0x' + trie.root.toString('hex'))

  // create prove
  return new Promise<Proof>((resolve, reject) =>
    Trie.prove(trie, util.rlp.encode(txIndex), (err, prove) => {
      if (err) return reject(err)
      resolve({
        type: 'receiptProof',
        block: serialize.blockToHex(block),
        merkleProof: prove.map(_ => _.toString('hex')),
        txIndex, signatures
      })
    }))
}

