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



import { EventEmitter } from 'events';
export default class EventWatcher {
  eventEmitter: EventEmitter
  events: { name: string, arg: any }[]
  callbacks: (({ name: string, arg: any }) => void)[]

  constructor(ee: EventEmitter, ...events: string[]) {
    this.events = []
    events.forEach(e => ee.on(e, a => this.addEvent(e, a)))
    this.eventEmitter = ee
    this.callbacks = []
  }

  addEvent(name: string, arg: any) {
    const e = { name, arg }
    this.events.push(e)
    this.callbacks.forEach(_ => _(e))
  }

  clear() {
    this.events = []
  }

  getEvent(...eventNames: string[]) {
    return this.events.find(_ => eventNames.indexOf(_.name) >= 0)
  }

  async waitFor(eventNames: string[], timeout = 10000): Promise<{ name: string, arg: any }> {
    const ev = this.getEvent(...eventNames)
    if (ev) return Promise.resolve(ev)
    const start = this.events.length
    let resolved = false
    let tt = null
    return new Promise<any>((resolve, reject) => {
      tt = setTimeout(() => {
        if (!resolved) {
          this.callbacks.splice(this.callbacks.indexOf(cb), 1)
          resolved = true
          reject(new Error('Timeout waiting for events ' + eventNames.join()))
        }
      }, timeout)
      const cb = (e: { name: string, arg: any }) => {
        if (eventNames.indexOf(e.name) >= 0 && !resolved) {
          resolved = true
          if (tt) clearTimeout(tt)
          this.callbacks.splice(this.callbacks.indexOf(cb), 1)
          resolve(e)
        }
      }
      this.callbacks.push(cb)
    })
  }
}