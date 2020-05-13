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
import { TestTransport } from './transport'
import { RPCResponse } from 'in3-common/js/src/types/types'

import 'mocha'

export async function runTests(files: string[]): Promise<{ descr: string, c: number, success: boolean, error: string }[]> {
  const allResults = []
  let c = 0
  for (const file of files) {

    for (const test of JSON.parse(readFileSync(file, 'utf8'))) {
      c++
      const result = await runTest(test, c)
      allResults.push(result)
      console.log(addSpace('' + result.c, 3) + ' : ' + addSpace(result.descr, 85, '.', result.success ? '' : '31') + ' ' + addSpace(result.success ? 'OK' : result.error, 0, ' ', result.success ? '32' : '31'))

    }
  }
  return allResults
}

async function runTest(testData: any, c: number) {
  let result = { descr: testData.descr, c, success: false, error: undefined }
  testData = JSON.parse(JSON.stringify(testData))

  let testTrnsprt = new TestTransport(1, undefined, undefined, undefined, 'eth')

  for (const method in testData.mock_responses) {
    testTrnsprt.injectResponseMethod(method, testData.mock_responses[method])
  }

  testTrnsprt.defineGetFromServer("#1", "0x1")

  try {
    const response = await testTrnsprt.handle("#1", testData.request) as RPCResponse
    if(response.result == testData.expected_result)
      result.success = true
    else{
      result.error =  response.error || 'Failed'
    }
  }
  catch (err) {
    result.error =  err
  }

  return result
}

function addSpace(s: string, l: number, filler = ' ', color = '') {
  while (s.length < l) s += filler
  return color ? '\x1B[' + color + 'm' + s + '\x1B[0m' : s
}