pragma solidity ^0.5.4;

contract BlockhashRegistry {

    event LogBlockhashAdded(uint indexed blockNr, bytes32 indexed bhash);

    mapping(uint => bytes32) public blockhashMapping;

    constructor() public {
        uint prevBlockNumber = block.number-1;
        blockhashMapping[prevBlockNumber] = blockhash(prevBlockNumber);
    }

}
