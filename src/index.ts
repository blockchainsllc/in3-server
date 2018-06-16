import *  as rpc from './server/rpc'
import *  as server from './server/server'
import _config from './server/config'
import { IN3RPCConfig } from 'in3'

/** the default rpc-handler */
export type RPC = rpc.RPC

export const s = server.app

/** the configuration */
export const config: IN3RPCConfig = _config

