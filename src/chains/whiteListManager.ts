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

import { AbiCoder } from '@ethersproject/abi'
import * as abi from 'ethereumjs-abi'
import * as ethabi from 'ethereumjs-abi'
import { RPCHandler } from '../server/rpc'
import { maxWhiteListCacheCap, maxWhiteListContracts } from '../types/constants'
import { RPCRequest, WhiteList } from '../types/types'
import * as logger from '../util/logger'
import { isValidAddress } from '../util/tx'
import * as util from '../util/util'
import { createNodeListProof } from './nodeListUpdater'

export default class WhiteListManager {
    private whiteListEventsBlockNum: Map<string, number> //mapping of whitelist contract address and last block event
    private whiteList: Map<string, string>  // white list contract address to whitelist nodes

    handler: RPCHandler
    private maxContracts: number
    lastBlockNum: string
    cache: boolean

    constructor(handler: RPCHandler, maxWhiteListListenParam?: number, cache?: boolean) {
        this.handler = handler
        this.maxContracts = (maxWhiteListListenParam != undefined) ? maxWhiteListListenParam : maxWhiteListContracts

        this.whiteListEventsBlockNum = new Map<string, number>();
        this.whiteList = new Map<string, string>();

        this.lastBlockNum = '0x0'
        this.cache = (cache != undefined) ? cache : true
    }

    async getBlockNum() {
        return '0x' +
            (parseInt(await this.handler.getFromServer({ method: 'eth_blockNumber', params: [] }).then(_ => _.result as string), 16) -
                (this.handler.config.minBlockHeight || 0)).toString(16)
    }

    async addWhiteListWatch(whiteListContractAddr: string, blockNum?: number): Promise<boolean> {

        if (!isValidAddress(whiteListContractAddr))
            throw new Error('Invalid contract address in params')

        if (this.whiteListEventsBlockNum.size >= this.maxContracts) {
            logger.info("White List contract " + whiteListContractAddr + " not registered because limit reached" + this.maxContracts)
            return false
        }
        else if (!this.whiteListEventsBlockNum.get(whiteListContractAddr.toLowerCase())) {
            let blockNr
            if (!blockNum) {
                blockNr = await this.getBlockNum()
            }
            //first validate that given addr have intended whitelist contract and not EOA by calling its function and getting block num
            const response = await this.handler.getFromServer({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: whiteListContractAddr, data: '0x' + ethabi.simpleEncode('getLastEventBlockNumber()').toString('hex') }, blockNum != undefined ? blockNum.toString(16) : blockNr] })

            if (response.result) {
                this.whiteListEventsBlockNum.set(
                    whiteListContractAddr.toLowerCase(),
                    parseInt(response.result, 16))
            }
            else {
                logger.info("Whitelist registration failed for " + whiteListContractAddr + " Reason: " + response.error)
            }

            if (this.cache) {
                await this.addWhiteListToCache(blockNum != undefined ? blockNum : parseInt(blockNr, 16), whiteListContractAddr)
            }
            return true
        }
    }

    getWhiteListEventBlockNum(whiteListContractAddr: string): number {
        if (!isValidAddress(whiteListContractAddr))
            throw new Error('Invalid contract address in params')

        return this.whiteListEventsBlockNum.get(whiteListContractAddr.toLowerCase())
    }

    async updateWhiteList() {
        if (!this.whiteListEventsBlockNum.size) return
        try {
            const blockNr = await this.getBlockNum()

            //getting logs for this block minus block heights
            const logResponse = await this.handler.getFromServer(
                {
                    method: 'eth_getLogs',
                    params: [{
                        fromBlock: util.toMinHex(this.lastBlockNum),
                        toBlock: util.toMinHex(blockNr),
                        address: [... this.whiteListEventsBlockNum.keys()]
                    }]
                })

            this.lastBlockNum = blockNr

            if (logResponse.result)
                for (const d of logResponse.result) {
                    if (this.whiteListEventsBlockNum.get(d.address) == -1 || this.whiteListEventsBlockNum.get(d.address) < parseInt(d.blockNumber, 16)) {
                        //only put latest block num in which event occured
                        this.whiteListEventsBlockNum.set(String(d.address.toLowerCase()), parseInt(d.blockNumber, 16));

                        //update white list in cache
                        if (this.cache)
                            this.addWhiteListToCache(parseInt(d.blockNumber, 16), d.address)
                    }
                }
        }
        catch (e) {
            // we can only log here since update Whitelist is not triggered directly by a user who we could report to.
            logger.error("Error Occured in WhiteList watch " + e.toString())
        }
    }

    async getWhiteList(includeProof: boolean = false, whiteListContractAddr: string, blockNum?: number): Promise<WhiteList> {
        if (!isValidAddress(whiteListContractAddr))
            throw new Error('Invalid contract address in params')

        if (this.cache) {
            const wlStr = this.whiteList.get(whiteListContractAddr.toLowerCase())
            const wl = wlStr ? JSON.parse(wlStr) : null

            if (!wl) {
                this.addWhiteListWatch(whiteListContractAddr, blockNum)
                const swl = await this.addWhiteListToCache(blockNum, whiteListContractAddr, includeProof)
                return swl
            }
            return wl
        }
        else {
            if (!this.whiteListEventsBlockNum.get(whiteListContractAddr.toLowerCase()))
                this.addWhiteListWatch(whiteListContractAddr, blockNum)
            return this.getWhiteListFromServer(this.handler, includeProof, whiteListContractAddr, blockNum)
        }
    }

    /** returns a white listed nodes list. */
    async getWhiteListFromServer(handler: RPCHandler, includeProof = false, whiteListContractAddr: string, blockNum?: number): Promise<WhiteList> {

        if (!isValidAddress(whiteListContractAddr))
            throw new Error('Invalid contract address in params')

        const prepRequestData = async (functionName, i, blockNumParam) => {
            const req: RPCRequest = {
                jsonrpc: '2.0',
                id: i,
                method: 'eth_call', params: [{
                    to: whiteListContractAddr,
                    data: '0x' + abi.simpleEncode(functionName).toString('hex')
                },
                blockNumParam != undefined ? '0x' + blockNumParam.toString(16) : await this.getBlockNum()]
            }
            return req
        }

        const [whiteListNodes, lastBlockNum] = await handler.getAllFromServer([
            await prepRequestData('getWhiteList()', 0, blockNum),
            await prepRequestData('getLastEventBlockNumber()', 1, blockNum)
        ])

        if (whiteListNodes.error) throw new Error('Could not get whiteList from Contract :' + ((whiteListNodes.error as any).message || whiteListNodes.error))
        if (lastBlockNum.error) throw new Error('Could not get the last blockNumber from Contract :' + ((lastBlockNum.error as any).message || lastBlockNum.error))

        const abiCoder = new AbiCoder()
        const val = abiCoder.decode(["bytes"], whiteListNodes.result as string)[0]

        let list: string[] = []
        for (var i = 1, s = 2; i <= (val.length - 2) / 40; s = 40 * i + 2, i++)
            list.push("0x" + val.substr(s, 40))

        const wl: WhiteList = {
            totalServers: list.length,
            contract: whiteListContractAddr,
            lastBlockNumber: parseInt(lastBlockNum.result as string),
            nodes: list
        }

        if (includeProof)
            wl.proof = await createNodeListProof(handler, wl, ['0x'.padEnd(66, '0')], blockNum, handler?.context)

        return wl
    }

    async addWhiteListToCache(blockNum: number, whiteListContractAddr: string, includeProof: boolean = true): Promise<WhiteList> {
        const wlObj = await this.getWhiteListFromServer(this.handler, includeProof, whiteListContractAddr, blockNum)

        if (!wlObj)
            return null

        let wl = JSON.parse(JSON.stringify(wlObj))

        //cap on max cahce
        if (wl.nodes && wl.nodes.length > maxWhiteListCacheCap)
            logger.info("Cache request denied for " + whiteListContractAddr + " as maximum allwed nodes to be registered are " + maxWhiteListCacheCap + " and cache requested are " + wl.nodes.length)
        else
            this.whiteList.set(
                whiteListContractAddr.toLowerCase(),
                JSON.stringify(wl))

        return wlObj
    }

}