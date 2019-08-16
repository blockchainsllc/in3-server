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

import * as pg from 'pg-promise'
import config from '../server/config'
import { IN3RPCHandlerConfig, validationDef as typeDefs } from '../model/types'


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

