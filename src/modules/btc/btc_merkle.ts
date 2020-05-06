import { copyReverse, btcHash } from './btc_serialize'

export function createMerkleProof(txs: Buffer[], tx: Buffer): Buffer {
    const index = txs.findIndex(_ => _.equals(tx))
    const tmp = Buffer.allocUnsafe(txs.length << 5); // we create an byte array with hashes_len*32 to store all hashes
    if (txs.length == 0 || index >= txs.length || index < 0) throw new Error('Transaction not found');
    for (let i = 0; i < txs.length; i++) {
        copyReverse(tmp, txs[i], i << 5); // copy the hashes in reverse order into the buffer
    }
    return Buffer.concat(create_proofs(tmp, txs.length, [], index))                         // reduce the roothash until we have only one left.
}

// creates the root hash by calling this function recursivly until we end up with only one root hash.
function create_proofs(hashes: Buffer, hashes_len: number, bb: Buffer[], index: number): Buffer[] {
    const res_count = (hashes_len + 1) >> 1
    for (let i = 0, j = 0; i < res_count; i++, j += 64) {
        if (index >> 1 == i) bb.push(hashes.slice(i << 1 == index ? (hashes_len == index + 1 ? j : j + 32) : j, (i << 1 == index ? (hashes_len == index + 1 ? j : j + 32) : j) + 32));
        const data = Buffer.allocUnsafe(64)
        hashes.copy(data, 0, j, j + 32)
        if (((i << 1) + 1) == hashes_len)
            hashes.copy(data, 32, j, j + 32)
        else
            hashes.copy(data, 32, j + 32, j + 64)
        btcHash(data).copy(hashes, i << 5)
    }
    if (res_count > 1) create_proofs(hashes, res_count, bb, index >> 1);
    return bb
}
