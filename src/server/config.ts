import * as fs from 'fs'
import { IN3RPCConfig, util } from 'in3'
// defaults for the config
const config: IN3RPCConfig = {
  port: 8500,
  chains: {
    '0x2a': {
      rpcUrl: 'https://kovan.infura.io/HVtVmCIHVgqHGUgihfhX', //'http://localhost:8545',
      privateKey: '',
      minBlockHeight: 6,
      registry: '0x013b82355a066A31427df3140C5326cdE9c64e3A', // registry-contract
      registryRPC: 'https://kovan.infura.io/HVtVmCIHVgqHGUgihfhX',
    }
  }
}

// take the config from config.json and overwrite it
try {
  Object.assign(config, JSON.parse(fs.readFileSync('config.json', 'utf-8')))
}
catch (err) {
  console.error('no config found (' + err + ')! using defaults')
}

// fix chainIds to minHex
for (const c of Object.keys(config.chains)) {
  const min = util.toMinHex(c)
  if (min != c) {
    config.chains[min] = config.chains[c]
    delete config.chains[c]
  }
}


export default config