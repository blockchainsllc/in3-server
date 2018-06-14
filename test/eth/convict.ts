
import { assert } from 'chai'
import 'mocha'
import { util, BlockData, serialize, Signature, RPCRequest, RPCResponse } from 'in3'
import { registerServers } from '../../src/util/registry';
import * as tx from '../../src/util/tx'
import * as ethUtil from 'ethereumjs-util'
import { LoggingAxiosTransport, TestTransport } from '../utils/transport';
import Watcher from '../../src/chains/watch';

const bytes32 = serialize.bytes32
const toNumber = util.toNumber
const toHex = util.toHex

const sign = (b: BlockData, pk: string, blockHash?: string) => {
  const msgHash = ethUtil.sha3(Buffer.concat([bytes32(blockHash || b.hash), bytes32(b.number)]))
  const sig = ethUtil.ecsign(msgHash, bytes32(pk)) as Signature
  sig.block = toNumber(b.number)
  sig.blockHash = blockHash || b.hash
  sig.address = util.getAddress(pk)
  sig.msgHash = toHex(msgHash, 32)
  return sig
}


describe('Convict', () => {
  it('convict on contracts', async () => {


    const transport = new LoggingAxiosTransport()
    let test = new TestTransport(2)
    const pk = await test.createAccount('0xb903239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238')
    const pk2 = await test.createAccount('0xaaaa239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238')
    const sender = util.getAddress(pk2)
    // read current Block
    const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

    //  register 2 servers
    const registers = await registerServers(pk, null, [{
      url: '#1',
      pk,
      props: '0xFF',
      deposit: 100000
    },
    {
      url: '#2',
      pk: pk2,
      props: '0xFF',
      deposit: 50000
    }], '0x99', null, test.url, transport)

    test = new TestTransport(2, registers.registry, [pk, pk2])




    const watcher = new Watcher(test.handlers['#1'].getHandler(), 0, null, toNumber(block.number))

    // correct blockhash 
    let s = sign(block, pk)

    // must fail, since we cannot convict with a correct blockhash
    let rc = await tx.callContract(test.url, registers.registry, 'convict(uint,bytes32,uint,uint8,bytes32,bytes32)', [0, s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: pk2,
      gas: 300000,
      value: 0,
      confirm: true
    }).catch(_ => false)

    assert.isFalse(rc, 'Transaction must fail, because we sent the correct hash')

    // wrong blockhash signed by first node
    s = sign(block, pk, pk)

    // get the balance
    const balanceSenderBefore = toNumber(await test.getFromServer('eth_getBalance', sender, 'latest'))
    const balanceRegistryBefore = toNumber(await test.getFromServer('eth_getBalance', registers.registry, 'latest'))


    rc = await tx.callContract(test.url, registers.registry, 'convict(uint,bytes32,uint,uint8,bytes32,bytes32)', [0, s.blockHash, s.block, s.v, s.r, s.s], {
      privateKey: pk2,
      gas: 300000,
      value: 0,
      confirm: true
    })

    const balanceSenderAfter = toNumber(await test.getFromServer('eth_getBalance', sender, 'latest'))
    const balanceRegistryAfter = toNumber(await test.getFromServer('eth_getBalance', registers.registry, 'latest'))

    assert.equal(balanceSenderAfter - balanceSenderBefore, 100000 / 2)
    assert.equal(balanceRegistryBefore - balanceRegistryAfter, 100000)
    const events = await watcher.update()
    assert.equal(events.length, 4)

  })



  it('verify and convict', async () => {


    const transport = new LoggingAxiosTransport()
    const pk1 = '0xb903239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238'
    const pk2 = '0xaaaa239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238'
    const pks = [pk1, pk2]
    let test = await new TestTransport(1)

    for (const a of pks) await test.createAccount(a)


    //  register 2 servers
    const registers = await registerServers(pk1, null, [{
      url: '#1',
      pk: pk1,
      props: '0xFF',
      deposit: 100000
    },
    {
      url: '#2',
      pk: pk2,
      props: '0xFF',
      deposit: 50000
    }], '0x99', null, test.url, transport)
    const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

    test = new TestTransport(2, registers.registry, pks)

    const client = await test.createClient()

    // this is a correct signature and should not fail.
    const res = await client.sendRPC('eth_getBalance', [util.getAddress(pk1), 'latest'], undefined, {
      keepIn3: true, proof: true, signatureCount: 1, requestCount: 1
    })

    assert.isDefined(res.in3.proof.signatures[0])
    test.injectRandom([0.01, 0.9])
    test.injectRandom([0.02, 0.8])

    let manipulated = false
    test.injectResponse({ method: 'in3_sign' }, (req: RPCRequest, re: RPCResponse, url: string) => {
      const index = parseInt(url.substr(1)) - 1
      // we change it to a wrong signature
      if (!manipulated) {
        re.result = [sign(block, pks[index], pk1)]
        manipulated = true

      }
      return re
    })

    assert.equal(await test.getServerCountFromContract(), 2)

    // we create a new client because the old one may have different weights now
    const client2 = await test.createClient()


    // this is a correct signature and should not fail.
    const res2 = await client2.sendRPC('eth_getBalance', [util.getAddress(pk1), 'latest'], undefined, {
      keepIn3: true, proof: true, signatureCount: 1, requestCount: 1
    })

    // we should get a valid response even though server #0 signed a wrong hash and was convicted server #1 gave a correct one.
    assert.equal(await test.getServerCountFromContract(), 1)
  })

})

