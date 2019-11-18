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

import * as client from 'prom-client'

export default class PromUpdater {

  profile: any
  registry: client.Registry
  gateway: string

  upSince: client.Gauge

  requests: client.Counter
  requestsProof: client.Counter
  requestsSig: client.Counter
  lastRequest: client.Gauge
  requestTime: client.Histogram

  lastStats: any

  /**
   * PromUpdater constructor
   * @param profile
   * @param gateway 
   */
  constructor(profile: any, gateway?: string) {
    if(gateway) this.gateway = gateway
    else this.gateway = 'http://127.0.0.1:9091'
    this.profile = profile
    this.registry = new client.Registry()

    this.upSince = new client.Gauge({ name: 'up_since', help: 'UNIX TS of server start.', labelNames: ['icon', 'url'] })

    this.requests = new client.Counter({ name: 'requests', help: 'Total requests since starting the node.' })
    this.requestsProof = new client.Counter({ name: 'requests_proof', help: 'Total requests with proof.' })
    this.requestsSig = new client.Counter({ name: 'requests_signature', help: 'Total requests with signatures.' })
    this.lastRequest = new client.Gauge({ name: 'last_request', help: 'Last Unix time when a request was recieved.' })
    this.requestTime = new client.Histogram({ name: 'request_time', help: 'A histogram for request timings', 
    buckets: [1, 3, 5, 8, 10, 12, 16] })
  }

  /**
   * converts stats to metrics and pushes them to the pushgateway
   * @param stats 
   */
  update(stats: object) {
    this.convert(stats)
    this.push()
  }

  /**
   * Converts Stats to Metrics and adds them to the registry
   * @param stats
   */
  private convert(stats: any) {
    if(this.lastStats) {
      if(this.lastStats.requests <= stats.requests)
        this.requests.inc(stats.requests - this.lastStats.requests)

      if(this.lastStats.requests_proof <= stats.requests_proof)
        this.requestsProof.inc(stats.requests_proof - this.lastStats.requests_proof)

      if(this.lastStats.requests_sig <= stats.requests_sig)
        this.requestsSig.inc(stats.requests_sig - this.lastStats.requests_sig)

      if(this.lastStats.requests < stats.requests)
        this.requestTime.observe(stats.request_time)  
    }
    else {
      this.requests.inc(stats.requests)
      this.requestsProof.inc(stats.requests_proof)
      this.requestsSig.inc(stats.requests_sig)
      if(stats.requests !== 0)
        this.requestTime.observe(stats.request_time)  
    }

    this.upSince.set({ icon: (this.profile.icon ? this.profile.icon : 'nop'), url: (this.profile.url ? this.profile.url : 'nop') }, stats.upSince)
    this.lastRequest.set(stats.lastRequest)
    
    this.registry.registerMetric(this.upSince)
    this.registry.registerMetric(this.requests)
    this.registry.registerMetric(this.requestsProof)
    this.registry.registerMetric(this.requestsSig)
    this.registry.registerMetric(this.lastRequest)
    this.registry.registerMetric(this.requestTime)

    this.lastStats = {...stats}
  }

  /**
   * Pushes a registry to the gateway
   * @param registry 
   * @param jobName 
   */
  private push(registry?: client.Registry, jobName?: string) {
    new client.Pushgateway(this.gateway, {}, (registry ? registry : this.registry))
    .push({ jobName: (jobName ? jobName : this.profile.name) }, (err, resp, body) => {})
  }
}