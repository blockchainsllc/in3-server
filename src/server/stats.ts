

import { RPCRequest } from 'in3'



export class Stat {

  data: {
    requests: number
    lastRequest: number
    methods: { [name: string]: number }
  }
  parent: Stat
  id: number



  constructor(parent?: Stat) {
    this.data = { requests: 0, lastRequest: 0, methods: {} }
    this.parent = parent
  }

  update(r: RPCRequest) {
    if (r.in3 && ((r.in3 as any).noStats)) return
    this.data.requests++
    this.data.methods[r.method] = (this.data.methods[r.method] || 0) + 1
    this.data.lastRequest = Date.now()
    if (this.parent)
      this.parent.update(r)
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






export const currentMonth = new Stat()
export const currentDay = new Stat(currentMonth)
export const currentHour = new Stat(currentDay)

const stats = {
  upSince: Date.now(),
  currentMonth: currentMonth.data,
  currentDay: currentDay.data,
  currentHour: currentHour.data,
}

export function getStats() {
  return stats
}

function check() {
  const d = new Date()
  currentHour.check(d.getHours())
  currentDay.check(d.getDate())
  currentMonth.check(d.getMonth())

  setTimeout(check, 3600000 - ((d.getSeconds() + d.getMinutes() * 60) * 1000 + d.getMilliseconds()))

}

check()

