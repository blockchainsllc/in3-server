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

import * as fs from 'fs'
import { EventEmitter } from 'events'
import { util, LogData } from 'in3-common'
import { keccak, toChecksumAddress } from 'ethereumjs-util'

import { RPCHandler } from '../server/rpc';
import { getABI } from '../util/registry'
import * as logger from '../util/logger'
import * as tx from '../util/tx'
import { useDB, exec } from '../util/db'
import config from '../server/config'
import { updateValidatorHistory } from '../server/poa';

const toNumber = util.toNumber
const toHex = util.toHex
const toMinHex = util.toMinHex
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


  constructor(handler: RPCHandler, interval = 5, persistFile = 'false', startBlock?: number) {
    super()
    this.handler = handler
    this.interval = interval
    this.persistFile = persistFile === 'false' ? '' : persistFile
    if (startBlock)
      this._lastBlock = { number: startBlock, hash: toHex(0, 32) }

    // regsiter Cancel-Handler for 
    this.on('LogServerUnregisterRequested', handleUnregister)

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
    if (useDB)
      exec('update node set last_block=$1, last_hash=$2, last_update=now() where id=$3', [b.number, b.hash, config.id])
        .catch(_ => logger.error('Error writing last block into db ', _))
    else if (this.persistFile)
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
    if (!this.running)
      logger.info('start watching for registry events ...')

    logger.debug('check ...' + this.block.number)
    this.running = true
    const next = err => {
      if (err && err instanceof Error) logger.error('Error trying to update within the watcher: ' + err.message + '\n' + err.stack)
      if (this.interval && this.running)
        this._interval = setTimeout(() => this.check(), this.interval * 1000)
      else
        this.running = false
    }
    this.update().then(next, next)
  }

  async update(): Promise<any[]> {
    if (useDB && !this._lastBlock) {
      const last = await exec('select last_block, last_hash from nodes where id=$1', [config.id])
      if (last.length && last[0].last_block)
        this._lastBlock = { number: last[0].last_block, hash: last[0].last_hash }
    }
    let res = null
    const [nodeList, currentBlock] = await Promise.all([
      this.handler.getNodeList(false),
      this.handler.getFromServer({ method: 'eth_blockNumber', params: [] }).then(_ => toNumber(_.result))
    ])

    if (this.block.number == currentBlock) return
    if (!currentBlock) throw new Error('The current Block was empty!')

    this.emit('newBlock', currentBlock)

    const [blockResponse, logResponse] = await this.handler.getAllFromServer([{
      method: 'eth_getBlockByNumber', params: [toMinHex(currentBlock), false]
    },
    ... (nodeList && nodeList.contract ? [{
      method: 'eth_getLogs', params: [{ fromBlock: toMinHex(this.block.number + 1), toBlock: toMinHex(currentBlock), address: nodeList.contract }]
    }] : [])
    ])

    if (blockResponse.error) throw new Error('Error getting the block ' + currentBlock + ': ' + blockResponse.error)
    if (!blockResponse.result) throw new Error('Invalid Response getting the block ' + currentBlock + ': ' + JSON.stringify(blockResponse))

    if (logResponse) {
      if (logResponse.error) throw new Error('Error getting the logs : ' + logResponse.error)

      const logs = logResponse.result as LogData[]
      if (logs.length) {

        // always update the list
        await this.handler.updateNodeList(Math.max(...logs.map(_ => parseInt(_.blockNumber))) || currentBlock)
        res = logs.map(decodeEvent)

        // trigger events
        res.forEach(ev => this.emit(ev.event, ev, this.handler))
      }

    }

    // save block
    this.block = { number: currentBlock, hash: toHex(blockResponse.result.hash, 32) }

    // update validators
    await updateValidatorHistory(this.handler)

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
  const vals: any[] = tx.decodeFunction(inputs.map(_ => _.type), toBuffer(data))

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
abi.forEach(_ => _.hash = toHex(keccak(_.name + '(' + _.inputs.map(i => i.type).join(',') + ')'), 32))


function handleUnregister(ev, handler: RPCHandler) {
  const me = util.getAddress(handler.config.privateKey)
  if (ev.owner !== me || ev.caller === me) return
  logger.info('LogServerUnregisterRequested event found. Reacting with cancelUnregisteringServer! ')
  handler.getNodeList(false).then(nl => {
    const node = nl.nodes.find(_ => _.url === ev.url)
    if (!node)
      throw new Error('could not find the server in the list')

    return tx.callContract(handler.config.registryRPC || handler.config.rpcUrl, handler.config.registry, 'cancelUnregisteringServer(uint)', [node.index], {
      privateKey: handler.config.privateKey,
      gas: 400000,
      value: 0,
      confirm: true
    })
      .then(_ => logger.info('called successfully cancelUnregisteringServer! '))


  }).catch(err => logger.error('Error handling LogServerUnregisterRequested : ', err))

}