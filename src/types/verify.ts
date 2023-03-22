/*******************************************************************************
 * This file is part of the Incubed project.
 * Sources: https://github.com/slockit/in3-server
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

import Ajv, { ErrorObject } from 'ajv'
import { IncubedError, RPCException } from '../util/sentryError'
// the schema
const schema = require('./rpc.json')

var ajv = new Ajv({ strict: false })
ajv.addMetaSchema(require('ajv/lib/refs/json-schema-draft-06.json'))
ajv.addSchema(schema)

export function verifyRequest(req: any) {
    if (!ajv.validate('https://slock.it/rpc.json', req))
        throw new IncubedError(getErrorMessage(ajv.errors, null, { dataVar: 'rpc' }, req), RPCException.INVALID_PARAMS)
    if (!schema.definitions[req.method])
        throw new IncubedError('method ' + req.method + ' is not supported or unknown', RPCException.INVALID_METHOD)
    if (!ajv.validate('https://slock.it/rpc.json#/definitions/' + req.method, req.params))
        throw new IncubedError(req.method + ' : ' + getErrorMessage(ajv.errors, schema.definitions[req.method], null, req), RPCException.INVALID_PARAMS)
}

function getErrorMessage(errs: ErrorObject[], s?: any, opt?: any, _data?: any) {
    const all = [...errs]
    errs.filter(_ => _.keyword == 'oneOf').forEach(one => {
        one.message = 'must be ' + all.filter(_ => _ !== one && _.schemaPath.startsWith(one.schemaPath)).map(sub => {
            const i = all.indexOf(sub)
            all.splice(i, 1)
            switch (sub.keyword) {
                case 'enum':
                    return 'one of ' + sub.params.allowedValues.join(', ')
                case 'pattern':
                    return 'match ' + sub.params.values.join(', ')
                default:
                    return sub.message
            }
        }).join(' or ')
    })
    all.forEach(e => {
        switch (e.keyword) {
            case 'const':
                e.message = e.message.replace('constant', "'" + (e.params as any).allowedValue + "'")
                break
            case 'enum':
                e.message = 'must be ' + e.params.values.map(_ => "'" + _ + "'").join(' or ')
                break
            case 'additionalProperties':
                e.message = ' does not allow unsupported properties like \'' + e.params.values.join(' ') + "'"

        }
    })
    for (const e of all) {
        const descr = (s ? getDescription(e.schemaPath, s) : null) || getDescription(e.schemaPath)
        if (descr) e.message = '(' + descr + ') ' + e.message
    }

    const msg = ajv.errorsText(all, opt || { dataVar: 'params' })

    return msg
}

function getDescription(path: string, root?: any) {
    let descr: string = null
    let ob: any = root || schema
    for (const p of path.split('/').filter(_ => _ != '#')) {
        ob = Array.isArray(ob) ? ob[parseInt(p)] : ob[p]
        if (!ob) return descr
        descr = ob.description || descr
    }
    return descr
}