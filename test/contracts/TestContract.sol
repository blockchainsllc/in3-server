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



pragma solidity ^0.4.19;
pragma experimental ABIEncoderV2;

contract TestContract {

    event LogInc(uint counter, address caller);

    uint public counter;

    function increase() public {
        counter = counter + 1;
        LogInc(counter,msg.sender);
    }

    function add(TestContract c) public view returns(uint) {
        return c.counter() + counter;
    }

    function getBlockHash(uint number) public view returns (bytes32) {
        return block.blockhash(number);
    }

    function getBalance(address adr)  public view returns(uint){
        return adr.balance;
    }

    function testInternCall(TestContract adr)  public view returns(uint){
        return adr.counter();
    }

    function testCallCode(address adr)  public view returns(uint){
        adr.callcode(bytes4(keccak256("increase()")));
        return 0;
    }
   function testCall(address adr)  public view returns(uint){
        adr.call(bytes4(keccak256("increase()")));
        return 0;
    }

    function testDelegateCall(address adr)  public view returns(uint){
        adr.delegatecall(bytes4(keccak256("increase()")));
        return 0;
    }

    /// returns the code for a given address
    function getCodeAt(address _addr) public view returns (bytes o_code) {
        assembly {
            // retrieve the size of the code, this needs assembly
            let size := extcodesize(_addr)
            // allocate output byte array - this could also be done without assembly
            // by using o_code = new bytes(size)
            o_code := mload(0x40)
            // new "memory end" including padding
            mstore(0x40, add(o_code, and(add(add(size, 0x20), 0x1f), not(0x1f))))
            // store length in memory
            mstore(o_code, size)
            // actually retrieve the code, this needs assembly
            extcodecopy(_addr, add(o_code, 0x20), 0, size)
        }
    }

    function encodingTest(bytes[] memory _a, bytes32 _b) public pure returns (bytes32, bytes[]){
        return (_b, _a);
    }


    

}