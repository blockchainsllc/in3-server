import EthHandler from './EthHandler'
import { IN3RPCHandlerConfig, util } from 'in3'
import * as fs from 'fs'
import * as scryptsy from 'scrypt.js'
import * as cryp from 'crypto'
import * as ethUtil from 'ethereumjs-util'
import { registerServers } from '../util/registry'



export function checkPrivateKey(config: IN3RPCHandlerConfig) {
  if (!config.privateKey)
    throw new Error('No private key set, which is needed in order to sign blockhashes')

  const key = config.privateKey
  if (key.startsWith('0x')) {
    if (key.length != 66) throw new Error('The private key needs to have a length of 32 bytes!')
    return
  }
  const password = config.privateKeyPassphrase

  try {
    const json = JSON.parse(fs.readFileSync(key, 'utf8'))
    if (json.version !== 3)
      throw new Error('Not a valid V3 wallet')

    let derivedKey: any

    if (json.crypto.kdf === 'scrypt') {
      const kdfparams = json.crypto.kdfparams;
      derivedKey = scryptsy(new Buffer(password), new Buffer(kdfparams.salt, 'hex'), kdfparams.n, kdfparams.r, kdfparams.p, kdfparams.dklen)
    } else if (json.crypto.kdf === 'pbkdf2') {
      const params = json.crypto.kdfparams;

      if (params.prf !== 'hmac-sha256')
        throw new Error('Unsupported parameters to PBKDF2')

      derivedKey = cryp.pbkdf2Sync(new Buffer(password), new Buffer(params.salt, 'hex'), params.c, params.dklen, 'sha256')
    } else
      throw new Error('Unsupported key derivation scheme')

    const ciphertext = new Buffer(json.crypto.ciphertext, 'hex');
    const mac = ethUtil.sha3(Buffer.concat([derivedKey.slice(16, 32), ciphertext])).replace('0x', '')
    if (mac !== json.crypto.mac)
      throw new Error('Key derivation failed - possibly wrong password');

    const decipher = cryp.createDecipheriv(json.crypto.cipher, derivedKey.slice(0, 16), new Buffer(json.crypto.cipherparams.iv, 'hex'))
    config.privateKey = '0x' + Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('hex')

  } catch (ex) {
    throw new Error('Could not decode the private : ' + ex.message)
  }

}

export async function checkRegistry(handler: EthHandler): Promise<any> {
  if (!handler.config.registry || !handler.config.autoRegistry) {
    // TODO get it from the chainRegistry?
    // we will get the registry from the 
    return
  }

  checkPrivateKey(handler.config)

  const autoReg = handler.config.autoRegistry
  const nl = await handler.getNodeList(false)
  if (nl.nodes.find(_ => _.url === autoReg.url))
    // all is well we are already registered
    return

  const units = {
    ether: 1000000000000000000,
    finney: 1000000000000000,
    szabo: 1000000000000,
    gwei: 1000000000,
    nano: 1000000000,
    mwei: 1000000,
    pico: 1000000,
    kwei: 1000,
    wei: 1
  }
  const unit = autoReg.depositUnit || 'ether'
  if (!units[unit]) throw new Error('The unit ' + unit + ' is not supported, only ' + Object.keys(units).join())
  const caps = autoReg.capabilities || {}
  const deposit = '0x' + util.toBN(autoReg.deposit || 0).mul(util.toBN(units[unit])).toString(16)
  const props = util.toHex((caps.proof ? 1 : 0) + (caps.multiChain ? 2 : 0))

  await registerServers(handler.config.privateKey, handler.config.registry, [{
    url: autoReg.url,
    pk: handler.config.privateKey,
    props,
    deposit: deposit as any
  }], handler.chainId, undefined, handler.config.registryRPC || handler.config.rpcUrl, undefined, false)
}

