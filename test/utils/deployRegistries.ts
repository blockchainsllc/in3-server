import * as reg from '../../src/util/registry';
import { LoggingAxiosTransport } from '../utils/transport'

const ownerPK = '0xb858a0f49ce12df65031ba0eb0b353abc74f93f8ccd43df9682fd2e2293a4db3'
const chainRegistry = '0x013b82355a066A31427df3140C5326cdE9c64e3A'
const kovanClient = 'https://rpc-kovan.slock.it'
const kovanRegistry = '0xb9a2bB17675206F3233bF426eB4b64900F63cd28'

//deployAll().then(console.log, err => console.log('ERROR:' + err))


export async function deployAll() {
  //  const chainRegistry = await deployChainRegistry(ownerPK, kovanClient)
  console.log('Chain Registry : ' + chainRegistry)

  const r = await reg.registerChains(ownerPK, chainRegistry, [{
    chainId: '0x000000000000000000000000000000000000000000000000000000000000002a',
    bootNodes: ['0xa1bB1860c4aBF6F050F36cf672679d940c916a18:https://in3-kovan1.slock.it'],
    meta: 'about:blank',
    registryContract: kovanRegistry,
    contractChain: '0x000000000000000000000000000000000000000000000000000000000000002a'
  }], kovanClient)


  console.log('res:', r)

  if (r || !r) return



  // register kovan-servers
  const registers = await reg.registerServers(ownerPK, kovanRegistry, [{
    url: 'https://in3-kovan1.slock.it',
    pk: ownerPK,
    props: '0xFFFF',
    deposit: 0
  }], '0x000000000000000000000000000000000000000000000000000000000000002a', chainRegistry, kovanClient, new LoggingAxiosTransport())

  console.log('kovan-registry ' + JSON.stringify(registers, null, 2))
}



