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

  jobName: string
  registry: client.Registry
  gateway: string

  requests: client.Counter
  requests_proof: client.Counter
  requests_sig: client.Counter
  lastrequest: client.Gauge

  /**
   * PromUpdater constructor
   * @param name
   * @param gateway 
   */
  constructor(name: string, gateway?: string) {
    if(gateway) this.gateway = gateway
    else this.gateway = 'http://127.0.0.1:9091'
    this.jobName = name
    this.registry = new client.Registry()

    this.requests = new client.Counter({ name: 'requests', help: 'Total requests since starting the node.' })
    this.requests_proof = new client.Counter({ name: 'requests_proof', help: 'Total requests with proof.' })
    this.requests_sig = new client.Counter({ name: 'requests_signature', help: 'Total requests with signatures.' })
    this.lastrequest = new client.Gauge({ name: 'last_request', help: 'Last Unix time when a request was recieved.' })
  }

  /**
   * converts stats to metrics and pushes them to tge pushgateway
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
    this.requests.reset()
    this.requests_proof.reset()
    this.requests_sig.reset()
    this.lastrequest.reset()
    
    this.requests.inc(stats.requests)
    this.requests_proof.inc(stats.requests_proof)
    this.requests_sig.inc(stats.requests_sig)
    this.lastrequest.set(stats.lastRequest)

    this.registry.registerMetric(this.requests)
    this.registry.registerMetric(this.requests_proof)
    this.registry.registerMetric(this.requests_sig)
    this.registry.registerMetric(this.lastrequest)
  }

  /**
   * Pushes a registry to the gateway
   * @param registry 
   * @param jobName 
   */
  private push(registry?: client.Registry, jobName?: string) {
    new client.Pushgateway(this.gateway, {}, (registry ? registry : this.registry))
    .push({ jobName: (jobName ? jobName : this.jobName) }, (err, resp, body) => {})
  }
}