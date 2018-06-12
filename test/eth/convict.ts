
import { assert, expect, should } from 'chai'
import 'mocha'
import Client, { chainData, util, BlockData, serialize, Signature } from 'in3'
import { deployChainRegistry, registerServers } from '../../src/util/registry';
import * as tx from '../../src/util/tx'
import * as logger from 'in3/js/test/util/memoryLogger'
import * as ethUtil from 'ethereumjs-util'
import { LoggingAxiosTransport, TestTransport } from '../utils/transport'

const bytes32 = serialize.bytes32
const toNumber = util.toNumber

const sign = (b: BlockData, pk: string, blockHash?: string) => {
  const msgHash = ethUtil.sha3(Buffer.concat([bytes32(blockHash || b.hash), bytes32(b.number)]))
  const sig = ethUtil.ecsign(msgHash, bytes32(pk)) as Signature
  sig.block = toNumber(b.number)
  sig.blockHash = blockHash || b.hash
  sig.address = util.getAddress(pk)
  return sig
}

describe('Convict', () => {
  it('call convict', async () => {


    const transport = new LoggingAxiosTransport()
    const test = new TestTransport(2)
    const pk = await test.createAccount('0xb903239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238')
    const pk2 = await test.createAccount('0xaaaa239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238')
    const sender = util.getAddress(pk2)

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


    // read current Block
    const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

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

  })
})

