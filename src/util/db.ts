/*******************************************************************************
 * This file is part of the Incubed project.
 * Sources: https://github.com/slockit/in3-c
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



import * as pg from 'pg-promise'
import config from '../server/config'
import { IN3RPCHandlerConfig, validationDef as typeDefs } from '../types/types'


const db = config.id && config.db && (pg({}))(config.db)

export const useDB = !!db
export async function exec(sql, ...params: any[]) {
  return db.manyOrNone(sql, params)
}

export async function initConfig() {
  if (!useDB) return

  const node = (await db.oneOrNone('select chain,handler, rpc_url, min_block_height, private_key, watch_interval, registry, url, deposit, deposit_unit from nodes where id=$1', [config.id]))
  if (!node) throw new Error('There is no configuration for in db for id=' + config.id)

  const handler: IN3RPCHandlerConfig = {
    rpcUrl: 'https://kovan.infura.io/HVtVmCIHVgqHGUgihfhX', //'http://localhost:8545',
    minBlockHeight: 6,
    privateKey: '',
    registry: '0x013b82355a066A31427df3140C5326cdE9c64e3A' // registry-contract
  }

  const autoRegistry = { capabilities: { proof: true, multiChain: true } } as any


  for (const key of Object.keys(node)) {
    const prop = key.replace(/_([a-z0-9])/gm, (m, l) => l.toUpperCase())
    if (!node[key]) continue
    if (typeDefs.IN3RPCConfig.properties[prop])
      config[prop] = node[key]
    else if (typeDefs.IN3RPCHandlerConfig.properties[prop])
      handler[prop] = node[key]
    else if (prop === 'chain')
      config.chains = { [node[key]]: handler }
    else if (['url', 'deposit', 'depositUnit'].indexOf(prop) >= 0) {
      autoRegistry[prop] = node[key]
      handler.autoRegistry = autoRegistry
    }
  }

  return true
}

