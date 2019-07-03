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

import * as fs from 'fs'
import { IN3RPCConfig, IN3RPCHandlerConfig, util, typeDefs } from 'in3'
import * as cargs from 'args'


class SentryError extends Error {
  constructor(message?: string) {
    const Sentry = require('@sentry/node');
    Sentry.init({ dsn: 'https://1aca629ca89c42a6b5601fcce6499103@sentry.slock.it/5' });
    super(message)
    console.log("Inside Sentry Constructor!!!")
    console.log(message)
    Sentry.captureException(message)
  }
}

// defaults for the config
const config: IN3RPCConfig = {
  port: 8500,
  chains: {
    '0x2a': {
      rpcUrl: 'https://kovan.infura.io/HVtVmCIHVgqHGUgihfhX',   //'http://localhost:8545',
      privateKey: '',
      minBlockHeight: 6,
      registry: '0x013b82355a066A31427df3140C5326cdE9c64e3A',     // registry-contract
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
  for (const c of Object.keys(config.chains)) {
    const min = util.toMinHex(c)
    if (min != c) {
      config.chains[min] = config.chains[c]
      delete config.chains[c]
    }

    //explicit command must be specified to disable cache else it is enabled
    if (processedArgs.cache === 'false') {
      (config.chains[c] as any).useCache = false
    }
    else {
      (config.chains[c] as any).useCache = true
    }

  }

  return config
}

export default config
