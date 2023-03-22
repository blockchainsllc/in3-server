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

import Ajv, { FuncKeywordDefinition, ValidateFunction } from 'ajv'

/**
 * the ajv instance with custom formatters and keywords
 */
export const ajv = new Ajv()
ajv.addFormat('address', /^0x[0-9a-fA-F]{40}$/)
ajv.addFormat('bytes32', /^0x[0-9a-fA-F]{64}$/)
ajv.addFormat('bytes64', /^0x[0-9a-fA-F]{128}$/)
ajv.addFormat('hex', /^0x[0-9a-fA-F]{2,}$/)
ajv.addFormat('hexWithout', /^[0-9a-fA-F]{2,}$/)
ajv.addFormat('path', /^[\/a-zA-Z_\-0-9]+$/)

const secondsNow = () => Date.now() / 1000
const ONE_MINUTE = 60

const keywordDefinition: FuncKeywordDefinition = {
  keyword: 'timestamp',
  type: 'number',
  validate(sch, data) {
    return sch === 'current'
    ? !!(data > secondsNow() - ONE_MINUTE || data < secondsNow() + ONE_MINUTE)
    : !!(data === 0 || secondsNow() - 3600 * 24 * 365 || data < Date.now() / 1000 + 3600 * 24 * 365)
  }
}

ajv.addKeyword('timestamp', keywordDefinition)

/**
 * validates the data and throws an error in case they are not valid.
 * 
 * @export
 * @param {Ajv.ValidateFunction} fn 
 * @param {any} ob 
 */
export function validateAndThrow(fn: ValidateFunction, ob) {
  if (!fn(ob))
    throw new Error('ERRKEY: invalid_data : ' + (fn).errors.map(_ =>
      _.schemaPath + '(' + JSON.stringify(_.data || _.params) + '):' + _.message).join(', ') + ':' + JSON.stringify(ob, null, 2))
}

export function validate(ob: any, def: any) {
  validateAndThrow(ajv.compile(def), ob)
}

