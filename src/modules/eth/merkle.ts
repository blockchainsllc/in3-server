/*******************************************************************************
 * This file is part of the Incubed project.
 * Sources: https://github.com/slockit/in3-server
 * 
 * Copyright (C) 2018-2019 slock.it GmbH, Blockchains LLC
 * 
 * 
 * COMMERCIAL LICENSE USAGE
 * 
 * Licensees holding a valid commercial license may use this file in accordance 
 * with the commercial license agreement provided with the Software or, alternatively, 
 * in accordance with the terms contained in a written agreement between you and 
 * slock.it GmbH/Blockchains LLC. For licensing terms and conditions or further 
 * information please contact slock.it at in3@slock.it.
 * 	
 * Alternatively, this file may be used under the AGPL license as follows:
 *    
 * AGPL LICENSE USAGE
 * 
 * This program is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free Software 
 * Foundation, either version 3 of the License, or (at your option) any later version.
 *  
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY 
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A 
 * PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.
 * [Permissions of this strong copyleft license are conditioned on making available 
 * complete source code of licensed works and modifications, which include larger 
 * works using a licensed work, under the same license. Copyright and license notices 
 * must be preserved. Contributors provide an express grant of patent rights.]
 * You should have received a copy of the GNU Affero General Public License along 
 * with this program. If not, see <https://www.gnu.org/licenses/>.
 *******************************************************************************/

import * as Trie from 'merkle-patricia-tree'
import { parentPort } from 'worker_threads'
import * as util  from '../../util/util'

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