pragma solidity ^0.5.4;
pragma experimental ABIEncoderV2;

contract BlockhashRegistry {

    event LogBlockhashAdded(uint indexed blockNr, bytes32 indexed bhash);

    mapping(uint => bytes32) public blockhashMapping;

    constructor() public {
        snapshot();
    }

    // stores a blockhash to the state
    function snapshot() public {

        // blockhash cannot return the current block, so we use the block before the current one
        saveBlockNumber(block.number-1);
    }

    // stores a certain blockhash to the state
    function saveBlockNumber(uint _blockNumber) public {
        bytes32 bHash = blockhash(_blockNumber);

        require(bHash != 0x0,"block not available");

        blockhashMapping[_blockNumber] = bHash;
        emit LogBlockhashAdded(_blockNumber, bHash);

    }

    function getParentAndBlockhash(bytes memory _blockheader) public pure returns (bytes32 parentHash, bytes32 bhash) {
        
        uint8 first = uint8(_blockheader[0]);

        uint8 offset = first-0xf7+2;
        
        assembly {

            // mstore to get the memory pointer of the blockheader to 0x20 
            mstore(0x20, _blockheader)

            // we load the pointer we just stored 
            // then we add 0x20 (32 bytes) to get to the start of the blockheader
            // then we add the offset we calculated 
            // and load it to the parentHash variable
            parentHash :=mload(
                add(
                    add(
                        mload(0x20),0x20
                    ),offset)
            )            
        }
        bhash = keccak256(_blockheader);
    }

    // starts with a given blockhash and adds earlier blocks
    function calculateBlockheaders(bytes[] memory _blockheaders, bytes32 _bHash) public pure returns (bytes32 bhash) {

        bytes32 currentBlockhash = _bHash;
        bytes32 calcParent = 0x0;
        bytes32 calcBlockhash = 0x0;
        for(uint i = 0; i < _blockheaders.length; i++) {

            (calcParent, calcBlockhash) = getParentAndBlockhash(_blockheaders[i]);
            if(calcBlockhash != currentBlockhash) return 0x0;
            currentBlockhash = calcParent;
        }

        return currentBlockhash;
    }

    function recreateBlockheaders(uint _blockNumber, bytes[] memory _blockheaders) public {
        bytes32 currentBlockhash = blockhashMapping[_blockNumber];
        require(currentBlockhash != 0x0, "parentBlock is not available");

        bytes32 calculatedHash = calculateBlockheaders(_blockheaders, currentBlockhash);
        require(calculatedHash != 0x0, "invalid headers");

        uint bnr = _blockNumber - _blockheaders.length;
        blockhashMapping[bnr] = calculatedHash;
        emit LogBlockhashAdded(bnr, calculatedHash);
    }
}
