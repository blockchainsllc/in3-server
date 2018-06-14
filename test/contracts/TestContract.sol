pragma solidity ^0.4.19;

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



    

}