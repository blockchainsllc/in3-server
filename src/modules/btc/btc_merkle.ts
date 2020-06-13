import { copyReverse, btcHash } from './btc_serialize'

export function createMerkleProof(txs: Buffer[], tx: Buffer): Buffer {
    const index = txs.findIndex(_ => _.equals(tx))
    const tmp = Buffer.allocUnsafe(txs.length << 5); // we create an byte array with hashes_len*32 to store all hashes
    if (txs.length == 0 || index >= txs.length || index < 0) throw new Error('Transaction not found');
    for (let i = 0; i < txs.length; i++)
        copyReverse(tmp, txs[i], i << 5); // copy the hashes in reverse order into the buffer
    return Buffer.concat(create_proofs(tmp, txs.length, [], index))                         // reduce the roothash until we have only one left.
}

// creates the root hash by calling this function recursivly until we end up with only one root hash.
function create_proofs(hashes: Buffer, hashes_len: number, bb: Buffer[], index: number): Buffer[] {
    const res_count = (hashes_len + 1) >> 1 // the number of resulting hashes
    for (let i = 0, j = 0; i < res_count; i++, j += 64) {
        // if index is part of the current pair
        if (index >> 1 == i) {
            // we add the other hash
            const pos = i << 1 == index
                ? (hashes_len == index + 1 ? j : j + 32) // take the right hash, unless the index is the last one
                : j // the left hash
            bb.push(Buffer.from(hashes.slice(pos, pos + 32)))
        }
        const data = Buffer.allocUnsafe(64) // the data we want to hash
        hashes.copy(data, 0, j, j + 32) // copy the first 32 bytes
        if (((i << 1) + 1) == hashes_len)
            hashes.copy(data, 32, j, j + 32) // copy the same hash again
        else
            hashes.copy(data, 32, j + 32, j + 64) // copy the right one
        btcHash(data).copy(hashes, i << 5) // now overwrite the original hashes with the calculated hash for the next round
    }
    // as long as we have more than one hash, we will run it again.
    if (res_count > 1) create_proofs(hashes, res_count, bb, index >> 1);
    return bb
}
