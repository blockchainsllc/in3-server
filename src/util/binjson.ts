/*******************************************************************************
 * This file is part of the Incubed project.
 * Sources: https://github.com/slockit/in3-c
 * 
 * Copyright (C) 2018-2019 slock.it GmbH, Blockchains LLC
 * 
 * 
 * COMMERCIAL LICENSE USAGE
 * 
 * Licensees holding a valid commercial license may use this file in accordance 
 * with the commercial license agreement provided with the Software or, alternatively, 
 * in accordance with the terms contained in a written agreement between you and 
 * slock.it GmbH/Blockchains LLC. For licensing terms and conditions or further 
 * information please contact slock.it at in3@slock.it.
 * 	
 * Alternatively, this file may be used under the AGPL license as follows:
 *    
 * AGPL LICENSE USAGE
 * 
 * This program is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free Software 
 * Foundation, either version 3 of the License, or (at your option) any later version.
 *  
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY 
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A 
 * PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.
 * [Permissions of this strong copyleft license are conditioned on making available 
 * complete source code of licensed works and modifications, which include larger 
 * works using a licensed work, under the same license. Copyright and license notices 
 * must be preserved. Contributors provide an express grant of patent rights.]
 * You should have received a copy of the GNU Affero General Public License along 
 * with this program. If not, see <https://www.gnu.org/licenses/>.
 *******************************************************************************/


interface BB {
    data: Buffer
    p: number
    len: number
    bytes?: { data: Buffer, idx: number }[]
    byteIdx?: number
}

export function encodeObject(ob: any): Buffer {
    const bb = { data: Buffer.allocUnsafe(100), p: 0, len: 0, byteIdx: 0, bytes: [] }
    encode(bb, ob)
    const prefix = { data: Buffer.allocUnsafe(bb.p + 4), p: 0, len: 0 }
    encodeTypeandLength(prefix, 6, bufferFromNumber(bb.len), bb.data.slice(0, bb.p))
    return prefix.data.slice(0, prefix.p);
}

function check(bb: BB, l: number) {
    while (bb.data.length < bb.p + l) {
        const b = Buffer.allocUnsafe(bb.data.length * 2);
        b.set(bb.data, 0);
        bb.data = b;
    }
}

function addByte(bb: BB, val: number) {
    check(bb, 1);
    bb.data[bb.p++] = val;
}

function addBuffer(bb: BB, val: Buffer) {
    check(bb, val.length);
    bb.data.set(val, bb.p);
    bb.p += val.length;
}

function bufferFromNumber(val: number): Buffer {
    if (val < 0x100)
        return Buffer.from([val]);
    else if (val < 0x10000)
        return Buffer.from([val >> 8, val & 0xFF]);
    else if (val < 0x1000000)
        return Buffer.from([val >> 16, val >> 8 & 0xFF, val & 0xFF]);
    else if (val < 0x10000000)
        return Buffer.from([val >> 24, val >> 16 & 0xFF, val >> 8 & 0xFF, val & 0xFF]);
    return null;
}
function even(s) {
    return (s.length & 1) ? "0" + s : s;
}

function encodeTypeandLength(bb: BB, t: number, ldata: Buffer, data?: Buffer) {
    if (ldata.length == 1 && ldata[0] < 28)
        addByte(bb, t << 5 | ldata[0])
    else {
        addByte(bb, t << 5 | (ldata.length + 27))
        addBuffer(bb, ldata)
    }
    if (data)
        addBuffer(bb, data)
}

function hash(s: string): number {
    let val = 0
    for (let i = 0; i < s.length; i++)
        val ^= (s.charCodeAt(i) | val << 7) & 0xFFFF;

    return val;
}

function encodeRefIfExists(bb: BB, data: Buffer) {
    const found = bb.bytes.find(_ => _.data.equals(data))
    if (found) {
        encodeTypeandLength(bb, 4, bufferFromNumber(found.idx + 2));
        bb.byteIdx++;
        return true;
    }
    bb.bytes.push({ idx: bb.byteIdx, data })
    return false
}

function encode(bb: BB, ob: any) {
    const type = typeof (ob);
    bb.len++;
    if (ob == null || ob == undefined)
        addByte(bb, 0xc0);
    else if (type == 'boolean')
        addByte(bb, ob ? 0x81 : 0x80);
    else {
        let ldata: Buffer
        let data: Buffer = null
        let t = 0;
        if (type == 'number') {
            ldata = bufferFromNumber(ob);
            if (ldata)
                encodeTypeandLength(bb, 5, ldata)
            else {
                data = Buffer.from(even(ob.toString(16)), 'hex')
                if (encodeRefIfExists(bb, data)) return
                encodeTypeandLength(bb, 0, bufferFromNumber(data.length), data)
            }
        }
        else if (type == 'string') {
            if (ob.length > 1 && ob[0] == '0' && ob[1] == 'x') {
                ldata = bufferFromNumber((data = Buffer.from(even(ob.substr(2)), 'hex')).length)
                if (data.length < 4) {
                    t = 5
                    ldata = data
                    data = null
                }
            }
            else {
                ldata = bufferFromNumber((data = Buffer.from(ob, 'utf8')).length)
                data = Buffer.concat([data, bufferFromNumber(0)])
                t = 1
            }
            if (!t && encodeRefIfExists(bb, data)) return
            encodeTypeandLength(bb, t, ldata, data)
        }
        else if (Array.isArray(ob)) {
            encodeTypeandLength(bb, 2, bufferFromNumber(ob.length))
            for (let i = 0; i < ob.length; i++)
                encode(bb, ob[i])
        }
        else if (type == 'object') {
            const keys = Object.keys(ob)
            encodeTypeandLength(bb, 3, bufferFromNumber(keys.length))
            const key = Buffer.allocUnsafe(2)
            for (let i = 0; i < keys.length; i++) {
                key.writeUInt16BE(hash(keys[i]), 0)
                addBuffer(bb, key)
                encode(bb, ob[keys[i]])
            }
        }
    }
    bb.byteIdx++
}