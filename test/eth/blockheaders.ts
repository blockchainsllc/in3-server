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

import { assert } from 'chai'
import 'mocha'
import { util, BlockData, serialize } from 'in3'
import * as tx from '../../src/util/tx'
import { TestTransport } from '../utils/transport'
import { deployBlockhashRegistry } from '../../src/util/registry'
import { Block } from 'in3/js/src/modules/eth/serialize';
import * as fs from 'fs'
import { toUtf8Bytes } from 'ethers/utils';


const blockHeaderFile = JSON.parse(fs.readFileSync('test/blockheader/blockHeaders.json').toString('utf8'))

const toNumber = util.toNumber
const toHex = util.toHex

describe('Blockheader contract', () => {


    it('deploy blockheader contract', async () => {
        const test = await TestTransport.createWithRegisteredNodes(2)
        const pk1 = test.getHandlerConfig(0).privateKey
        const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

        const blockNumber = toNumber(block.number)
        const blockHashRegAddress = await deployBlockhashRegistry(pk1, test.url)
        const contractBlockHash = "0x" + (await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber]))[0].toString('hex')
        await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 1 })

        assert.equal(block.hash, contractBlockHash)

        assert.isFalse(await tx.callContract(test.url, blockHashRegAddress, '()', [], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 10, confirm: true, gas: 300000000 - 1 }).catch(_ => false))
        assert.isFalse(await tx.callContract(test.url, blockHashRegAddress, '()', [], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 1 }).catch(_ => false))

    })

    it('getParentAndBlockhash on privateChain', async () => {
        const test = await TestTransport.createWithRegisteredNodes(2)
        const pk1 = test.getHandlerConfig(0).privateKey
        const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

        const blockHashRegAddress = await deployBlockhashRegistry(pk1, test.url)

        const b = new Block(block)
        const serializedHeader = b.serializeHeader()

        const contractResult = await tx.callContract(test.url, blockHashRegAddress, 'getParentAndBlockhash(bytes):(bytes32,bytes32)', [serializedHeader])
        await tx.callContract(test.url, blockHashRegAddress, 'getParentAndBlockhash(bytes):(bytes32,bytes32)', [serializedHeader], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 })
        assert.isFalse(await tx.callContract(test.url, blockHashRegAddress, 'getParentAndBlockhash(bytes):(bytes32,bytes32)', [serializedHeader], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 10, confirm: true, gas: 300000000 - 10 }).catch(_ => false))

        const parentHash = "0x" + contractResult[0].toString('hex')
        const blockHash = "0x" + contractResult[1].toString('hex')

        assert.equal(parentHash, ((await test.getFromServer('eth_getBlockByHash', block.parentHash, false)) as BlockData).hash)
        assert.equal(blockHash, block.hash)
    })

    it('getParentAndBlockhash on privateChain - underflow', async () => {
        const test = await TestTransport.createWithRegisteredNodes(2)
        const pk1 = test.getHandlerConfig(0).privateKey
        const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

        const blockHashRegAddress = await deployBlockhashRegistry(pk1, test.url)

        const b = new Block(block)
        let serializedHeader = b.serializeHeader()

        // replacing f9 with f1 to provoke an underflow
        serializedHeader[0] = 241

        let failed = false
        try {

            const contractResult = await tx.callContract(test.url, blockHashRegAddress, 'getParentAndBlockhash(bytes):(bytes32,bytes32)', [serializedHeader])

            // we have to send a transaction to the call in order to make sure that the assert is failing (see https://github.com/ethereum/go-ethereum/issues/19027)
            await tx.callContract(test.url, blockHashRegAddress, 'getParentAndBlockhash(bytes):(bytes32,bytes32)', [serializedHeader], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 10, confirm: true, gas: 300000000 - 10 })
        } catch (e) {
            failed = true
        }

        assert.isTrue(failed)
    })

    it('getParentAndBlockhash with real blocks', async () => {
        const test = await TestTransport.createWithRegisteredNodes(2)
        const pk1 = test.getHandlerConfig(0).privateKey

        const blockHashRegAddress = await deployBlockhashRegistry(pk1, test.url)

        const chains = Object.keys(blockHeaderFile);
        for (let j = 0; j < chains.length; j++) {
            const allBlocks = blockHeaderFile[chains[j]];

            const numberBlocks = process.env.GITLAB_CI ? allBlocks.length : 10
            for (let i = 0; i < numberBlocks; i++) {
                const b = new Block(allBlocks[i])
                const s = new serialize.Block(allBlocks[i] as any).serializeHeader()

                const contractResult = await tx.callContract(test.url, blockHashRegAddress, 'getParentAndBlockhash(bytes):(bytes32,bytes32)', [s])
                await tx.callContract(test.url, blockHashRegAddress, 'getParentAndBlockhash(bytes):(bytes32,bytes32)', [s], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 1 })

                const parentHash = "0x" + contractResult[0].toString('hex')
                const blockHash = "0x" + contractResult[1].toString('hex')

                assert.equal(parentHash, allBlocks[i].parentHash)
                assert.equal(blockHash, allBlocks[i].hash)
            }
        }
    }).timeout(300000)

    it('snapshot', async () => {

        const test = await TestTransport.createWithRegisteredNodes(2)
        const pk1 = test.getHandlerConfig(0).privateKey

        const blockHashRegAddress = await deployBlockhashRegistry(pk1, test.url)
        const user1 = await test.createAccount()


        const txReceipt = (await tx.callContract(test.url, blockHashRegAddress, 'snapshot()', [], { privateKey: user1, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 }))
        const blockNumber = (toHex(txReceipt.blockNumber) as any) - 1

        const blockhashRPC = ((await test.getFromServer('eth_getBlockByNumber', toHex(blockNumber), false)) as BlockData).hash
        const blockHashContract = "0x" + (await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber]))[0].toString('hex')
        await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 })
        assert.isFalse(await tx.callContract(test.url, blockHashRegAddress, 'snapshot()', [], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 10, confirm: true, gas: 300000000 - 10 }).catch(_ => false))
        assert.isFalse(await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 10, confirm: true, gas: 300000000 - 10 }).catch(_ => false))


        assert.equal(blockhashRPC, blockHashContract)
    })

    it('saveBlockNumber', async () => {

        const test = await TestTransport.createWithRegisteredNodes(2)
        const pk1 = test.getHandlerConfig(0).privateKey

        const blockHashRegAddress = await deployBlockhashRegistry(pk1, test.url)
        const user1 = await test.createAccount()

        const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

        const blockNumberToSave = toNumber(block.number) - 5

        const blockHashBefore = "0x" + (await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumberToSave]))[0].toString('hex')

        assert.equal(blockHashBefore, '0x0000000000000000000000000000000000000000000000000000000000000000')
        await tx.callContract(test.url, blockHashRegAddress, 'saveBlockNumber(uint)', [blockNumberToSave], { privateKey: user1, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 })

        const blockhashRPC = ((await test.getFromServer('eth_getBlockByNumber', toHex(blockNumberToSave), false)) as BlockData).hash
        const blockHashContract = "0x" + (await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumberToSave]))[0].toString('hex')
        await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumberToSave], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 })

        assert.equal(blockhashRPC, blockHashContract)

        assert.isFalse(await tx.callContract(test.url, blockHashRegAddress, 'saveBlockNumber(uint)', [blockNumberToSave], { privateKey: user1, to: blockHashRegAddress, value: 10, confirm: true, gas: 300000000 - 10 }).catch(_ => false))

    })

    it('saveBlockNumber fail', async () => {
        const test = await TestTransport.createWithRegisteredNodes(2)
        const pk1 = test.getHandlerConfig(0).privateKey

        const blockHashRegAddress = await deployBlockhashRegistry(pk1, test.url)
        const user1 = await test.createAccount()

        const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

        const blockNumberToSave = toNumber(block.number) + 300

        const blockHashBefore = "0x" + (await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumberToSave]))[0].toString('hex')
        await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumberToSave], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 })

        assert.equal(blockHashBefore, '0x0000000000000000000000000000000000000000000000000000000000000000')

        assert.isFalse(await tx.callContract(test.url, blockHashRegAddress, 'saveBlockNumber(uint)', [blockNumberToSave], { privateKey: user1, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 }).catch(_ => false), "must fail becaue ")
        assert.include(await test.getErrorReason(), "block not available")

    })

    it('reCalculateBlockheaders', async () => {
        const test = await TestTransport.createWithRegisteredNodes(2)
        const pk1 = test.getHandlerConfig(0).privateKey

        const blockHashRegAddress = await deployBlockhashRegistry(pk1, test.url)

        const clientVersion = await test.getFromServer('web3_clientVersion')

        const chains = Object.keys(blockHeaderFile);
        for (let j = 0; j < chains.length; j++) {

            let totalBlocks = process.env.GITLAB_CI ? blockHeaderFile[chains[j]] : blockHeaderFile[chains[j]].slice(0, 10)

            //   if (clientVersion.includes("Geth") && allBlocks.length > 10) {

            for (let i = 0; i < totalBlocks.length; i += 45) {

                const allBlocks = totalBlocks.slice(i, i + 45)

                const firstBlock = allBlocks.shift();

                const startHash = allBlocks[allBlocks.length - 1].hash;

                let serialzedBlocks = [];

                for (const b of allBlocks) {
                    const s = new serialize.Block(b as any).serializeHeader()
                    serialzedBlocks.push(s);
                }

                serialzedBlocks = serialzedBlocks.reverse()

                const result = "0x" + (await tx.callContract(test.url, blockHashRegAddress, 'reCalculateBlockheaders(bytes[],bytes32):(bytes32)', [serialzedBlocks, startHash]))[0].toString('hex')
                await tx.callContract(test.url, blockHashRegAddress, 'reCalculateBlockheaders(bytes[],bytes32):(bytes32)', [serialzedBlocks, startHash], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 1 })

                assert.equal(result, firstBlock.hash)

                assert.isFalse(await tx.callContract(test.url, blockHashRegAddress, 'reCalculateBlockheaders(bytes[],bytes32):(bytes32)', [serialzedBlocks, startHash], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 10, confirm: true, gas: 300000000 - 1 }).catch(_ => false))
            }
        }

        //  }
    }).timeout(600000)

    it('reCalculateBlockheaders fail', async () => {
        const test = await TestTransport.createWithRegisteredNodes(2)
        const pk1 = test.getHandlerConfig(0).privateKey

        const blockHashRegAddress = await deployBlockhashRegistry(pk1, test.url)

        const chains = Object.keys(blockHeaderFile);
        for (let j = 0; j < chains.length; j++) {
            let totalBlocks = process.env.GITLAB_CI ? blockHeaderFile[chains[j]] : blockHeaderFile[chains[j]].slice(0, 10)

            for (let i = 0; i < totalBlocks.length; i += 45) {

                const allBlocks = totalBlocks.slice(i, i + 45)

                const firstBlock = allBlocks.shift();

                const startHash = allBlocks[allBlocks.length - 1].hash;

                let serialzedBlocks = [];

                for (const b of allBlocks) {
                    const s = new serialize.Block(b as any).serializeHeader()
                    serialzedBlocks.push(s);
                }

                serialzedBlocks = serialzedBlocks.reverse()
                const temp = serialzedBlocks[2]
                serialzedBlocks[2] = serialzedBlocks[3]
                serialzedBlocks[3] = temp

                const result = "0x" + (await tx.callContract(test.url, blockHashRegAddress, 'reCalculateBlockheaders(bytes[],bytes32):(bytes32)', [serialzedBlocks, startHash]))[0].toString('hex')

                await tx.callContract(test.url, blockHashRegAddress, 'reCalculateBlockheaders(bytes[],bytes32):(bytes32)', [serialzedBlocks, startHash], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 1 })

                assert.equal(result, "0x0000000000000000000000000000000000000000000000000000000000000000")

                assert.isFalse(await tx.callContract(test.url, blockHashRegAddress, 'reCalculateBlockheaders(bytes[],bytes32):(bytes32)', [serialzedBlocks, startHash], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 10, confirm: true, gas: 300000000 - 1 }).catch(_ => false))
            }
        }
    }).timeout(600000)

    it('reCalculateBlockheaders fail due to underflow', async () => {
        const test = await TestTransport.createWithRegisteredNodes(2)
        const pk1 = test.getHandlerConfig(0).privateKey

        const blockHashRegAddress = await deployBlockhashRegistry(pk1, test.url)

        const chains = Object.keys(blockHeaderFile);
        for (let j = 0; j < chains.length; j++) {
            let totalBlocks = blockHeaderFile[chains[j]].slice(0, 90)

            for (let i = 0; i < totalBlocks.length; i += 45) {

                const allBlocks = totalBlocks.slice(i, i + 45)

                const firstBlock = allBlocks.shift();

                const startHash = allBlocks[allBlocks.length - 1].hash;

                let serialzedBlocks = [];

                for (const b of allBlocks) {
                    const s = new serialize.Block(b as any).serializeHeader()
                    // replacing f9 with f1 to provoke an underflow
                    s[0] = 241
                    serialzedBlocks.push(s);
                }

                serialzedBlocks = serialzedBlocks.reverse()

                let failed = false

                const clientVersion = await test.getFromServer('web3_clientVersion')


                try {

                    if (clientVersion.includes("Parity")) {
                        assert.isFalse(await tx.callContract(test.url, blockHashRegAddress, 'reCalculateBlockheaders(bytes[],bytes32):(bytes32)', [serialzedBlocks, startHash]).catch(_ => false))
                    }
                    await tx.callContract(test.url, blockHashRegAddress, 'reCalculateBlockheaders(bytes[],bytes32):(bytes32)', [serialzedBlocks, startHash], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 1 })


                } catch {
                    failed = true
                }

                assert.include(await test.getErrorReason(), "invalid offset")
                assert.isTrue(failed)
                assert.isFalse(await tx.callContract(test.url, blockHashRegAddress, 'reCalculateBlockheaders(bytes[],bytes32):(bytes32)', [serialzedBlocks, startHash], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 10, confirm: true, gas: 300000000 - 1 }).catch(_ => false))
            }
        }
    }).timeout(600000)

    let headerLength = process.env.GITLAB_CI ? 250 : 10

    it(`create ${headerLength} blocks`, async () => {
        const test = await TestTransport.createWithRegisteredNodes(2)

        for (let i = 0; i < headerLength; i++) {
            await test.createAccount()
        }
    }).timeout(90000)

    it('recreateBlockheaders', async () => {
        const test = await TestTransport.createWithRegisteredNodes(2)
        const pk1 = test.getHandlerConfig(0).privateKey

        const blockHashRegAddress = await deployBlockhashRegistry(pk1, test.url)

        let block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

        await tx.callContract(test.url, blockHashRegAddress, 'snapshot()', [], { privateKey: pk1, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 })
        let blockNumber = toNumber(block.number)

        const sstart = new serialize.Block(block as any);

        let blockheaderArray = [];
        blockheaderArray.push(sstart.serializeHeader());

        const clientVersion = await test.getFromServer('web3_clientVersion')

        if (clientVersion.includes("Geth")) headerLength = 45

        for (let i = 1; i < headerLength; i++) {
            const b = await test.getFromServer('eth_getBlockByNumber', toHex(blockNumber - i), false) as BlockData
            const s = new serialize.Block(b as any);
            blockheaderArray.push(s.serializeHeader());
        }

        const targetBlock = ("0x" + (await tx.callContract(test.url, blockHashRegAddress, 'reCalculateBlockheaders(bytes[],bytes32):(bytes32)', [blockheaderArray, block.hash]))[0].toString('hex'))
        await tx.callContract(test.url, blockHashRegAddress, 'reCalculateBlockheaders(bytes[],bytes32):(bytes32)', [blockheaderArray, block.hash], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 1 })

        const blockHashBefore = "0x" + (await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber - headerLength]))[0].toString('hex')
        await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber - headerLength], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 })

        const result = await tx.callContract(test.url, blockHashRegAddress, 'recreateBlockheaders(uint,bytes[])', [blockNumber, blockheaderArray], { privateKey: pk1, to: blockHashRegAddress, value: 0, confirm: true, gas: 8000000 })

        const blockResult = await test.getFromServer('eth_getBlockByHash', targetBlock, false) as BlockData
        const blockHashAfter = "0x" + (await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber - headerLength]))[0].toString('hex')
        await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber - headerLength], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 })

        const blockByNumber = await test.getFromServer('eth_getBlockByNumber', toHex(blockNumber - headerLength), false)

        assert.equal(blockByNumber.hash, blockHashAfter)

        assert.equal(toNumber(blockResult.number), toNumber(result.logs[0].topics[1]))
        assert.equal(blockResult.hash, result.logs[0].topics[2])

        assert.equal(blockHashBefore, "0x0000000000000000000000000000000000000000000000000000000000000000")
        assert.equal(blockHashAfter, blockResult.hash)

        assert.equal((blockNumber - toNumber(blockResult.number)), headerLength)

    })

    it('recreateBlockheaders fail', async () => {
        const test = await TestTransport.createWithRegisteredNodes(2)
        const pk1 = test.getHandlerConfig(0).privateKey

        const blockHashRegAddress = await deployBlockhashRegistry(pk1, test.url)

        const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

        await tx.callContract(test.url, blockHashRegAddress, 'snapshot()', [], { privateKey: pk1, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 })

        const blockNumber = toNumber(block.number)

        const sstart = new serialize.Block(block as any);

        let blockheaderArray = [];
        blockheaderArray.push(sstart.serializeHeader());

        for (let i = 1; i < headerLength; i++) {
            const b = await test.getFromServer('eth_getBlockByNumber', toHex(blockNumber - i), false) as BlockData
            const s = new serialize.Block(b as any);
            blockheaderArray.push(s.serializeHeader());

        }

        const temp = blockheaderArray[2]
        blockheaderArray[2] = blockheaderArray[3]
        blockheaderArray[3] = temp

        const targetBlock = ("0x" + (await tx.callContract(test.url, blockHashRegAddress, 'reCalculateBlockheaders(bytes[],bytes32):(bytes32)', [blockheaderArray, block.hash]))[0].toString('hex'))
        await tx.callContract(test.url, blockHashRegAddress, 'reCalculateBlockheaders(bytes[],bytes32):(bytes32)', [blockheaderArray, block.hash], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 1 })

        const blockHashBefore = "0x" + (await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber - headerLength]))[0].toString('hex')
        await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber - headerLength], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 })

        assert.isFalse(await tx.callContract(test.url, blockHashRegAddress, 'recreateBlockheaders(uint,bytes[])', [blockNumber - 5, blockheaderArray], { privateKey: pk1, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 1 }).catch(_ => false))
        assert.include(await test.getErrorReason(), "parentBlock is not available")
        assert.isFalse(await tx.callContract(test.url, blockHashRegAddress, 'recreateBlockheaders(uint,bytes[])', [blockNumber, blockheaderArray], { privateKey: pk1, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 1 }).catch(_ => false))
        assert.include(await test.getErrorReason(), "invalid headers")

        const blockHashAfter = "0x" + (await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber - headerLength]))[0].toString('hex')
        await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber - headerLength], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 })

        assert.equal(blockHashBefore, "0x0000000000000000000000000000000000000000000000000000000000000000")
        assert.equal(blockHashAfter, "0x0000000000000000000000000000000000000000000000000000000000000000")

    })

    it('searchForAvailableBlock', async () => {
        const test = await TestTransport.createWithRegisteredNodes(2)
        const pk1 = test.getHandlerConfig(0).privateKey
        const blockHashRegAddress = await deployBlockhashRegistry(pk1, test.url)

        const snapshot1 = await tx.callContract(test.url, blockHashRegAddress, 'searchForAvailableBlock(uint,uint):(uint)', [0, 100])
        const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

        const blockNumber = toNumber(block.number) - 1

        await tx.callContract(test.url, blockHashRegAddress, 'searchForAvailableBlock(uint,uint):(uint)', [0, 100], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 })


        assert.equal(toNumber(snapshot1[0]), 0)
        const snapshot2 = await tx.callContract(test.url, blockHashRegAddress, 'searchForAvailableBlock(uint,uint):(uint)', [blockNumber - 20, 25])
        await tx.callContract(test.url, blockHashRegAddress, 'searchForAvailableBlock(uint,uint):(uint)', [blockNumber - 20, 25], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 })

        assert.equal(toNumber(snapshot2[0]), blockNumber)

        const snapshot3 = await tx.callContract(test.url, blockHashRegAddress, 'searchForAvailableBlock(uint,uint):(uint)', [blockNumber - 20, 20])
        await tx.callContract(test.url, blockHashRegAddress, 'searchForAvailableBlock(uint,uint):(uint)', [blockNumber - 20, 20], { privateKey: test.getHandlerConfig(0).privateKey, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 })

        assert.equal(toNumber(snapshot3[0]), blockNumber)

    })

    /**
     * CI ONLY TESTS
     */

    if (process.env.GITLAB_CI) {
        it('recreateBlockheaders gas costs', async () => {

            const test = await TestTransport.createWithRegisteredNodes(2)
            const pk1 = test.getHandlerConfig(0).privateKey

            const clientVersion = await test.getFromServer('web3_clientVersion')

            if (clientVersion.includes("Geth")) return

            const blockHashRegAddress = await deployBlockhashRegistry(pk1, test.url)

            const block = await test.getFromServer('eth_getBlockByNumber', 'latest', false) as BlockData

            await tx.callContract(test.url, blockHashRegAddress, 'snapshot()', [], { privateKey: pk1, to: blockHashRegAddress, value: 0, confirm: true, gas: 300000000 - 10 })

            const blockNumber = toNumber(block.number)

            const sstart = new serialize.Block(block as any);

            let blockheaderArray = [];

            for (let j = 175; j <= 300; j += 5) {
                blockheaderArray.push(sstart.serializeHeader());

                for (let i = 1; i < j; i++) {
                    const b = await test.getFromServer('eth_getBlockByNumber', toHex(blockNumber - i), false) as BlockData
                    const s = new serialize.Block(b as any);
                    blockheaderArray.push(s.serializeHeader());

                }

                const targetBlock = ("0x" + (await tx.callContract(test.url, blockHashRegAddress, 'reCalculateBlockheaders(bytes[],bytes32):(bytes32)', [blockheaderArray, block.hash]))[0].toString('hex'))

                const blockHashBefore = "0x" + (await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber - j]))[0].toString('hex')

                const result = await tx.callContract(test.url, blockHashRegAddress, 'recreateBlockheaders(uint,bytes[])', [blockNumber, blockheaderArray], { privateKey: pk1, to: blockHashRegAddress, value: 0, confirm: true, gas: 8000000 })

                const blockResult = await test.getFromServer('eth_getBlockByHash', targetBlock, false) as BlockData
                const blockHashAfter = "0x" + (await tx.callContract(test.url, blockHashRegAddress, 'blockhashMapping(uint256):(bytes32)', [blockNumber - j]))[0].toString('hex')

                const blockByNumber = await test.getFromServer('eth_getBlockByNumber', toHex(blockNumber - j), false)

                assert.equal(blockByNumber.hash, blockHashAfter)

                assert.equal(toNumber(blockResult.number), toNumber(result.logs[0].topics[1]))
                assert.equal(blockResult.hash, result.logs[0].topics[2])

                assert.equal(blockHashBefore, "0x0000000000000000000000000000000000000000000000000000000000000000")
                assert.equal(blockHashAfter, blockResult.hash)

                assert.equal((blockNumber - toNumber(blockResult.number)), j)

                const gasUsed = toNumber(result.gasUsed)

                const gasPrice = 4800000000

                const costs = gasUsed * gasPrice / 1000000000000000000

                const blocksPerDay = 86400 / 12

                const numberTx = Math.ceil(blocksPerDay / j)

                const gasPerDay = numberTx * gasUsed

                const etherPerDay = gasPerDay * gasPrice / 1000000000000000000

                console.log(`blocks: ${j} gas used: ${gasUsed}\tEther: ${costs.toPrecision(6)}\tEther/Block: ${(costs / j).toPrecision(6)}\t1 day: ${etherPerDay}\t`)

                blockheaderArray = []
            }
        }).timeout(90000)

    }


})