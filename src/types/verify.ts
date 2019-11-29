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

const Sentry = require('@sentry/node');

import * as Ajv from 'ajv'

// the schema
const schema = require('./rpc.json')

var ajv = new Ajv()
ajv.addMetaSchema(require('ajv/lib/refs/json-schema-draft-06.json'))
ajv.addSchema(schema)

export function verifyRequest(req: any) {
    if (!ajv.validate('https://slock.it/rpc.json', req))
        throw new Error(getErrorMessage(ajv.errors, null, { dataVar: 'rpc' }, req))
    if (!schema.definitions[req.method])
        throw new Error('method ' + req.method + ' is not supported or unknown')
    if (!ajv.validate('https://slock.it/rpc.json#/definitions/' + req.method, req.params))
        throw new Error(req.method + ' : ' + getErrorMessage(ajv.errors, schema.definitions[req.method], null, req))
}
function getErrorMessage(errs: Ajv.ErrorObject[], s?: any, opt?: any, data?: any) {
    const all = [...errs]
    errs.filter(_ => _.keyword == 'oneOf').map(one => {
        one.message = 'must be ' + all.filter(_ => _ !== one && _.schemaPath.startsWith(one.schemaPath)).map(sub => {
            const i = all.indexOf(sub)
            all.splice(i, 1)
            switch (sub.keyword) {
                case 'enum':
                    return 'one of ' + (sub.params as Ajv.EnumParams).allowedValues.map(_ => "'" + _ + "'").join()
                case 'pattern':
                    return 'match ' + (sub.params as Ajv.PatternParams).pattern
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
                e.message = 'must be ' + (e.params as Ajv.EnumParams).allowedValues.map(_ => "'" + _ + "'").join(' or ')
                break
            case 'additionalProperties':
                e.message = ' does not allow unsupported properties like \'' + (e.params as Ajv.AdditionalPropertiesParams).additionalProperty + "'"

        }
    })
    for (const e of all) {
        const descr = (s ? getDescription(e.schemaPath, s) : null) || getDescription(e.schemaPath)
        if (descr) e.message = '(' + descr + ') ' + e.message
    }

    const msg = ajv.errorsText(all, opt || { dataVar: 'params' })

    // register with sentry
    if (process.env.SENTRY_ENABLE === 'true') {
        Sentry.addBreadcrumb({
            request: data,
            message: msg,
            errs
        })
        Sentry.captureException('Invalid Userdata')
    }

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