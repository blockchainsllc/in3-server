pragma solidity ^0.5.4;

contract BlockhashRegistry {

    event LogBlockhashAdded(uint indexed blockNr, bytes32 indexed bhash);

    mapping(uint => bytes32) public blockhashMapping;

    constructor() public {
        uint prevBlockNumber = block.number-1;
        blockhashMapping[prevBlockNumber] = blockhash(prevBlockNumber);
    }

    function getParentAndBlockhash(bytes memory _blockheader) public pure returns (bytes32 parentHash, bytes32 bhash) {

        // first bytes as uint 
        uint8 first = uint8(_blockheader[0]);
        uint8 offset = first-247+2;
  
        uint result = uint8(_blockheader[offset]);
        
        for(uint8 i = 1;i < 32; i++){
            uint8 index = offset+i;
            result = result*256+uint8(_blockheader[index]);
        }
        
        parentHash = bytes32(result);

        bhash = keccak256(_blockheader);
    }
}
