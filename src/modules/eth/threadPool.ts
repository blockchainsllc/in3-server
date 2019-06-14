import { Worker } from 'worker_threads'
import { cpus } from 'os';

let workers = []
let firstTime = true
let openThreads = 0

class ThreadPool {

    constructor() {
        if (firstTime) {
            this.clearThread()
            firstTime = false
            console.log("First time thread created")
        }
    }

    async getMerkleProof(values: { key: Buffer, value: Buffer }[], key: Buffer, expectedRoot: Buffer) {

        let thread = await this.getMerkleProofWorker()
        let worker = thread.worker

        try {
            console.log("New worker created, listener too")
            return await new Promise<Buffer[]>(async (resolve, reject) => {
                let params = { values, key, expectedRoot }
                worker.postMessage(params)
                thread.lastInteraction = Date.now()
                worker.on('message', resolve)
                worker.on('error', reject)
                worker.on('exit', code => {
                    if (code !== 0)
                        reject(new Error(`Worker stopped with exit code ${code}`))
                })
            })
        } catch (error) {
            throw new Error(error)
        } finally {
            console.log("Worker removed, listener too")
            worker.removeAllListeners('message')
            worker.removeAllListeners('error')
            worker.removeAllListeners('exit')
            workers.unshift(thread)
        }

    }

    private async getMerkleProofWorker() {
        console.log("Number of free threads: " + workers.length)
        console.log("Total number of open threads: " + openThreads)
        if (this.hasWorkers()) {
            console.log("Used a free thread")
            return await workers.shift()
        } else {
            console.log(openThreads + "*************" + cpus().length)

            if (openThreads < cpus().length - 1) {
                console.log("No free threads, Allowed to open a new one")
                const filepath = process.env.SRC_PATH || './js/src'
                workers.push({"worker": new Worker(filepath + '/modules/eth/merkle.js'), "lastInteraction": Date.now()})
                openThreads++
                return await workers.shift()
            } else {
                console.log("CPU thread limit hit")
                await this.waitForThreads()
                console.log("thread was freed, assigned to new process")

                return await workers.shift()
            }

        }
    }
    private async waitForThreads() {
        let checkThreads;
        try {
            console.log("Waiting for thread")

            checkThreads = new Promise(async (resolve) => {
                setInterval(async function () {
                    if (workers.length > 0) {
                        await clearInterval(checkThreads)
                        // console.log("Thread freed, assigned to new process")
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
        return workers.length > 0
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
                            console.log("Thread was deleted")
                        }
                    }
                })
            }
        }, 30000)
    }
}

module.exports = ThreadPool
