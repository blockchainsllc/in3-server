import { Stat } from "../server/stats"

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

  /**
   * PromUpdater contructor
   * @param name
   * @param gateway 
   */
  constructor(name: string, gateway?: string) {
    if(gateway) this.gateway = gateway
    else this.gateway = 'http://127.0.0.1:9091'
    this.jobName = name
    this.registry = new client.Registry()
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
   */
  private convert(stats: any) {
    const requests = new client.Counter({ name: 'requests', help: 'total requests since starting the node.' })
    const lastrequest = new client.Gauge({ name: 'last_request', help: 'Last Unix time when a request was recieved.' })
    
    requests.reset()
    lastrequest.reset()

    requests.inc(stats.requests)
    lastrequest.set(stats.lastRequest)

    this.registry.registerMetric(requests)
    this.registry.registerMetric(lastrequest)
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