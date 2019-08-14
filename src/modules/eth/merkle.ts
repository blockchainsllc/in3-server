import * as Trie from 'merkle-patricia-tree'
import { parentPort } from 'worker_threads'
import { util } from 'in3-common'

let trie = undefined
const toHex = util.toHex

parentPort.on('message', async message => {
    try {
        parentPort.postMessage(await createMerkleProof(message.values, message.key, Buffer.from(message.expectedRoot)))
    } catch (error) {
        throw new Error(error)
    }
})

async function createMerkleProof(values, key, expectedRoot) {
    trie = new Trie()
    try {
        await Promise.all(values.map(val => new Promise((resolve, reject) =>
            trie.put(Buffer.from(val.key), Buffer.from(val.value), error => error ? reject(error) : resolve(true))
        )))

        if (expectedRoot && !expectedRoot.equals(trie.root))
            throw new Error('The rootHash is wrong! : ' + toHex(expectedRoot) + '!==' + toHex(trie.root))

        return new Promise<Buffer[]>((resolve, reject) =>
            Trie.prove(trie, Buffer.from(key), (err, prove) => {
                if (err) return reject(err)
                resolve(prove as Buffer[])
            })
        )
    } catch (error) {
        throw new Error(error)
    }
}