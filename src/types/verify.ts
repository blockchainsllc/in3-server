import * as Ajv from 'ajv'

// the schema
const schema = require('./rpc.json')

var ajv = new Ajv()
ajv.addMetaSchema(require('ajv/lib/refs/json-schema-draft-06.json'))
ajv.addSchema(schema)

export function verifyRequest(req: any) {
    if (!ajv.validate('https://slock.it/rpc.json', req))
        throw new Error(getErrorMessage(ajv.errors, null, { dataVar: 'rpc' }))
    if (!schema.definitions[req.method])
        throw new Error('method ' + req.method + ' is not supported or unknown')
    if (!ajv.validate('https://slock.it/rpc.json#/definitions/' + req.method, req.params))
        throw new Error(req.method + ' : ' + getErrorMessage(ajv.errors, schema.definitions[req.method]))
}
function getErrorMessage(errs: Ajv.ErrorObject[], s?: any, opt?: any) {
    console.log('e:' + JSON.stringify(errs, null, 2))
    const all = [...errs]
    const ones = errs.filter(_ => _.keyword == 'oneOf').map(one => {
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

    return ajv.errorsText(all, opt || { dataVar: 'params' })
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