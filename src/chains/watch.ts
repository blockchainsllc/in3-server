import { util, LogData } from 'in3'
import { sha3, toChecksumAddress } from 'ethereumjs-util'
import { rawDecode } from 'ethereumjs-abi'
import { RPCHandler } from '../server/rpc'
import * as fs from 'fs'
import { EventEmitter } from 'events'
import { getABI } from '../util/registry';
import { isFunction } from 'util';
const toNumber = util.toNumber
const toHex = util.toHex
const toBuffer = util.toBuffer



export default class Watcher extends EventEmitter {

  _lastBlock: {
    number: number,
    hash: string
  }

  _interval: any
  handler: RPCHandler
  interval: number
  persistFile: string
  running: boolean



  constructor(handler: RPCHandler, interval = 5, persistFile: string = 'lastBlock.json', startBlock?: number) {
    super()
    this.handler = handler
    this.interval = interval
    this.persistFile = persistFile
    if (startBlock)
      this._lastBlock = { number: startBlock, hash: toHex(0, 32) }
  }

  get block(): {
    number: number,
    hash: string
  } {
    if (!this._lastBlock) {
      try {
        if (!this.persistFile) throw new Error()
        this._lastBlock = JSON.parse(fs.readFileSync(this.persistFile, 'utf8'))
      }
      catch {
        this._lastBlock = { number: 1, hash: toHex(0, 32) }
      }
    }
    return this._lastBlock
  }

  set block(b: {
    number: number,
    hash: string
  }) {
    if (this._lastBlock && this._lastBlock.number === b.number) return
    if (this.persistFile)
      fs.writeFileSync(this.persistFile, JSON.stringify(b), 'utf8')
    this._lastBlock = b
  }

  stop() {
    if (this.running) {
      this.running = false
      if (this._interval) {
        clearTimeout(this._interval)
        this._interval = undefined
      }
    }

  }

  check() {
    this.running = true
    const next = err => {
      if (err && err instanceof Error) console.error(err)
      if (this.interval && this.running)
        this._interval = setTimeout(() => this.check(), this.interval)
      else
        this.running = false
    }
    this.update().then(next, next)
  }

  async update(): Promise<any[]> {
    let res = null
    const [nodeList, currentBlock] = await Promise.all([
      this.handler.getNodeList(false),
      this.handler.getFromServer({ method: 'eth_blockNumber', params: [] }).then(_ => toNumber(_.result))
    ])

    if (this.block.number == currentBlock) return

    const [blockResponse, logResponse] = await this.handler.getAllFromServer([{
      method: 'eth_getBlockByNumber', params: [toHex(currentBlock), false]
    },
    ... (nodeList && nodeList.contract ? [{
      method: 'eth_getLogs', params: [{ fromBlock: toHex(this.block.number + 1), toBlock: toHex(currentBlock), address: nodeList.contract }]
    }] : [])
    ])

    if (blockResponse.error) throw new Error('Error getting the block ' + currentBlock + ': ' + blockResponse.error)

    if (logResponse) {
      if (logResponse.error) throw new Error('Error getting the logs : ' + logResponse.error)

      const logs = logResponse.result as LogData[]
      if (logs.length) {
        // always update the list
        await this.handler.updateNodeList(currentBlock)
        res = logs.map(decodeEvent)

        // trigger events
        res.forEach(ev => this.emit(ev.event, ev))
      }

    }

    // save block
    this.block = { number: currentBlock, hash: toHex(blockResponse.result.hash, 32) }

    return res
  }


}

function decodeEvent(log: LogData) {
  const ev = abi.find(_ => _.hash === log.topics[0])
  if (!ev) throw new Error('unknown log hash : ' + JSON.stringify(log, null, 2))

  return {
    ...decodeData(log.data, ev.inputs.filter(_ => !_.indexed)),
    ...decodeData('0x' + log.topics.slice(1).map(_ => _.substr(2)).join(''), ev.inputs.filter(_ => !!_.indexed)),
    log,
    event: ev.name
  }
}

function fixType(type: string, val: any) {
  if (type === 'address') return toChecksumAddress(val)
  if (type.startsWith('uint')) return toNumber(val)
  if (type.startsWith('byte')) return toHex(val.startsWith('0x') ? val : '0x' + val)
  return val

}

function decodeData(data: any, inputs: { type: string, name: string }[]) {
  const vals: any[] = rawDecode(inputs.map(_ => _.type), toBuffer(data))
  return inputs.reduce((p, c, i) => {
    p[c.name] = fixType(c.type, vals[i])
    return p
  }, {})
}

const abi = getABI('ServerRegistry').filter(_ => _.type === 'event') as {
  name: string
  inputs: any[]
  hash: string
}[]
abi.forEach(_ => _.hash = toHex(sha3(_.name + '(' + _.inputs.map(i => i.type).join(',') + ')'), 32))
