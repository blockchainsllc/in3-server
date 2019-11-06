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

import { RPCHandler } from '../server/rpc'
import { WhiteList, RPCRequest } from '../types/types'
import { isValidChecksumAddress } from 'ethereumjs-util'
import { AbiCoder } from '@ethersproject/abi'
import { createNodeListProof } from './nodeListUpdater'
import * as abi from 'ethereumjs-abi'
import * as logger from '../util/logger'
import { util } from 'in3-common'
import * as ethabi from 'ethereumjs-abi'

export default class whiteListManager {
    whiteListEventsBlockNum: Map<string, number> //mapping of whitelist contract address and last block event
    whiteList: Map<string, WhiteList>  // white list contract address to whitelist nodes

    handler: RPCHandler
    maxWhiteListListen: number
    lastBlockNum: number
    includeProof: boolean
    cache: boolean

    constructor(handler: RPCHandler, maxWhiteListListen: number, includeProof?: boolean, cache?: boolean) {
        this.handler = handler
        this.maxWhiteListListen = maxWhiteListListen

        this.whiteListEventsBlockNum = new Map<string, number>();
        this.whiteList = new Map<string, WhiteList>();

        this.lastBlockNum = 0
        this.includeProof = includeProof ? includeProof : false
        this.cache = cache ? cache : false
    }

    async addWhiteListWatch(whiteListContractAddr: string, blockNum: number) {

        if (this.whiteListEventsBlockNum.size > this.maxWhiteListListen) {
            logger.info("White List contract " + whiteListContractAddr + " not registered because limit reached" + this.maxWhiteListListen)
        }
        else if (!this.whiteListEventsBlockNum.get(whiteListContractAddr.toLowerCase())) {
            //first validate that given addr have intended whitelist contract and not EOA by calling its function and getting block num
            const response = await this.handler.getFromServer({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: whiteListContractAddr, data: '0x' + ethabi.simpleEncode('getLastEventBlockNumber()').toString('hex') }, blockNum] })

            if (response.result) {
                this.whiteListEventsBlockNum.set(
                    whiteListContractAddr.toLowerCase(),
                    (parseInt(response.result)))
            }
            else {
                logger.info("Whitelist registration failed for " + whiteListContractAddr + " Reason: " + response.error)
            }
        }
    }

    getWhiteListEventBlockNum(whiteListContractAddr: string): number {
        return this.whiteListEventsBlockNum.get(whiteListContractAddr.toLowerCase())
    }

    async updateWhiteList() {
        if (this.whiteListEventsBlockNum.size > 0) {
            try {

                const currentBlockNum = parseInt(await this.handler.getFromServer({ method: 'eth_blockNumber', params: [] }).then(_ => _.result as string))
                const blockNr = '0x' + (currentBlockNum - (this.handler.config.minBlockHeight || 0)).toString(16)

                //getting logs for this block minus block heights
                const logResponse = await this.handler.getFromServer(
                    {
                        method: 'eth_getLogs', params:
                            [{ fromBlock: util.toMinHex(this.lastBlockNum), toBlock: util.toMinHex(currentBlockNum), address: [... this.whiteListEventsBlockNum.keys()] }, blockNr]
                    })

                this.lastBlockNum = currentBlockNum

                logResponse.result.forEach(async d => {
                    if (this.whiteListEventsBlockNum.get(d.address) == -1 || this.whiteListEventsBlockNum.get(d.address) < parseInt(d.blockNumber, 16)) {
                        //only put latest block num in which event occured
                        this.whiteListEventsBlockNum.set(String(d.address.toLowerCase()), parseInt(d.blockNumber, 16));

                        //update white list in cache
                        if (this.cache) {
                            this.whiteList.set(
                                String(d.address.toLowerCase()),
                                await this.getWhiteListFromServer(this.handler, this.includeProof, d.address, parseInt(d.blockNumber, 16)))
                        }
                    }
                });
            }
            catch (e) {
                logger.error("Error Occured in WhiteList watch " + e.toString())
            }
        }
    }

    async getWhiteList(includeProof: boolean = false, whiteListContractAddr: string, blockNum?: number): Promise<WhiteList> {
        if (this.cache) {
            const wl = this.whiteList.get(whiteListContractAddr.toLowerCase())

            if (!wl) {
                if (!blockNum) {
                    const currentBlockNum = parseInt(await this.handler.getFromServer({ method: 'eth_blockNumber', params: [] }).then(_ => _.result as string), 16)
                    blockNum = (currentBlockNum - (this.handler.config.minBlockHeight || 0))
                }

                this.addWhiteListWatch(whiteListContractAddr, blockNum)
                const swl = await this.getWhiteListFromServer(this.handler, includeProof, whiteListContractAddr, blockNum)

                this.whiteList.set(
                    String(whiteListContractAddr.toLowerCase()),
                    await this.getWhiteListFromServer(this.handler, includeProof, whiteListContractAddr, blockNum));
                return swl
            }
        }
        else {
            if (this.whiteListEventsBlockNum.get(whiteListContractAddr.toLowerCase()))
                this.addWhiteListWatch(whiteListContractAddr, blockNum)
            return this.getWhiteListFromServer(this.handler, includeProof, whiteListContractAddr, blockNum)
        }
    }

    /** returns a white listed nodes list. */
    async getWhiteListFromServer(handler: RPCHandler, includeProof = false, whiteListContractAddr: string, blockNum: number): Promise<WhiteList> {

        if (!whiteListContractAddr || !isValidChecksumAddress(whiteListContractAddr))
            throw new Error('Invalid contract address in params')

        const prepRequestData = (functionName, i, blockNum) => {
            const req: RPCRequest = {
                jsonrpc: '2.0',
                id: i,
                method: 'eth_call', params: [{
                    to: whiteListContractAddr,
                    data: '0x' + abi.simpleEncode(functionName).toString('hex')
                },
                    blockNum]
            }
            return req
        }

        //const lastBlock = await handler.getFromServer({ method: 'eth_blockNumber', params: [] }).then(_ => parseInt(_.result))
        //const blockNr = '0x' + (lastBlock - (handler.config.minBlockHeight || 0)).toString(16)

        const [whiteListNodes, lastBlockNum/*, proofHash*/] = await handler.getAllFromServer(
            [prepRequestData('getWhiteList()', 0, blockNum), prepRequestData('getLastEventBlockNumber()', 1, blockNum)/*,prepRequestData('getProofHash()',2)*/])

        const abiCoder = new AbiCoder()
        const val = abiCoder.decode(["bytes"], whiteListNodes.result as string)[0]

        let list: string[] = []
        for (var i = 1, s = 2; i <= (val.length - 2) / 40; i++) {
            list.push(val.substr(s, 40))
            s = 40 * i + 2
        }

        const wl: WhiteList = {
            totalServers: list.length,
            contract: whiteListContractAddr,
            lastBlockNumber: parseInt(lastBlockNum.result as string),
            nodes: list
        }

        if (includeProof)
            wl.proof = await createNodeListProof(handler, wl, ['0x'.padEnd(66, '0')], blockNum)

        return wl
    }

}