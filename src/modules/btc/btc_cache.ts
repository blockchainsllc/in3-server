import BaseHandler from "../../chains/BaseHandler"
import { RPCResponse, header } from "in3"
import { hash } from "../eth/serialize"
import { BTCBlock, BTCBlockHeader, serialize_blockheader } from "./btc_serialize"

export interface BTCCacheValue {
    height?: number
    hash?: Buffer
    header?: Buffer
    txids?: Buffer[]
    cbtx?: Buffer
}

export interface Coinbase {
    cbtx: Buffer
    txids: Buffer[]
}

export class BTCCache {

    data: Map<string, BTCCacheValue>
    handler: BaseHandler

    constructor(handler: BaseHandler) {
        this.data = new Map()
        this.handler = handler
    }

    async getBlockHeaderByHash(hashes: string[], json: boolean): Promise<any> {
        const results: BTCCacheValue[] = hashes.map(this.getOrCreate.bind(this))
        const hashesIndexToFetch = hashes.map((_, index) => index).filter(index => !results[index].header || json) // if json === true, then we have to fetch all hashes

        // we need to fetch at least 1 element
        if (hashesIndexToFetch.length > 0) {
            const blockheaders: BTCBlockHeader[] = await this.handler.getAllFromServer(hashesIndexToFetch.map(index => ({
                method: 'getblockheader', params: [hashes[index], true]
             }))).then(_ => _.map(asResult))

             // fill the cache
            hashesIndexToFetch.forEach((hashIndex, i) => {
                const result = results[hashIndex]
                // check if it's already there - already existing cache entries can still
                // be part of hashesIndexToFetch due to json equal to true
                if (!result.header) result.header = serialize_blockheader(blockheaders[i])
                if (!result.hash) result.hash = Buffer.from(hashes[hashIndex], 'hex')
                if (!result.height) result.height = blockheaders[i].height
                
                if (!(this.data.has((blockheaders[i].height).toString()))) {
                    this.data.set((blockheaders[i].height).toString(), result) // register new key (block number)
                }
            })
            if (json) return blockheaders // return array of BTCBlockHeader (json-object)
        }
        return results.map(_ => {return _.header})
    }

    async getBlockHeaderByNumber(numbers: string[], json: boolean): Promise<any> {
        const results: BTCCacheValue[] = numbers.map(this.getOrCreate.bind(this))
        const numbersIndexToFetch = numbers.map((_, index) => index).filter(index => !results[index].header || json)

        // we need to fetch at least 1 element
        if (numbersIndexToFetch.length > 0) {

            const hashes = await this.handler.getAllFromServer(numbersIndexToFetch.map(index => ({
                method: 'getblockhash', params: [parseInt(numbers[index])] // parseInt or numbers: number[] as parameter
            }))).then(_ => _.map(asResult))

            // get the block headers
            const blockheaders: BTCBlockHeader[] = await this.handler.getAllFromServer(hashes.map(hash => ({
                method: 'getblockheader', params: [hash, true]
             }))).then(_ => _.map(asResult))

             // fill the cache
             numbersIndexToFetch.forEach((numberIndex, i) => {
                const result = results[numberIndex]
                if (!result.header) result.header = serialize_blockheader(blockheaders[i])
                if (!result.hash) result.hash = Buffer.from(hashes[i], 'hex')
                if (!result.height) result.height = blockheaders[i].height

                if (!(this.data.has(hashes[i]))) {
                    this.data.set(hashes[i], result) // register new key (block hash)
                }
             })
             if (json) return blockheaders // return array of BTCBlockHeader (json-object)
        }
        return results.map(_ => { return _.header})
    }

    async getCoinbaseByHash(hashes: string[]): Promise<Coinbase[]> {
        const results: BTCCacheValue[] = hashes.map(this.getOrCreate.bind(this))
        const hashesIndexToFetch = hashes.map((_, index) => index).filter(index => !results[index].cbtx || !results[index].txids)
    
        // we need to fetch at least 1 element
        if (hashesIndexToFetch.length > 0) {
    
            // get the blocks based on hashes
            const blocks: BTCBlock[] = await this.handler.getAllFromServer(hashesIndexToFetch.map(index => ({
                method: 'getblock', params: [hashes[index], true]
            }))).then(_ => _.map(asResult))
    
            // get the coinbase transactions
            const cbtxs: string[] = await this.handler.getAllFromServer(blocks.map(b => ({
                method: 'getrawtransaction', params: [b.tx[0], false, b.hash]
            }))).then(_ => _.map(asResult))
    
            // fill the cache
            hashesIndexToFetch.forEach((hashIndex, i) => {
                const result = results[hashIndex]
                if (!result.cbtx) result.cbtx = Buffer.from(cbtxs[i], 'hex')
                if (!result.txids) result.txids = blocks[i].tx.map(_ => Buffer.from(_, 'hex'))
                if (!result.height) result.height = blocks[i].height
                if (!result.header) result.header = serialize_blockheader(blocks[i])

                if (!(this.data.has((blocks[i].height).toString()))) {
                    this.data.set((blocks[i].height).toString(), result) // register new key (block number)
                }
            })
        }

        return results.map(_ => {return {cbtx: _.cbtx, txids: _.txids}})
    }

    async setBlock(block: BTCBlock) {

        const blockinfo: BTCCacheValue = this.getOrCreate(block.hash)

        if (!blockinfo.height) blockinfo.height = block.height
        if (!blockinfo.header) blockinfo.header = serialize_blockheader(block)
        if (!blockinfo.cbtx && block.height > 227835) { // fetch coinbase for version 2 block only
            const cbtx: string = await this.handler.getFromServer({method: 'getrawtransaction', params: [block.tx[0], false, block.hash] }).then(asResult)
            blockinfo.cbtx = Buffer.from(cbtx, 'hex')
        } 
        if (!blockinfo.txids) blockinfo.txids = block.tx.map(_ => Buffer.from(_, 'hex'))

        if (!(this.data.has((block.height).toString()))) {
            this.data.set((block.height).toString(), blockinfo) // register new key (block number)
        }
    }

    getOrCreate(key:string):BTCCacheValue {
        let value = this.data.get(key)
        if (!value) {
           value = {}
           if (key.length === 64) // it's a hash
             value.hash = Buffer.from(key,'hex')
           else                   // must be a blockNumber
             value.height = parseInt(key)
           this.data.set(key,value)
        }
        return value
      }
}
  
function asResult(res: RPCResponse): any {
    if (!res) throw new Error("No result")
    if (res.error)
      throw new Error((res.error as any).message || res.error + '')
    if (res.result === undefined || res.result === null) throw new Error("No result")
    return res.result
}
