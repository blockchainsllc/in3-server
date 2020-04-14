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

import { bytes, util } from 'in3-common'
import * as crypto from 'crypto'

export interface BTCBlock {
    hash: string,
    confirmations: number,
    strippedsize: number,
    size: number,
    weight: number,
    height: number,
    version: number,
    versionHex: string,
    merkleroot: string,
    tx: string[],
    time: string,
    mediantime: string,
    nonce: number,
    bits: string,
    difficulty: number,
    chainwork: string,
    nTx: number,
    previousblockhash: string,
    nextblockhash: string
}

export function btcHash(data: Buffer) {
    return crypto.createHash('sha256').update(crypto.createHash('sha256').update(data).digest()).digest()
}

export function copyReverse(dst: Buffer, src: Buffer, dstOffset: number = 0) {
    for (let i = 0; i < src.length; i++) dst[src.length - i - 1 + dstOffset] = src[i]
}

export function serialize_blockheader(block: BTCBlock): Buffer {
    const res: Buffer = Buffer.allocUnsafe(80)
    Buffer.from(block.versionHex, 'hex').copy(res, 0, 0, 4)
    copyReverse(res, Buffer.from(block.previousblockhash, 'hex'), 4)
    copyReverse(res, Buffer.from(block.merkleroot, 'hex'), 36)
    copyReverse(res, util.toBuffer(block.time, 4), 68)
    Buffer.from(block.bits, 'hex').copy(res, 72, 0, 4)
    copyReverse(res, util.toBuffer(block.nonce, 4), 76)
    return res
}