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
import { util } from 'in3-common'
import { IN3RPCConfig, IN3RPCHandlerConfig, validationDef as typeDefs } from '../types/types'
import * as cargs from 'args'

const safeMinBlockHeights = {
  '0x1': 10,  // mainnet
  '0x5': 5,   // goerli
  '0x2a': 5   // kovan
}

export function getSafeMinBlockHeight(chainId: string) {
  return safeMinBlockHeights[chainId || '0x1'] || safeMinBlockHeights['0x1']
}

// defaults for the config
const config: IN3RPCConfig = {
  port: 8500,
  maxPointsPerMinute: 60 * 100, // per scond max a 100 points request
  maxBlocksSigned: 10,
  maxSignatures: 5,
  chains: {
    '0x1': {
      rpcUrl: 'http://localhost:8545',
      privateKey: '',
      minBlockHeight: getSafeMinBlockHeight('0x1'),
      registry: '',     // registry-contract
      registryRPC: '',
    }
  }
}

const options: any = []
function parseDef(def: { properties: any, type: string }, targetPath = [], targetOb: any, prefix = '') {
  for (const p of Object.keys(def.properties).filter(_ => _ !== 'port')) {
    const val = def.properties[p]
    if (val.type === 'object') {
      if (val.properties)
        parseDef(val, [...targetPath, p], targetOb, prefix + p + '-')
      else
        continue

    }
    else
      options.push({
        name: prefix + p,
        description: val.description,
        init: v => {
          const t = targetPath.reduce((t, pp) => t[pp] || (t[pp] = {}), targetOb)

          switch (val.type) {
            case 'number':
            case 'integer':
              return t[p] = parseInt(v)
            case 'boolean':
              return t[p] = v === 'true'
            default:
              return t[p] = v
          }
        },
        defaultValue: val.default
      })
  }
}

export function readCargs(): IN3RPCConfig {

  // take the config from config.json and overwrite it
  try {
    Object.assign(config, JSON.parse(fs.readFileSync('config.json', 'utf-8')))
  }
  catch (err) {
    console.error('no config found (' + err + ')! using defaults')
  }

  const handler: IN3RPCHandlerConfig = { ...config.chains['0x2a'] }
  parseDef(typeDefs.IN3RPCConfig, [], config)
  parseDef(typeDefs.IN3RPCHandlerConfig, [], handler)
  options.push({
    name: 'chain', description: 'chainId', init: chainId => {
      config.chains = { [chainId]: handler }
      return chainId
    }
  })
  options.push({
    name: 'cache', type: 'boolean', description: 'cache merkle tries', init: cache => cache, default: false
  })

  const vals = cargs.options(options)

  //load the command line arguments
  const processedArgs = vals.parse(process.argv, { mri: { string: options.map(_ => _.name) } })

  // fix chainIds to minHex and enable or disable cache
  Object.keys(config.chains).filter(_ => util.toMinHex(_) != _).forEach(c => {
    config.chains[util.toMinHex(c)] = config.chains[c]
    delete config.chains[c]
  })

  // set the cache
  Object.keys(config.chains).forEach(c => (config.chains[c] as any).useCache = processedArgs.cache !== 'false')

  return config
}

export default config
