import { Transport, AxiosTransport, util } from 'in3-common'
import { RPCRequest, RPCResponse, IN3ResponseConfig, IN3RPCRequestConfig, ServerList, IN3RPCConfig, IN3RPCHandlerConfig } from '../types/types'

const MAX_BLOCKS = 1000

function toBlockNumber(blk: string) {
    if (!blk) return 0
    if (blk == 'latest' || blk == 'pending') return MAX_BLOCKS
    if (blk == 'earliest') return 0
    return util.toNumber(blk) || 0
}

export function calculateCosts(request: RPCRequest): number {
    if (!request || !request.method) return 0
    switch (request.method) {
        case 'eth_call':
        case 'in3_call':
        case 'eth_estimateGas':
            return 50
        case 'eth_getLogs':
            const filter = request.params && request.params[0]
            return Math.round(Math.min(1000, 1 + Math.max(filter ? toBlockNumber(filter.toBlock) - toBlockNumber(filter.fromBlock) : MAX_BLOCKS, 0)) * 0.9 + 10)
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
            return 20
        case 'eth_getTransactionReceipt':
            return 40
        case 'in3_nodeList':
            return 5
        default:
            return 10
    }

}

interface ClientInfo {
    costs: number
    timeout: number
}
const clients: { [id: string]: ClientInfo } = {}
let lastCleanUp = 0;

export function checkBudget(client: string, request: any, maxPoints: number) {
    const now = Date.now()
    const state: ClientInfo = clients[client] || (clients[client] = { costs: 0, timeout: now + 60000 })
    if (state.timeout < now) {
        state.costs = 0
        state.timeout = now + 60000
    }
    state.costs += Array.isArray(request) ? request.reduce((p, c) => p + calculateCosts(c), 0) : calculateCosts(request)

    if (lastCleanUp < now) {
        lastCleanUp = now + 120000
        setTimeout(() => {
            for (const key of Object.keys(clients).filter(_ => clients[_].timeout < now)) delete clients[key]
        }, 0)
    }

    if (maxPoints && state.costs > maxPoints)
        throw new Error(client + ' used up too many requests per minute!')
}