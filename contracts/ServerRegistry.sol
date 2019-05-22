/***********************************************************
* This file is part of the Slock.it IoT Layer.             *
* The Slock.it IoT Layer contains:                         *
*   - USN (Universal Sharing Network)                      *
*   - INCUBED (Trustless INcentivized remote Node Network) *
************************************************************
* Copyright (C) 2016 - 2018 Slock.it GmbH                  *
* All Rights Reserved.                                     *
************************************************************
* You may use, distribute and modify this code under the   *
* terms of the license contract you have concluded with    *
* Slock.it GmbH.                                           *
* For information about liability, maintenance etc. also   *
* refer to the contract concluded with Slock.it GmbH.      *
************************************************************
* For more information, please refer to https://slock.it   *
* For questions, please contact info@slock.it              *
***********************************************************/

pragma solidity ^0.5.7;
pragma experimental ABIEncoderV2;

import "./BlockhashRegistry.sol";

/// @title Registry for IN3-Servers
contract ServerRegistry {

    /// server has been registered or updated its registry props or deposit
    event LogServerRegistered(string url, uint props, address owner, uint deposit);

    ///  a caller requested to unregister a server.
    event LogServerUnregisterRequested(string url, address owner, address caller);

    /// the owner canceled the unregister-proccess
    event LogServerUnregisterCanceled(string url, address owner);

    /// a Server was convicted
    event LogServerConvicted(string url, address owner);

    /// a Server is removed
    event LogServerRemoved(string url, address owner);
  
    struct In3Server {
        string url;  // the url of the server

        address payable owner; // the owner, which is also the key to sign blockhashes
        uint64 timeout; // timeout after which the owner is allowed to receive his stored deposit

        uint deposit; // stored deposit
        uint props; // a list of properties-flags representing the capabilities of the server

        uint128 unregisterTime; // earliest timestamp in to to call unregister
        uint128 registerTime; // timestamp when the server was registered
    }

    /// server list of incubed nodes    
    In3Server[] public servers;

    /// add your additional storage here. If you add information before this line you will break in3 nodelist

    BlockhashRegistry public blockRegistry;
    /// version: major minor fork(000) date(yyyy/mm/dd)
    uint constant public version = 12300020190328;

    uint public blockDeployment;

    // index for unique url and owner
    mapping (address => bool) ownerIndex;
    mapping (bytes32 => bool) urlIndex;

    struct ConvictInformation {
        bytes32 convictHash;
        bytes32 blockHash;
    }

    mapping (uint => mapping(address => ConvictInformation)) convictMapping;

    constructor(address _blockRegistry) public {
        blockRegistry = BlockhashRegistry(_blockRegistry);
        blockDeployment = block.timestamp;
    }

    /// length of the serverlist
    function totalServers() external view returns (uint)  {
        return servers.length;
    }
  
    /// register a new Server with the sender as owner    
    function registerServer(string calldata _url, uint _props, uint64 _timeout) external payable {
        checkLimits();

        bytes32 urlHash = keccak256(bytes(_url));

        // make sure this url and also this owner was not registered before.
        require (!urlIndex[urlHash] && !ownerIndex[msg.sender], "a Server with the same url or owner is already registered");

        // add new In3Server
        In3Server memory m;
        m.url = _url;
        m.props = _props;
        m.owner = msg.sender;
        m.deposit = msg.value;
        m.timeout = _timeout > 3600 ? _timeout : 1 hours;
        m.registerTime = uint128(block.timestamp); 
        servers.push(m);

        // make sure they are used
        urlIndex[urlHash] = true;
        ownerIndex[msg.sender] = true;

        // emit event
        emit LogServerRegistered(_url, _props, msg.sender,msg.value);
    }

    /// updates a Server by adding the msg.value to the deposit and setting the props    
    function updateServer(uint _serverIndex, uint _props, uint64 _timeout) external payable {
        checkLimits();

        In3Server storage server = servers[_serverIndex];
        require(server.owner == msg.sender, "only the owner may update the server");

        if (msg.value>0) 
          server.deposit += msg.value;

        if (_props!=server.props)
          server.props = _props;

        if(_timeout > server.timeout)
            server.timeout = _timeout;
        emit LogServerRegistered(server.url, _props, msg.sender,server.deposit);
    }

    function recoverAddress(bytes memory _sig, bytes32 _evm_blockhash, uint _index, address _owner) public pure returns (address){

        uint8 v;
        bytes32 r;
        bytes32 s;

       assembly {
            r := mload(add(_sig, 32))
            s := mload(add(_sig, 64))
            v := and(mload(add(_sig, 65)), 255)
        }

        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 tempHash =  keccak256(abi.encodePacked(_evm_blockhash, _index, _owner));
        bytes32 prefixedHash = keccak256(abi.encodePacked(prefix, tempHash));
        return ecrecover(prefixedHash, v, r, s);
    }
  

    function checkUnique(address _new, address[] memory _currentSet) internal pure returns (bool){
        for(uint i=0;i<_currentSet.length;i++){
            if(_currentSet[i]==_new) return true;
        }
    }
    
    function getValidVoters(uint _blockNumber, address _voted) public view returns (address[] memory){

        bytes32 evm_blockhash = blockhash(_blockNumber);
        require(evm_blockhash != 0x0, "block not found");

        // capping the number of required signatures
        uint requiredSignatures = servers.length > 40? 20: servers.length;

        address[] memory validVoters = new address[](requiredSignatures);

        uint uniqueSignatures = 0;
        uint i=0;
        while(uniqueSignatures<requiredSignatures){
            
            uint8 tempByteOne = uint8(byte(evm_blockhash[(i+uniqueSignatures)%32]));
            uint8 tempByteTwo = uint8(byte(evm_blockhash[(i*2+uniqueSignatures)%32]));
            uint8 tempByteThree = uint8(byte(evm_blockhash[(i*3+uniqueSignatures)%32]));

            uint position = (tempByteOne+tempByteTwo+tempByteThree) % servers.length;

            if(!checkUnique(servers[position].owner,validVoters) && _voted!=servers[position].owner ){
                validVoters[uniqueSignatures] = servers[position].owner;
                uniqueSignatures++;
            }
            
            i++;
        }

        return validVoters;

    }

    function voteUnregisterServer(uint _blockNumber, uint _index, address _owner, bytes[] calldata _signatures) external {
       
        bytes32 evm_blockhash = blockhash(_blockNumber);
        require(evm_blockhash != 0x0, "block not found");
        require(servers[_index].owner == _owner, "wrong owner for server provided");

        address[] memory validSigners = getValidVoters(_blockNumber,_owner );
        
        require(_signatures.length >= validSigners.length,"provided not enough signatures");

        uint successfullSigns = 0;
 
        for(uint i=0; i<_signatures.length; i++){

            address signedAddress =  recoverAddress(_signatures[i], evm_blockhash, _index, _owner);

            for(uint j=0; j<validSigners.length;j++){

                if(signedAddress == validSigners[j]){

                    successfullSigns++;

                    if(successfullSigns > validSigners.length/2){

                        removeServer(_index);
                        return;
                    }
                   break;
                }               
            }
        }
   }

    
    /// this should be called before unregistering a server.
    /// there are 2 use cases:
    /// a) the owner wants to stop offering the service and remove the server.
    ///    in this case he has to wait for one hour before actually removing the server. 
    ///    This is needed in order to give others a chance to convict it in case this server signs wrong hashes
    /// b) anybody can request to remove a server because it has been inactive.
    ///    in this case he needs to pay a small deposit, which he will lose 
    //       if the owner become active again 
    //       or the caller will receive 20% of the deposit in case the owner does not react.
    function requestUnregisteringServer(uint _serverIndex) external {

        In3Server storage server = servers[_serverIndex];
        require(server.owner == msg.sender,"not the owner");

        // this can only be called if nobody requested it before
        require(server.unregisterTime == 0, "Server is already unregistering");
       
        server.unregisterTime = uint128(now + server.timeout);

        emit LogServerUnregisterRequested(server.url, server.owner, msg.sender);
    }
    
    /// this function must be called by the caller of the requestUnregisteringServer-function after 28 days
    /// if the owner did not cancel, the caller will receive 20% of the server deposit + his own deposit.
    /// the owner will receive 80% of the server deposit before the server will be removed.
    function confirmUnregisteringServer(uint _serverIndex) external {
        In3Server storage server = servers[_serverIndex];
        
        require(server.owner == msg.sender, "Only the owner is allowed to confirm");

        require(server.unregisterTime < now, "Only confirm after the timeout allowed");

        uint payBackOwner = server.deposit;
  
        if (payBackOwner > 0)
            server.owner.transfer(payBackOwner);

        removeServer(_serverIndex);
    }

    /// this function must be called by the owner to cancel the unregister-process.
    /// if the caller is not the owner, then he will also get the deposit paid by the caller.
    function cancelUnregisteringServer(uint _serverIndex) external {
        In3Server storage server = servers[_serverIndex];

        // this can only be called by the owner and if somebody requested it before
        require(server.owner == msg.sender, "only the owner is allowed to cancel unregister");
    
        server.unregisterTime = 0;

        /// emit event
        emit LogServerUnregisterCanceled(server.url, server.owner);
    }
    
    /// commits a blocknumber and a hash
    function convict(uint _blockNumber, bytes32 _hash) external {
        bytes32 evm_blockhash = blockhash(_blockNumber);

        if(evm_blockhash == 0x0) {
            evm_blockhash = blockRegistry.blockhashMapping(_blockNumber);
        }
        
        // if the blockhash is correct you cannot convict the server
        require(evm_blockhash != 0x0, "block not found");
    
        ConvictInformation memory ci;
        ci.convictHash = _hash;
        ci.blockHash = evm_blockhash;

        convictMapping[_blockNumber][msg.sender] = ci;
    
    }

    function revealConvict(uint _serverIndex, bytes32 _blockhash, uint _blockNumber, uint8 _v, bytes32 _r, bytes32 _s) external {

        ConvictInformation storage ci = convictMapping[_blockNumber][msg.sender];

        // if the blockhash is correct you cannot convict the server
        require(ci.blockHash != _blockhash, "the block is too old or you try to convict with a correct hash");

        require(
            ecrecover(keccak256(abi.encodePacked(_blockhash, _blockNumber)), _v, _r, _s) == servers[_serverIndex].owner, 
            "the block was not signed by the owner of the server");

        require(
            keccak256(abi.encodePacked(_blockhash, msg.sender, _v, _r, _s)) == ci.convictHash, 
            "wrong convict hash");
        
        In3Server storage s = servers[_serverIndex];

        // remove the deposit
        if (s.deposit > 0) {
            uint payout =s.deposit / 2;
            // send 50% to the caller of this function
            msg.sender.transfer(payout);

            // and burn the rest by sending it to the 0x0-address
            // this is done in order to make it useless trying to convict your own server with a second account
            // and this getting all the deposit back after signing a wrong hash.
            address(0).transfer(s.deposit-payout);

        }

   
        // emit event
        emit LogServerConvicted(servers[_serverIndex].url, servers[_serverIndex].owner );
        
        /// for some reason currently deleting the ci storage would cost more gas, so we comment this out for now
        //delete ci.convictHash;
        //delete ci.blockHash;

        removeServer(_serverIndex);
    }


    // internal helper functions    
    function removeServer(uint _serverIndex) internal {
        // trigger event
        emit LogServerRemoved(servers[_serverIndex].url, servers[_serverIndex].owner);

        // remove from unique index
        urlIndex[keccak256(bytes(servers[_serverIndex].url))] = false;
        ownerIndex[servers[_serverIndex].owner] = false;

        uint length = servers.length;
        if (length>0) {
            // move the last entry to the removed one.
            In3Server memory m = servers[length - 1];
            servers[_serverIndex] = m;
        }
        servers.length--;
    }

    function checkLimits() internal view {
        // within the 6 months this contract may never hold more than 50 ETH
        if (now < 1560808800)
           require(address(this).balance < 50 ether, "Limit of 50 ETH reached");
    }
    
}
