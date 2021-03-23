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


import { getSigner as utilSigner } from '../util/util'
import * as  serialize from '../modules/eth/serialize'
import { BlockData, LogData } from '../modules/eth/serialize'
import * as util from '../util/util'
import { RPCRequest, Proof } from '../types/types'
import { RPCHandler } from './rpc'
import EthHandler from '../modules/eth/EthHandler'
import * as secp256k1 from 'secp256k1'
import { publicToAddress, rlp } from 'ethereumjs-util'
import { handleLogs } from '../modules/eth/proof'
import * as logger from '../util/logger'
import { decodeFunction } from '../util/tx';
const chains = require('../modules/eth/defaultConfig.json').servers
/**
 * a Object holding proofs for validator logs. The key is the blockNumber as hex
 */
export interface AuraValidatoryProof {
    /**
     * the transaction log index
     */
    logIndex: number
    /**
     * the serialized blockheader
     * example: 0x72804cfa0179d648ccbe6a65b01a6463a8f1ebb14f3aff6b19cb91acf2b8ec1ffee98c0437b4ac839d8a2ece1b18166da704b86d8f42c92bbda6463a8f1ebb14f3aff6b19cb91acf2b8ec1ffee98c0437b4ac839d8a2ece1b18166da704b
     */
    block: string
    /**
     * the transactionIndex within the block
     */
    txIndex: number
    /**
     * the merkleProof
     */
    proof: string /* ^0x[0-9a-fA-F]+$ */[]
    /**
     * the serialized blockheader as hex, required in case of finality asked
     * example: 0x72804cfa0179d648ccbe6a65b01a6463a8f1ebb14f3aff6b19cb91acf2b8ec1ffee98c0437b4ac839d8a2ece1b18166da704b86d8f42c92bbda6463a8f1ebb14f3aff6b19cb91acf2b8ec1ffee98c0437b4ac839d8a2ece1b18166da704b
     */
    finalityBlocks?: any[]
}

const toHex = util.toHex
const toMinHex = util.toMinHex
const toNumber = util.toNumber

export interface HistoryEntry {
    validators: string[]
    block: number
    proof: AuraValidatoryProof | string[]
}
export interface ValidatorHistory {
    states: HistoryEntry[]
    lastCheckedBlock: number
    lastValidatorChange: number
    lastEpoch: {
        block: number
        header: string
        epochValidators: string[]
        validators: string[]
        pendingVotes: {
            [newValidator: string]: {
                [oldValidator: string]: {
                    block: string
                    add: boolean
                }
            }
        }
    }
}
export async function getValidatorHistory(handler: RPCHandler): Promise<ValidatorHistory> {
    const chain = chains[handler.chainId]
    const spec = chain && chain.chainSpec
    const engine = spec && spec.engine as string
    return !chain ? {} : (chain.history || (chain.history = { states: [], lastCheckedBlock: 0, lastValidatorChange: 0, queue: null }))

}
export async function updateValidatorHistory(handler: RPCHandler): Promise<ValidatorHistory> {

    const chain = chains[handler.chainId]
    const spec = chain && chain.chainSpec
    //    const engine = spec && spec.engine as string
    const history: ValidatorHistory = !chain ? null : (chain.history || (chain.history = { states: [], lastCheckedBlock: 0, lastValidatorChange: 0 }))
    const currentBlock = handler.watcher ? handler.watcher.block.number : parseInt((await handler.getFromServer({ method: 'eth_blockNumber', params: [] })).result)

    if (!history || history.lastCheckedBlock >= currentBlock) return history || {} as any

    if (!history.states.length) {
        // initial fill
        if (spec && spec.length) {
            for (const s of spec) {
                if (s.list && !s.requiresFinality) {
                    history.states.push({
                        block: s.block,
                        validators: s.list,
                        proof: []
                    })
                    history.lastCheckedBlock = s.block
                }
                const nextBlock = (spec[spec.indexOf(s) + 1] || { block: currentBlock }).block

                // if transition is contract based and there has been another
                // transition on top of it then pull in all the validator
                // changes for this transition segment
                if (s.contract && s.engine === 'authorityRound' && s.list && s.requiresFinality) {
                    const b = await handler.getFromServer({
                        method: 'eth_getBlockByNumber',
                        params: [toMinHex(s.block), false]
                    })

                    if (!b || b.error || !b.result)
                        throw new Error("Couldn't get the block at transition")

                    const transitionBlockSigner = utilSigner(new serialize.Block(b.result))


                    const finalityBlocks = await addFinalityForTransition(
                        toNumber(b.result.number),
                        transitionBlockSigner,
                        history.states[history.states.length - 1].validators.length,
                        null,
                        handler
                    )

                    const lastFinalityBlock = serialize.blockFromHex(finalityBlocks[finalityBlocks.length - 1])

                    /*
                    * Stitch the proof
                    */
                    let validatorProof = {
                        /* IMPORTANT:
                        * Since this proof is just to prove the finality of
                        * the transition we need not include txIndex, merkle
                        * proof and log index. Just the transition block and
                        * the finality blocks over it would do.
                        */
                        txIndex: null,
                        proof: null,
                        block: serialize.blockToHex(b.result),
                        logIndex: null,
                        finalityBlocks
                    }

                    history.states.push({
                        block: toNumber(lastFinalityBlock.number) + 1,//s.block,
                        validators: s.list,
                        proof: validatorProof as AuraValidatoryProof
                    })

                    history.lastCheckedBlock = toNumber(lastFinalityBlock.number) + 1
                    history.lastValidatorChange = toNumber(lastFinalityBlock.number) + 1

                    await updateAuraHistory(s.contract, handler, history, nextBlock)
                }
                else if (s.engine === 'clique') {
                    if (!history.lastEpoch) history.lastEpoch = { block: s.block, epochValidators: s.list, validators: [...s.list], header: null, pendingVotes: {} }
                    await updateCliqueHistory(s.epoch || 30000, handler, history, nextBlock)
                }
            }
        }
        else
            history.states.push({ block: 0, validators: [], proof: [] })
    }
    else if (spec && spec.length) {
        // just update the history
        const latestTransition = spec[spec.length - 1]

        //update only if the trnasition is contract based
        if (latestTransition.contract && latestTransition.engine === 'authorityRound')
            await updateAuraHistory(latestTransition.contract, handler, history, currentBlock)
        else if (latestTransition.engine === 'clique')
            await updateCliqueHistory(latestTransition.epoch || 30000, handler, history, currentBlock)
    }

    return history

}

function eq(a: string[], b: string[]) {
    if (a.length != b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].toLowerCase() != b[i].toLowerCase()) return false;
    }
    return true;
}

function getValidatorList(extra: string) {
    if (extra.length < (65 + 32 + 1) * 2) return null
    const all = extra.substr(66, extra.length - (65 + 33) * 2)
    const res: string[] = []
    for (let i = 0; i < all.length; i += 32)
        res.push('0x' + all.substr(i, 32))
    return res
}

async function getHeaders(start: number, len: number, handler: RPCHandler): Promise<BlockData[]> {
    const headers = []
    for (let i = 0; i < len; i++) headers.push({ method: 'eth_getBlockByNumber', params: ['0x' + (i + start).toString(16), false] })
    return await handler.getAllFromServer(headers).then(r => r.map(_ => _.result))
}

function getSigner(block: BlockData) {
    const data = serialize.toBlockHeader(block)
    const sig = data[12].slice(data[12].length - 65, data[12].length)
    data[12] = data[12].slice(0, data[12].length - 65)
    const message = serialize.hash(data)

    return publicToAddress((secp256k1 as any).recover(message, sig.slice(0, 64), sig[64]), true);
}

function updateVotes(blocks: BlockData[], history: ValidatorHistory) {
    //    console.log('update votes ' + parseInt(blocks[0].number as any) + ' - ' + parseInt(blocks[blocks.length - 1].number as any))
    history.lastCheckedBlock = parseInt(blocks[blocks.length - 1].number as any)
    for (const b of blocks) {
        const newValidator = b.miner.toLowerCase()
        if (newValidator == '0x' || newValidator == '0x0000000000000000000000000000000000000000') continue
        const votes = history.lastEpoch.pendingVotes[newValidator] || (history.lastEpoch.pendingVotes[newValidator] = {})

        const nonce = b.nonce || '0x' + (rlp.decode(b.sealFields[1]) as any).toString('hex')
        const validator = '0x' + getSigner(b).toString('hex')
        let add = false
        if (nonce == '0xffffffffffffffff')  // add a validator
            add = true
        else if (nonce != '0x0000000000000000')
            continue

        votes[validator] = { add, block: '0x' + rlp.encode(serialize.toBlockHeader(b)).toString('hex') }
        // count votes
        let proof = []
        for (const k of Object.keys(votes)) {
            if (votes[k].add == add) proof.push(votes[k].block)
        }

        if (proof.length >= Math.floor(history.lastEpoch.validators.length / 2) + 1) {
            const vals = [...history.lastEpoch.validators]
            if (add)
                vals.push(newValidator)
            else if (vals.indexOf(newValidator) >= 0)
                vals.splice(vals.indexOf(newValidator), 1)

            // we reached majority
            history.states.push({
                block: parseInt(b.number as any),
                validators: vals,
                proof
            })
            history.lastValidatorChange = history.states[history.states.length - 1].block

            delete history.lastEpoch.pendingVotes[newValidator]
            history.lastEpoch.validators = vals
        }
    }
}

async function updateCliqueHistory(epoch: number, handler: RPCHandler, history: ValidatorHistory, currentBlock: number) {
    logger.info('check for clique validator changes starting with block ' + currentBlock)

    // collect blockheaders
    const headers: number[] = []
    const len = 100;
    for (let i = history.lastCheckedBlock + epoch - (history.lastCheckedBlock % epoch); i <= currentBlock; i += epoch)  headers.push(i)
    for (let b of await handler.getAllFromServer(headers.map(h => ({ method: 'eth_getBlockByNumber', params: ['0x' + h.toString(16), false] })))) {
        const block = b.result as BlockData
        const bn = parseInt(block.number as any)
        const validators = getValidatorList(block.extraData)
        if (!eq(history.lastEpoch.validators, validators)) {  // no change skip epoch
            // hmmm. we need to find all the votes.
            for (let j = history.lastCheckedBlock + 1; j <= bn; j += len) {
                updateVotes(await getHeaders(j, Math.min(len, bn - j + 1), handler), history)
                if (eq(validators, history.lastEpoch.validators)) break
            }
        }
        history.lastEpoch = { block: bn, pendingVotes: {}, header: null, validators: [...validators], epochValidators: validators }
        history.lastCheckedBlock = bn
    }

    // update last blocks
    for (let j = history.lastCheckedBlock + 1; j <= currentBlock; j += len)
        updateVotes(await getHeaders(j, Math.min(len, currentBlock + 1 - j), handler), history)

}

/*
* Returns a list of finality blocks over a specified block
*/
async function addFinalityForTransition(
    blockNumber: number,
    blockSigner: Buffer,
    numValidators: number,
    maxBlock: number,
    handler: RPCHandler) {

    let bn = blockNumber

    //The maximum number of blocks it will check is curBlock + 2 times the
    //number of validators
    const twoRoundsNumber = (bn + (2 * numValidators))
    const maxNumber = maxBlock > twoRoundsNumber || !maxBlock ? twoRoundsNumber : maxBlock

    const signers = [blockSigner]

    //Hardcoded 51% finality // TODO for now we do not use finality yet, but we
    //must fix it!
    const minSigners = Math.ceil((numValidators + 1) / 2)

    const finalityBlocks = []

    while (signers.length < minSigners && bn < maxNumber) {
        bn = bn + 1

        const b = await handler.getFromServer({
            method: 'eth_getBlockByNumber',
            params: [toMinHex(bn), false]
        })

        if (!b || b.error || !b.result) break
        const currentSigner = utilSigner(new serialize.Block(b.result))
        if (!signers.find(_ => _.equals(currentSigner)))
            signers.push(currentSigner)

        finalityBlocks.push(serialize.blockToHex(b.result))
    }

    return finalityBlocks
}


async function updateAuraHistory(validatorContract: string, handler: RPCHandler, history: ValidatorHistory, currentBlock: number) {
    logger.info('check for aura validator changes starting with block ' + currentBlock)

    //do nothing until the current block is hgiher than the last checked block
    if (history.lastCheckedBlock >= currentBlock) return

    //handle logs expects a EthHandler type so the handler is passed as any
    const logs = await handleLogs(handler as EthHandler, {
        jsonrpc: "2.0",
        method: "eth_getLogs",
        params: [{
            fromBlock: toMinHex((history.lastCheckedBlock || 0) + 1),
            toBlock: toMinHex(currentBlock),
            address: validatorContract,
            topics: ["0x55252fa6eee4741b4e24a74a70e9c11fd2c2281df8d6ea13126ff845f7825c89"]
        }],
        in3: {
            chainId: handler.chainId,
            verification: "proof"
        }
    })

    for (const log of logs.result) {
        const validatorList = decodeFunction(['address[]'], util.toBuffer(log.data), handler.context)[0]
        const receipts = logs.in3.proof.logProof[toHex(log.blockNumber)].receipts

        const block = serialize.blockFromHex(logs.in3.proof.logProof[toHex(log.blockNumber)].block)

        // Fetch the finality blocks
        const finalityBlocks = await addFinalityForTransition(
            toNumber(block.number),
            utilSigner(block),
            history.states[history.states.length - 1].validators.length,
            currentBlock,
            handler)

        const lastFinalityBlock = serialize.blockFromHex(finalityBlocks[finalityBlocks.length - 1])

        /*
        * Stitch the proof
        */
        let validatorProof = {
            /* IMPORTANT:
            * only the first receipt is taken to  simplify the proofs. There is always a
            * possibility that there might be two validator change transactions in the same
            * block but we assume it to be highly unlikely.
            */
            txIndex: receipts[Object.keys(receipts)[0]].txIndex,
            proof: receipts[Object.keys(receipts)[0]].proof,
            block: logs.in3.proof.logProof[toHex(log.blockNumber)].block,
            logIndex: toNumber(log.transactionLogIndex),
            finalityBlocks
        }

        //update the history states
        history.states.push({
            validators: validatorList,
            block: toNumber(lastFinalityBlock.number) + 1,
            proof: validatorProof as AuraValidatoryProof
        })

    }

    //update history "last" fields
    history.lastCheckedBlock = currentBlock
    history.lastValidatorChange = history.states[history.states.length - 1].block
}
