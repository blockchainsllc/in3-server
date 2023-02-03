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

import { RPCRequest } from '../types/types'
import * as util from '../util/util'

const MAX_BLOCKS = 1000

function toBlockNumber(blk: string) {
    if (!blk) return 0
    if (blk == 'latest' || blk == 'pending') return MAX_BLOCKS
    if (blk == 'earliest') return 0
    return util.toNumber(blk) || 0
}

export function calculateCosts(request: RPCRequest): number {
    if (!request || !request.method) return 0
    const signatures = (request.in3 && (request.in3.signers || request.in3.signatures || []).length || 0) * 20
    switch (request.method) {
        case 'eth_call':
        case 'in3_call':
        case 'eth_estimateGas':
            return signatures + 50
        case 'eth_getLogs':
            const filter = request.params && request.params[0]
            return signatures + Math.round(Math.min(1000, 1 + Math.max(filter ? toBlockNumber(filter.toBlock) - toBlockNumber(filter.fromBlock) : MAX_BLOCKS, 0)) + 10)
        case 'in3_sign':
            return (request.params && request.params[0] && request.params[0].length || 0) * 20
        case 'in3_stats':
            return 1
        case 'eth_blockNumber':
            return 5
        case 'eth_getCode':
        case 'eth_getBalance':
        case 'eth_getTransactionCount':
        case 'eth_getStorageAt':
            return signatures + 20
        case 'eth_getTransactionReceipt':
            return signatures + 40
        case 'in3_nodeList':
            return signatures + 5
        default:
            return signatures + 10
    }

}

interface ClientInfo {
    costs: number
    timeout: number
}
const clients: { [id: string]: ClientInfo } = {}
let lastCleanUp = 0;

export function checkBudget(client: string, requests: RPCRequest[], maxPoints: number, throwError: boolean) {
    const now = Date.now()

    // get current stats (or create them if they don't exist yet)
    const state: ClientInfo = clients[client] || (clients[client] = { costs: 0, timeout: now + 60000 })

    // if the stats are older then a minute, we reset them and start new 
    if (state.timeout < now) {
        state.costs = 0
        state.timeout = now + 60000
    }

    // add the weights as cost to the stats
    state.costs += requests.reduce((p, c) => p + calculateCosts(c), 0)

    // since wwe are not running as thread to clean up, we simply run whenever it is needed 
    if (lastCleanUp < now) {
        lastCleanUp = now + 120000 // run at every 2 min
        // we don't want to clean up now, but use the time as soon as the thread waits for IO
        setTimeout(() => {
            // and remove all entries which are older then a minute
            for (const key of Object.keys(clients).filter(_ => clients[_].timeout < now)) delete clients[key]
        }, 0)
    }

    // if we reached the maxpoits per minute ..
    if (maxPoints && state.costs > maxPoints) {
        // we have to reject the request
        if (throwError)
            throw new Error(client + ' used up too many requests per minute!')
        else
            return false
    }
    return true
}