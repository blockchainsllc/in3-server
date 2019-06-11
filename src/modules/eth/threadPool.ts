import { Worker } from 'worker_threads'
const fs = require('fs').promises;

let workers = []
let firstTime = true

class ThreadPool {

    constructor() {
        if (firstTime) {
            this.clearThread()
            firstTime = false
        }
    }

    async getMerkleProof(values: { key: Buffer, value: Buffer }[], key: Buffer, expectedRoot: Buffer) {

        let thread = await this.getMerkleProofWorker()
        let worker = thread.worker
        worker.setMaxListeners(0)

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
            workers.unshift(thread)
        }

    }

    private async getMerkleProofWorker() {
        if (this.hasWorkers()) {
            return await workers.shift()
        } else {
            workers.push({ "worker": new Worker('./merkle.js'), "lastInteraction": Date.now() })
            return await workers.shift()
        }
    }

    private hasWorkers() {
        return workers.length > 0;
    }

    private clearThread() {
        setInterval(function () {
            if (workers.length > 0) {
                workers.map(thread => {
                    if ((Date.now() - thread.lastInteraction) > 90000) {
                        if (workers.length > 1) {
                            workers.splice(workers.indexOf(thread), 1)
                            thread.worker.unref()
                            thread.worker.terminate()
                        }
                    }
                })
            }
        }, 60000)
    }
}

module.exports = ThreadPool;
