/***********************************************************
* This file is part of the Slock.it IoT Layer.             *
* The Slock.it IoT Layer contains:                         *
*   - USN (Universal Sharing Network)                      *
*   - INCUBED (Trustless INcentivized remote Node Network) *
************************************************************
* Copyright (C) 2016 - 2018 Slock.it GmbH                  *
* All Rights Reserved.                                     *
************************************************************
* You may use, distribute and modify this code under the   *
* terms of the license contract you have concluded with    *
* Slock.it GmbH.                                           *
* For information about liability, maintenance etc. also   *
* refer to the contract concluded with Slock.it GmbH.      *
************************************************************
* For more information, please refer to https://slock.it   *
* For questions, please contact info@slock.it              *
***********************************************************/

import { RPCRequest, RPCResponse  } from "../model/types"
import * as Trie from 'merkle-patricia-tree'

export class SimpleCache {

  data: Map<string, RPCResponse>
  trieData: Map<string, Trie>

  constructor() {
    this.data = new Map()
    this.trieData = new Map()
  }
  //  nl.proof.signatures = await collectSignatures(this, signers, [{ blockNumber: nl.lastBlockNumber }], verifiedHashes)

  put(key: string, response: RPCResponse): RPCResponse {
    this.data.set(key, response)
    return response
  }

  //put Trie
  putTrie(key: string, trie: Trie) {
    this.trieData.set(key, trie)
  }

  //get Trie
  getTrie(key: string): Trie {
    //delete and re insert to maintain a LRU cache
    let readTrie: Trie
    if (this.trieData.has(key)) {
      readTrie = this.trieData.get(key)
      this.trieData.delete(key)
      this.trieData.set(key, readTrie)
    }
    else {
      readTrie = null
    }
    return readTrie
  }

  clear() {
    this.data.clear()

    const trieMapSize = this.trieData.size
    if (trieMapSize > 511) {
      for (let i = 512; i < trieMapSize; i++) {
        this.trieData.delete(this.trieData.keys().next().value)
      }
    }
  }

  async getFromCache(request: RPCRequest,
    fallBackHandler: (request: RPCRequest) => Promise<RPCResponse>,
    collectSignature: (signers: string[], blockNumbers: number[], verifiedHashes: string[]) => any): Promise<RPCResponse> {
    const key = getKey(request)
    const res = this.data.get(key)
    if (res) {
      const r: RPCResponse = { ...res, id: request.id }
      if (request.in3 && r.in3 && r.in3.proof) {
        if (!request.in3.signatures || request.in3.signatures.length === 0) {
          if (r.in3 && r.in3.proof && r.in3.proof.signatures)
            delete r.in3.proof.signatures
          return r
        }
        else {
          // TODO use a signature cache
          const oldSignatures = r.in3.proof && r.in3.proof.signatures
          const blockNumbers = oldSignatures && oldSignatures.map(_ => _.block).filter((_, i, a) => _ && a.indexOf(_) === i)
          if (!blockNumbers || !blockNumbers.length)
            return this.put(key, await fallBackHandler(request))

          r.in3 = {
            ...r.in3,
            proof: {
              ...r.in3.proof,
              signatures: await collectSignature(request.in3.signatures, blockNumbers, request.in3.verifiedHashes || [])
            }
          }
        }
      }
      return r
    }
    return this.put(key, await fallBackHandler(request))
  }

}


function getKey(request: RPCRequest) {
  return request.method + ':' + JSON.stringify(request.params) + '-' + (request.in3 ?
    [request.in3.chainId, request.in3.includeCode, request.in3.verification, request.in3.verifiedHashes].map(_ => _ || '').join('|')
    : '')
}


// LRU Cache
export class LRUCache {
  entryLimit: number;
  container: Map<string, any>
  keys: string[]

  constructor(limit: number = 500) {
    this.entryLimit = limit
    this.clear()
  }

  has(key: string): boolean {
    return this.container.has(key)
  }

  get(key: string): any {
    if (!this.container.has(key))
      return null

    const keyIndex = this.keys.indexOf(key)
    if (keyIndex > 0) {
      // move recent use at first element
      this.keys.splice(keyIndex, 1)
      this.keys.unshift(key)
    }

    return { ...this.container.get(key) }
  }

  set(key: string, value: any) {
    if (!this.container.has(key)) {
      // remove least use entry
      if (this.keys.length == this.entryLimit) {
        this.container.delete(this.keys[this.keys.length - 1])
        this.keys.splice(this.keys.length - 1, 1)
      }

      // add new entry at first
      this.keys.unshift(key)
      this.container.set(key, value)
    }
  }

  toString() {
    return `limit entries: ${this.entryLimit}\nsize: ${this.container.size}\nentries:\n${this.keys.reduce((t, c) => `${t}` + `${c} = ${JSON.stringify(this.container.get(c))}\n`, '')}`
  }

  clear() {
    this.keys = []
    this.container = new Map<string, any>()
  }

}
