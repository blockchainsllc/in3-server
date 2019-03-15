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
        uint prevBlockNumber = block.number-1;
        bytes32 bhash = blockhash(prevBlockNumber);

        blockhashMapping[prevBlockNumber] = bhash;

        emit LogBlockhashAdded(prevBlockNumber, bhash);
    }


    // stores a certain blockhash to the state
    function saveBlockNumber(uint _blockNumber) public {
        bytes32 bHash = blockhash(_blockNumber);

        require(bHash != 0x0,"block not available");

        blockhashMapping[_blockNumber] = bHash;
        emit LogBlockhashAdded(_blockNumber, bHash);

    }

    function getParentAndBlockhash(bytes memory _blockheader) public pure returns (bytes32 parentHash, bytes32 bhash) {

        // first bytes as uint 
        uint8 first = uint8(_blockheader[0]);

        // caclulate the offset = (fX - f7)
        uint8 offset = first-247+2;
  
        // found the 1st value and convert to uint8
        uint result = uint8(_blockheader[offset]);
        
        // read te next 31 bytes and convert each byte to uint8
        for(uint8 i = 1;i < 32; i++){
            uint8 index = offset+i;
            result = result*256+uint8(_blockheader[index]);
        }
        
        // convert it back to bytes32
        parentHash = bytes32(result);

        // hash header to get blockhash 
        bhash = keccak256(_blockheader);
    }

    // starts with a given blockhash and adds earlier blocks
    function calculateBlockheadersFrom(bytes[] memory _blockheaders, bytes32 _bHash) public view returns (bytes32 bhash) {

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

    function recreateBlockheadersFrom(uint _blockNumber, bytes[] memory _blockheaders) public {
        bytes32 currentBlockhash = blockhashMapping[_blockNumber];
        require(currentBlockhash != 0x0, "parentBlock is not available");

        bytes32 calculatedHash = calculateBlockheadersFrom(_blockheaders, currentBlockhash);
        require(calculatedHash != 0x0, "invalid headers");

        uint bnr = _blockNumber - _blockheaders.length;
        blockhashMapping[bnr] = calculatedHash;
        emit LogBlockhashAdded(bnr, calculatedHash);
    }

    // starts with some blockheaders and ends with a given blockhash
    function calculateBlockheadersTo(bytes[] memory _blockheaders, bytes32 _bHash) public view returns (bytes32 bhash) {

        (bytes32 newBlockhash, bytes32 currentBlockhash) = getParentAndBlockhash(_blockheaders[0]);

        for(uint i = 1; i < _blockheaders.length; i++) {

            (bytes32 calcParent, bytes32 calcBlockhash) = getParentAndBlockhash(_blockheaders[i]);
            if(calcParent != currentBlockhash) return 0x0;
            currentBlockhash = calcBlockhash;
        }

        if(currentBlockhash != _bHash) return 0x0;

        return newBlockhash;
    }

    function recreateBlockheadersTo(uint _blockNumber, bytes[] memory _blockheaders) public {
        bytes32 endBlockhash = blockhashMapping[_blockNumber];
        require(endBlockhash != 0x0, "endBlock is not available");
        require(calculateBlockheadersTo(_blockheaders, endBlockhash) != 0x0, "invalid headers");

        uint bnr = _blockNumber - _blockheaders.length;
        blockhashMapping[bnr] = endBlockhash;
        emit LogBlockhashAdded(bnr, endBlockhash);
    }


}
