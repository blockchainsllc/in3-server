import * as fs from 'fs'
import { IN3RPCConfig, IN3RPCHandlerConfig, util, typeDefs } from 'in3'
import * as cargs from 'args'

const options: any = []
function parseDef(def: { properties: any, type: string }, targetPath = [], targetOb: any, prefix = '') {
  for (const p of Object.keys(def.properties)) {
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




// defaults for the config
const config: IN3RPCConfig = {
  port: 8500,
  chains: {
    '0x2a': {
      rpcUrl: 'https://kovan.infura.io/HVtVmCIHVgqHGUgihfhX', //'http://localhost:8545',
      privateKey: '',
      minBlockHeight: 6,
      registry: '0x013b82355a066A31427df3140C5326cdE9c64e3A', // registry-contract
      registryRPC: '',
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

const handler: IN3RPCHandlerConfig = { ...config.chains['0x2a'] }
parseDef(typeDefs.IN3RPCConfig, [], config)
parseDef(typeDefs.IN3RPCHandlerConfig, [], handler)
options.push({
  name: 'chain', description: 'chainId', init: chainId => {

    config.chains = { [chainId]: handler }
    return chainId
  }
})

const vals = cargs.options(options)
const val2 = !process.env.CI && vals.parse(process.argv, { mri: { string: options.map(_ => _.name) } })



// fix chainIds to minHex
for (const c of Object.keys(config.chains)) {
  const min = util.toMinHex(c)
  if (min != c) {
    config.chains[min] = config.chains[c]
    delete config.chains[c]
  }
}

export default config