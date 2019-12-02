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


import { RPCRequest, IN3RPCConfig } from '../types/types'
import PromUpdater from '../util/prometheus'

export class Stat {

  data: {
    requests: number
    requests_proof: number
    requests_sig: number
    requests_error: number
    lastRequest: number
    methods: { [name: string]: number }
  }
  parent: Stat
  id: number

  constructor(parent?: Stat) {
    this.data = { requests: 0, requests_proof: 0, requests_sig: 0, requests_error: 0, lastRequest: 0, methods: {} }
    this.parent = parent
  }

  update(r: RPCRequest, proof: boolean = false, sig: boolean = false, isError = false) {
    if (r.in3 && ((r.in3 as any).noStats)) return
    this.data.requests++
    if (isError) this.data.requests_error++
    if (proof) this.data.requests_proof++
    if (sig) this.data.requests_sig++
    this.data.methods[r.method] = (this.data.methods[r.method] || 0) + 1
    this.data.lastRequest = Date.now()
    if (this.parent)
      this.parent.update(r, proof, sig, isError)
  }

  check(id) {
    if (!this.id)
      this.id = id
    else if (this.id !== id) {
      this.data.lastRequest = 0
      this.data.methods = {}
      this.data.requests = 0
    }
  }
}






export const currentTotal = new Stat()
export const currentMonth = new Stat(currentTotal)
export const currentDay = new Stat(currentMonth)
export const currentHour = new Stat(currentDay)

const stats = {
  upSince: Date.now(),
  currentMonth: currentMonth.data,
  currentDay: currentDay.data,
  currentHour: currentHour.data,
  currentTotal: currentTotal.data
}

export function getStats() {
  return stats
}

function check() {
  const d = new Date()
  currentHour.check(d.getHours())
  currentDay.check(d.getDate())
  currentMonth.check(d.getMonth())
  // currentTotal.check(1) : not needed since no reset required

  setTimeout(check, 3600000 - ((d.getSeconds() + d.getMinutes() * 60) * 1000 + d.getMilliseconds()))

}

check()


let buffer: number[] = []
/**
 * Adds a request time to the buffer
 * @param ms 
 */
export function submitRequestTime(ms: number) {
  buffer.push(ms)
}

/**
 * Calculates the average of the given numbers
 * @param numbers 
 */
function calcAverage(numbers: number[]) {
  if (numbers.length === 0) return 0
  let sum = 0
  for (let num of numbers)
    sum += num
  return parseFloat((sum / numbers.length).toFixed(2))
}

/**
 * Schedule pushing to prometheus with the current total stats every 10 sec
 * - Name has to be set, noStats has to be false
 * @param config 
 */
export function schedulePrometheus(config: IN3RPCConfig) {
  if (!config.profile) return
  if (config.profile && config.profile.noStats) return // saves power
  if (!config.profile.name) return
  const prometheus = new PromUpdater(config.profile /* , 'http://127.0.0.1:9091' */)
  setInterval(() => {
    let avgTime = calcAverage(buffer)
    let push = {
      ...stats.currentTotal,
      request_time: avgTime,
      upSince: stats.upSince
    }
    buffer = []
    prometheus.update(push)
  }, 5 * 1000)
}