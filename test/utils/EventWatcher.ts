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