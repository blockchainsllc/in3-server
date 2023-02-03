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

import { Worker } from 'worker_threads'
import { cpus } from 'os'


let workers = []
let firstTime = true
let openThreads = 0

export class ThreadPool {
    constructor() {
        if (firstTime) {
            this.clearThread()
            firstTime = false
        }
    }

    async getMerkleProof(values: { key: Buffer, value: Buffer }[], key: Buffer, expectedRoot: Buffer) {

        let thread = await this.getMerkleProofWorker()
        let worker = thread.worker

        try {
            return await new Promise<Buffer[]>(async (resolve, reject) => {
                let params = { values, key, expectedRoot }
                worker.postMessage(params)
                thread.lastInteraction = Date.now()
                worker.on('message', resolve)
                worker.on('error', reject)
                worker.on('exit', (code) => {
                    if (code !== 0)
                        reject(new Error(`Worker stopped with exit code ${code}`));
                });
            })
        } catch (error) {
            throw new Error(error)
        } finally {
            worker.removeAllListeners('message')
            worker.removeAllListeners('error')
            worker.removeAllListeners('exit')
            workers.unshift(thread)
        }

    }
    private async getMerkleProofWorker() {
        if (this.hasWorkers()) {
            return await workers.shift()
        } else {

            if (openThreads < cpus().length - 1) {
                const filepath = process.env.SRC_PATH || './js/src'
                workers.push({ "worker": new Worker(filepath + '/modules/eth/merkle.js'), "lastInteraction": Date.now() })
                openThreads++
                return await workers.shift()
            } else {
                await this.waitForThreads()
                return await workers.shift()
            }
        }
    }
    private waitForThreads() {
        return new Promise(resolve => {
            return this.hasWorkers() ? setTimeout(() => this.waitForThreads().then(() => resolve(null)), 200) : resolve(null)
        })
    }

    private hasWorkers() {
        return workers.length > 0;
    }

    private clearThread() {
        setInterval(function () {
            if (workers.length > 0) {
                workers.forEach(thread => {
                    if ((Date.now() - thread.lastInteraction) > 90000) {
                        if (workers.length > 1) {
                            workers.splice(workers.indexOf(thread), 1)
                            thread.worker.unref()
                            thread.worker.terminate()
                            openThreads--
                        }
                    }
                })
            }
        }, 30000)
    }
}
