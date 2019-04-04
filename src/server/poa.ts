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


import { RPCRequest, serialize, BlockData, Proof, LogData} from 'in3'
import { RPCHandler } from './rpc'
import { recover } from 'secp256k1'
import { rlp } from 'ethereumjs-util'
import { rawDecode } from 'ethereumjs-abi'
import { publicToAddress } from 'ethereumjs-util'
import { handleLogs } from '../modules/eth/proof'
const chains = require('in3/js/src/client/defaultConfig.json').servers

export interface HistoryEntry {
    validators: string[]
    block: number
    proof: Proof | string[]
    data?: LogData[]
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
    const engine = spec && spec.engine as string
    const history: ValidatorHistory = !chain ? null : (chain.history || (chain.history = { states: [], lastCheckedBlock: 0, lastValidatorChange: 0 }))
    const currentBlock = handler.watcher ? handler.watcher.block.number : parseInt((await handler.getFromServer({ method: 'eth_blockNumber', params: [] })).result)

    if (!history || history.lastCheckedBlock >= currentBlock) return history || {} as any

    if (engine == 'authorityRound') {
        if (!history.states.length) {
            if (spec.validatorList)
                history.states.push({ block: 0, validators: spec.validatorList, proof: [] })
            else
                history.states.push({ block: 0, validators: [], proof: [] })
        }

        if (spec.validatorContract)
            await updateAuraHistory(spec.validatorContract, handler, history, currentBlock)

    }
    else if (engine == 'clique') {
        if (!history.states.length) {
            if (spec.genesisValidatorList) {
                history.states.push({ block: 0, validators: spec.genesisValidatorList, proof: [] })
                history.lastEpoch = { block: 0, epochValidators: spec.genesisValidatorList, validators: [...spec.genesisValidatorList], header: null, pendingVotes: {} }
            }
        }

        await updateCliqueHistory(spec.epoch || 30000, handler, history, currentBlock)
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

    return publicToAddress(recover(message, sig.slice(0, 64), sig[64]), true);
}

function updateVotes(blocks: BlockData[], history: ValidatorHistory) {
    //    console.log('update votes ' + parseInt(blocks[0].number as any) + ' - ' + parseInt(blocks[blocks.length - 1].number as any))
    history.lastCheckedBlock = parseInt(blocks[blocks.length - 1].number as any)
    for (const b of blocks) {
        const newValidator = b.miner.toLowerCase()
        if (newValidator == '0x' || newValidator == '0x0000000000000000000000000000000000000000') continue
        const votes = history.lastEpoch.pendingVotes[newValidator] || (history.lastEpoch.pendingVotes[newValidator] = {})

        const nonce = b.nonce || '0x' + rlp.decode(b.sealFields[1]).toString('hex')
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
            console.log("found VOTE for " + newValidator)
            history.lastValidatorChange = history.states[history.states.length - 1].block

            delete history.lastEpoch.pendingVotes[newValidator]
            history.lastEpoch.validators = vals
        }
    }
}

async function updateCliqueHistory(epoch: number, handler: RPCHandler, history: ValidatorHistory, currentBlock: number) {

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


async function updateAuraHistory(validatorContract: string, handler: RPCHandler, history: ValidatorHistory, currentBlock: number) {

    //handle logs expects a EthHandler type so the handler is passed as any
    const logs = await handleLogs(handler as any, {
        jsonrpc: "2.0",
        method: "eth_getLogs",
        params: [{
            fromBlock: '0x' + history.lastCheckedBlock.toString(16),
            toBlock: '0x' + currentBlock.toString(16),
            address: validatorContract,
            topics: [["0x55252fa6eee4741b4e24a74a70e9c11fd2c2281df8d6ea13126ff845f7825c89"]]
        }],
        in3: {
            chainId: handler.chainId,
            verification: "proof"
        }
    })

    logs.result.forEach(log => {
        const validatorList = rawDecode(['address[]'], Buffer.from(log.data.substr(2), 'hex'))[0]

        //restitch proof into a logproof object
        let logProof = {}
        logProof[log.blockNumber] = logs.in3.proof.logProof[log.blockNumber]

        //update the history states
        history.states.push({
            validators: validatorList,
            block: parseInt(log.blockNumber),
            proof: {
                type: 'logProof',
                logProof: logProof
            },
            data: [log]
        })
    })

    //update history "last" fields
    history.lastCheckedBlock = currentBlock
    history.lastValidatorChange = history.states[history.states.length - 1].block
}
