import *  as rpc from './server/rpc'
import *  as server from './server/server'
import _config from './server/config'

/** the default rpc-handler */
export type RPC = rpc.RPC

export const s = server.app

/** the configuration */
export const config = _config