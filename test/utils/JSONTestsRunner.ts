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

import { readFileSync } from 'fs'
import { isEqual, keys, omit, sortBy } from 'lodash'
import 'mocha'
import { resetSupport } from '../../src/modules/eth/proof'
import { RPCResponse } from '../../src/types/types'
import { TestTransport } from './transport'


export async function runTests(file: string): Promise<{ descr: string, c: number, success: boolean, error: string }[]> {
  const allResults = []
  let c = 0

  for (const test of JSON.parse(readFileSync(file, 'utf8'))) {
    c++
    const result = await runTest(test, c)
    allResults.push(result)
    console.log(addSpace('' + result.c, 3) + ' : ' + addSpace(result.descr, 130, '.', result.success ? '' : '31') + ' ' + addSpace(result.success ? 'OK' : JSON.stringify(result.error || ''), 0, ' ', result.success ? '32' : '31'))
  }
  return allResults
}

async function runTest(testData: any, c: number) {
  resetSupport()
  let result = { descr: testData.descr, c, success: false, error: undefined }
  testData = JSON.parse(JSON.stringify(testData))

  let testTrnsprt = new TestTransport(1,"0x6c095a05764a23156efd9d603eada144a9b1af33", undefined, undefined, testData.handler || 'eth', "0x23d5345c5c13180a8080bd5ddbe7cde64683755dcce6e734d95b7b573845facb")
  testTrnsprt.bypassTopInjectedResponseCheck = true
  testData.mock_responses.forEach(([req, rsp]) => testTrnsprt.injectResponse(req, rsp))
  testTrnsprt.defineGetFromServer("http://avalid.url/#1", "0x1")

  try {
    const response = await testTrnsprt.handle("http://avalid.url/#1", testData.request) as RPCResponse

    const notRequired = ["version","currentBlock","lastValidatorChange","rpcCount","rpcTime","execTime","lastNodeList"]
    notRequired.forEach(element => {
      delete response[element];
    });

    if (!testData.expected_result.error) {
      if (isEqual(response.result, testData.expected_result.result) && isProofEqual(response, testData.expected_result)) {
        result.success = true
      }
    } else if (isEqual(omit(response.error, 'data'), omit(testData.expected_result.error, 'data')) && compareErrorData(response.error.data, testData.expected_result.error.data)) {
      result.success = true
    } else {
      result.error = response.error || 'Failed'
    }
  }
  catch (err) {
    // catch error case
    if (err.message.indexOf(testData.expected_result.error.message) != -1) {
      result.success = true
    } else
      result.error = err
  }

  return result
}

function compareErrorData(a: any, b: any): boolean {
  // Since error data contains a signature derivated from a timestamp, just check the object interface
  const aInterface = sortBy(keys(a))
  const bInterface = sortBy(keys(b))
  return isEqual(aInterface, bInterface)
}

function isProofEqual(response: RPCResponse, expected_result:any) {
  return !expected_result.in3.proof || isEqual(response.in3.proof, expected_result.in3.proof)
}

function addSpace(s: string, l: number, filler = ' ', color = '') {
  if (s.length < l) s += Array(l - s.length).fill(filler).join('')
  return color ? '\x1B[' + color + 'm' + s + '\x1B[0m' : s
}