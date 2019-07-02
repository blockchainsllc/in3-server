import { Worker } from 'worker_threads'
import { cpus } from 'os'

let workers = []
let firstTime = true
let openThreads = 0

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
console.log("tmp status")
    private async getMerkleProofWorker() {
        if (this.hasWorkers()) {
            return await workers.shift()
        } else {

            if (openThreads < cpus().length - 1) {
                const filepath = process.env.SRC_PATH || './js/src'
                workers.push({"worker": new Worker(filepath + '/modules/eth/merkle.js'), "lastInteraction": Date.now()})
                openThreads++
                return await workers.shift()
            } else {
                await this.waitForThreads()

                return await workers.shift()
            }

        }
    }
    private async waitForThreads() {
        let checkThreads;
        try {
            checkThreads = new Promise(async (resolve) => {
                setInterval(async function () {
                    if (workers.length > 0) {
                        await clearInterval(checkThreads)
                        resolve
                    }
                }, 200)
            })
            return await checkThreads
        } catch (error) {
            throw new Error(error)
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
                            openThreads--
                        }
                    }
                })
            }
        }, 30000)
    }
}

module.exports = ThreadPool;