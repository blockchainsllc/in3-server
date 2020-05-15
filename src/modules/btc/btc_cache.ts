import BaseHandler from "../../chains/BaseHandler"
import { RPCResponse } from "in3"
import { hash } from "in3-common/js/src/modules/eth/serialize"

export interface BTCCacheValue {
    height?: number
    hash?: Buffer
    header?: Buffer
    txids?: Buffer[]
    cbtx?: Buffer
}

export class BTCCache {

    data: Map<string, BTCCacheValue>
    handler: BaseHandler

    constructor(handler: BaseHandler) {
        this.data = new Map()
        this.handler = handler
    }

    async getBlockHeaderByHash(hashes: string[]): Promise<Buffer[]> {
        let hashesToFetch: string[] = []
        const result: Buffer[] = hashes.map(hash => {
            const value: BTCCacheValue = this.data.get(hash)
            if (value && value.header) {
                console.log('cache entry found')
                return value.header
            } else {
                console.log('no cache entry found')
                hashesToFetch.push(hash)
                return null
            }
        })

        // we need to fetch at least 1 element
        if (hashesToFetch.length > 0) {
            const blockheaders: string[] = await this.handler.getAllFromServer(hashesToFetch.map(hash => ({
                method: 'getblockheader', params: [hash, false]
             }))).then(_ => _.map(asResult))

             result.forEach((value, index) => {
                 if (!value) {
                    const blockheader = blockheaders.shift()
                    if (blockheader.length != 160 ) throw new Error(`for hash ${hashes[index]} invalid blockerheader ${blockheader}`) // error check
                    result[index] = Buffer.from(blockheader, 'hex')
                    let cacheobject = this.data.get(hashes[index])
                    if (!cacheobject) {
                        cacheobject = {hash: Buffer.from(hashes[index], 'hex')}
                        this.data.set(hashes[index], cacheobject)
                    }
                    cacheobject.header = result[index]
                 } 
             })
        }
        return result
    }

    async getBlockHeaderByNumber(numbers: string[]): Promise<Buffer[]> {
        return null
    }


    async getBlockNumberByHash(hashes: string[]): Promise<number[]> {
        let hashesToFetch: string[] = []
        const result: number[] = hashes.map(hash => {
            const value: BTCCacheValue = this.data.get(hash)
            if (value && value.height) {
                console.log('cache entry found')
                return value.height
            } else {
                console.log('no cache entry found')
                hashesToFetch.push(hash)
                return null
            }
        })

        // we need to fetch at least 1 element
        if(hashesToFetch.length > 0) {
            // get block headers
            const blockheaders: any[] = await this.handler.getAllFromServer(hashesToFetch.map(hash => ({
                method: 'getblockheader', params: [hash, true]
            }))).then(_ => _.map(asResult))

            // get number out of block header
            const numbers: number[] = blockheaders.map(value => {
                return value.height
            })

            result.forEach((value, index) => {
                if (!value) {
                    const number = numbers.shift()
                    result[index] = number
                    let cacheobject = this.data.get(hashes[index])
                    if (!cacheobject) {
                        cacheobject = {hash: Buffer.from(hashes[index], 'hex')}
                        this.data.set(hashes[index], cacheobject)
                    }
                    cacheobject.height = result[index]
                }
            })
        }
        return result
    }

    async getCoinbaseByHash(hashes: string[]): Promise<any[]> {
        let hashesToFetch: string[] = []
        const result: any[] = hashes.map(hash => {
            const value: BTCCacheValue = this.data.get(hash)
            if (value && value.cbtx && value.txids) {
                console.log('cache entry found')
                const _: any[] = [value.cbtx, value.txids]
                return _
            } else {
                console.log('no cache entry found')
                hashesToFetch.push(hash)
                return null
            }
        })

        // we need to fetch at least 1 element
        if (hashesToFetch.length > 0) {
            const blocks: any[] = await this.handler.getAllFromServer(hashesToFetch.map(hash => ({
                method: 'getblock', params: [hash, true]
            }))).then(_ => _.map(asResult))

            const cbtxids: string[] = blocks.map(value => {
                return value.tx[0]
            })

            // array of txids array
            const txids: any[] = blocks.map(value => {
                let txs: Buffer[] = []
                for (let _ of value.tx) {
                    txs.push(Buffer.from(_, 'hex'))
                }
                return txs
            })

            const params = []
            for (let i = 0; i < blocks.length; i++) {
                params.push([cbtxids[i], false, hashesToFetch[i]])
            }

            const cbtxs: string [] = await this.handler.getAllFromServer(params.map(param => ({
                method: 'getrawtransaction', params: param
            }))).then(_ => _.map(asResult))

            result.forEach((value, index) => {
                if (!value) {
                    const cbtx = Buffer.from(cbtxs.shift(), 'hex')
                    const txid = txids.shift()
                    const _: any[] = [cbtx, txid]
                    result[index] = _
                    let cacheobject = this.data.get(hashes[index])
                    if (!cacheobject) {
                        cacheobject = {hash: Buffer.from(hashes[index])}
                        this.data.set(hashes[index], cacheobject)
                    }
                    cacheobject.cbtx = cbtx
                    cacheobject.txids = txid
                }
            })

        }
        return result
    }



}

function asResult(res: RPCResponse): any {
    if (!res) throw new Error("No result")
    if (res.error)
      throw new Error((res.error as any).message || res.error + '')
    if (res.result === undefined) throw new Error("No result")
    return res.result
}