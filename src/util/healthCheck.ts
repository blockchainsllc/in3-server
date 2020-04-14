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

import * as logger from '../util/logger'
import { setOpError } from '../server/server'

export default class HealthCheck {

    _health: number             // health meter of server (0 to 5) where 5 is highest
    _lastBlockTime: number      // clock tick when last block was detected
    _interval: any              // reference of setInterval
    interval: number            // duration after which setInterval is invoked
    running: boolean            //flag for determing if healthcheck is running
    
    maxBlockTimeout: number     //max time out allowed until new block must be detectable 

    /**
     *constructor 
     *block timeout: max time supposed in which a block must be detected by server, it is configurable using watchBlockTimeout (ms) default is 120 sec
     *interval : after each interval duration a function (checkHealth()) will check that how much duration it took since last block
    */
    constructor(blockTimeout , interval = 45000) {
        this.maxBlockTimeout = blockTimeout
        this.interval = interval
        this.running = false
        this._lastBlockTime = 0
        this._health = 5  //5 is max health
    }

    /**
     * Function for stopping healthcheck
     */
    stop() {
        if (this.running) {
            this.running = false
            if (this._interval) {
                clearInterval(this._interval)
                this._interval = undefined
            }
        }
    }

    /**
     * Function for starting healthcheck interval, in case of error it will stop permenently and mark server unhealthy
     */
    start() {
        if (!this.running) {
            logger.info('Starting health monitoring ...')
            this.running = true

            try {
                this._interval = setInterval(() => this.checkHealth(), this.interval)
                this._lastBlockTime = new Date().getTime() //assuming every thing is good at start
            } catch (err) {
                setOpError(err)
                this.stop()
            }
        }
    }

    /*
    * Funciton for checking health, currently there is one vital sign as if a new block is detected by server or not
    * if no new block is detectable in maxBlockTimeout it will reduce health, until it will close server process
    */
    checkHealth() {
        logger.debug("checking health ... ["+this._health+"/5]")
        let duration: number = new Date().getTime() - this._lastBlockTime

        if( this._lastBlockTime == 0 || duration >= this.maxBlockTimeout ){
            setOpError(new Error("Watcher error. No new block is detected in "+( duration/1000 )+" sec. Max allowed time is "+(this.maxBlockTimeout/1000)+" sec "+"["+this._health+"]"))
            this._health--
        }

        if(this._health == 0){
            setOpError(new Error("Watcher is unhealthy so exiting server. Last block detected "+(duration/1000)+" sec ago."))
            process.exit(1)
        }
    }

    /*
    * Function for updating lastBlockTime
    */
    updateBlock(){
        logger.debug("New block detected in health check")
        this._lastBlockTime = new Date().getTime()
    }
}