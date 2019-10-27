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

import * as fs from 'fs'
import { EventEmitter } from 'events'
import { util, LogData, serialize } from 'in3-common'
import { keccak, toChecksumAddress } from 'ethereumjs-util'

import { RPCHandler } from '../server/rpc';
import { getABI } from '../util/registry'
import * as logger from '../util/logger'
import * as tx from '../util/tx'
import { useDB, exec } from '../util/db'
import config from '../server/config'
import { updateValidatorHistory } from '../server/poa';
import { SentryError } from '../util/sentryError';

const toNumber = util.toNumber
const toHex = util.toHex
const toMinHex = util.toMinHex
const toBuffer = util.toBuffer
const address = serialize.address


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
  blockhashRegistry: string

  _convictInformation: {
    starttime: number,
    diffBlocks: number,
    blocksToRecreate?: {
      bNr: number,
      firstSeen: number,
      currentBnr: number
    }[],
    convictBlockNumber: number,
    signer: string,
    wrongBlockHash: string,
    wrongBlockNumber: string,
    v: number,
    r: string,
    s: string,
    recreationDone: boolean,
    latestBlock?: number,
    signingNode: any,
    signature: string
  }

  futureConvicts: any[]

  constructor(handler: RPCHandler, interval = 5, persistFile = 'false', startBlock?: number) {
    super()
    this.handler = handler
    this.interval = interval
    this.persistFile = persistFile === 'false' ? '' : persistFile
    if (startBlock)
      this._lastBlock = { number: startBlock, hash: toHex(0, 32) }

    this.futureConvicts = []
    // regsiter Cancel-Handler for 
    this.on('LogNodeUnregisterRequested', handleUnregister)

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

    await this.handleConvict(currentBlock)

    return res
  }

  async handleConvict(currentBlock) {

    for (const ci of this.futureConvicts) {

      const costPerBlock = 86412400000000

      // adding 1 to prevent 0 costs
      const costs = ci.diffBlocks + 1 * costPerBlock * 1.25

      const worthIt = costs < ci.signingNode.deposit / 2

      if (worthIt && ci.convictBlockNumber === 0) {
        await tx.callContract(this.handler.config.rpcUrl, this.handler.config.registry, 'convict(bytes32)', [ci.signature], {
          privateKey: this.handler.config.privateKey,
          value: 0,
          confirm: true
        })

        ci.convictBlockNumber = this.block.number

      }

      if (ci.diffBlocks) {
        if (!ci.blocksToRecreate) {
          ci.blocksToRecreate = []
          let latestSS = toNumber((await tx.callContract(this.handler.config.rpcUrl, this.blockhashRegistry, 'searchForAvailableBlock(uint,uint):(uint)', [ci.wrongBlockNumber, ci.diffBlocks]))[0])

          if (latestSS === 0) latestSS == this.block.number
          ci.latestBlock = latestSS

          // we did not found an entry in the registry yet, so we would have to create one
          if (latestSS === this.block.number && worthIt) {

            await tx.callContract(this.handler.config.rpcUrl, this.blockhashRegistry, 'saveBlockNumber(uint):()', [this.block.number], {
              privateKey: this.handler.config.privateKey,
              value: 0,
              confirm: false
            }).catch(_ => {
              new SentryError(_, "saveBlocknumber")
            })
          }

          let currentRecreateBlock = latestSS

          // due to geth, we can only recreate 45 blocks at once
          while (currentRecreateBlock - 45 > ci.wrongBlockNumber) {
            currentRecreateBlock -= 45
            ci.blocksToRecreate.push({ number: currentRecreateBlock, firstSeen: null, currentBnr: null })
          }
          ci.blocksToRecreate[0].firstSeen = this.block.number
          ci.blocksToRecreate[0].currentBnr = this.block.number

          ci.blocksToRecreate.push({ number: ci.wrongBlockNumber, firstSeen: null, currentBnr: null })

        }

        for (const blocksToRecreate of ci.blocksToRecreate) {

          if (blocksToRecreate.firstSeen && worthIt) {

            const blockHashInContract = (await tx.callContract(this.handler.config.rpcUrl, this.blockhashRegistry, 'blockhashMapping(uint):(bytes32)', [blocksToRecreate.number]))[0]

            if (blockHashInContract === "0x0000000000000000000000000000000000000000000000000000000000000000") {
              blocksToRecreate.currentBnr++

              if (blocksToRecreate.currentBnr >= blocksToRecreate.firstSeen + 5) {

                const blockNumbers = []
                for (let i = ci.latestBlock; i > blocksToRecreate.number; i--) {
                  blockNumbers.push(i)
                }

                const blockrequest = []
                for (let i = 0; i < blockNumbers.length; i++) {
                  blockrequest.push({
                    jsonrpc: '2.0',
                    id: i + 1,
                    method: 'eth_getBlockByNumber', params: [
                      toHex(blockNumbers[i]), false
                    ]
                  })
                }

                const blockhashes = await this.handler.getAllFromServer(blockrequest)

                const serialzedBlocks = []
                for (const bresponse of blockhashes) {
                  serialzedBlocks.push(new serialize.Block(bresponse.result as any).serializeHeader());
                }

                await tx.callContract(this.handler.config.rpcUrl, this.blockhashRegistry, 'recreateBlockheaders(uint,bytes[])', [blockNumbers[0], serialzedBlocks], {
                  privateKey: this.handler.config.privateKey,
                  value: 0,
                  confirm: true
                }).catch(_ => {
                  new SentryError(_, "recreateBlockheaders")
                })

                ci.latestBlock = toNumber((await tx.callContract(this.handler.config.rpcUrl, this.blockhashRegistry, 'searchForAvailableBlock(uint,uint):(uint)', [blocksToRecreate.number - 10, 20]))[0])
                ci.blocksToRecreate = ci.blocksToRecreate.length > 1 ? ci.blocksToRecreate.slice(1) : ci.blocksToRecreate = []

                if (ci.blocksToRecreate.length > 0) {
                  ci.blocksToRecreate[0].firstSeen = this.block.number
                  ci.blocksToRecreate[0].currentBnr = this.block.number
                }
                else {
                  ci.recreationDone = true
                }


              }

            } else {
              ci.blocksToRecreate = ci.blocksToRecreate.length > 1 ? ci.blocksToRecreate.slice(1) : ci.blocksToRecreate = []
            }

          }

        }

      }
      if (ci.diffBlocks === 0) {
        ci.recreationDone = true
      }

      if (ci.convictBlockNumber + 3 < currentBlock && ci.recreationDone && worthIt) {

        await tx.callContract(this.handler.config.registryRPC || this.handler.config.rpcUrl, this.handler.config.registry, 'revealConvict(address,bytes32,uint,uint8,bytes32,bytes32)',
          [ci.signer, ci.wrongBlockHash, ci.wrongBlockNumber, ci.v, ci.r, ci.s], {
          privateKey: this.handler.config.privateKey,
          gas: 600000,
          value: 0,
          confirm: true
        }).catch(_ => {
          new SentryError(_, "convict_error", "error reveal convict")
        })

        this.futureConvicts.pop()
      }
    }
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

const abi = getABI('NodeRegistry').filter(_ => _.type === 'event') as {
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



