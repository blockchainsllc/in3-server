
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
        val ^= s.charCodeAt(i) | val << 7;

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
            if (ob.length > 1 && ob[0] == '0' && ob[1] == 'x')
                ldata = bufferFromNumber((data = Buffer.from(even(ob.substr(2)), 'hex')).length)
            else {
                ldata = bufferFromNumber((data = Buffer.from(ob, 'utf8')).length)
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
                encode(bb, ob[key[i]])
            }
        }
    }
    bb.byteIdx++
}