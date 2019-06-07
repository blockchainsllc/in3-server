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
    event LogServerConvicted(address owner);

    /// a Server is removed
    event LogServerRemoved(string url, address owner);
  
    struct In3Server {
        string url;  // the url of the server

        address payable owner; // the owner, which is also the key to sign blockhashes
        uint64 timeout; // timeout after which the owner is allowed to receive his stored deposit

        uint deposit; // stored deposit
        
        uint props; // a list of properties-flags representing the capabilities of the server

        uint128 unregisterTime; // earliest timestamp in to call unregister
        uint128 registerTime; // timestamp when the server was registered
    }

    /// server list of incubed nodes    
    In3Server[] public servers;

    /// add your additional storage here. If you add information before this line you will break in3 nodelist

    BlockhashRegistry public blockRegistry;
    /// version: major minor fork(000) date(yyyy/mm/dd)
    uint constant public version = 12300020190328;

    uint public blockDeployment;

    /// mapping for information of the owner
    mapping (address => OwnerInformation) public ownerIndex;

    /// mapping for the information of the url
    /// can be used to access the OwnerInformation-struct 
    mapping (bytes32 => UrlInformation) public urlIndex;

    /// information of a (future) convict (used to prevent frontrunning)
    struct ConvictInformation {
        bytes32 convictHash; /// keccak256(blockhash, msg.sender)
        bytes32 blockHash;  /// blockhash of the block to be convicted
    }

    /// information of a in3-server owner 
    struct OwnerInformation {
        bool used; /// flag whether account is currently owner of a server
        uint128 index; /// current index-position of the server in the servers-array
        uint lockedTime; /// time for the deposit to be locked, used only after vote-kick 
        uint depositAmount; /// amount of deposit to be locked, used only after vote-kick
    }

    /// information of an url
    struct UrlInformation {
        bool used; /// flag whether the url is currently used
        address owner; /// address of the owner of the url
    }

    /// owner of the in3-contracts (only needed in the first 2 years)
    address public owner;
     
    /// mapping for convicts: blockhash => address => convictInformation
    mapping (uint => mapping(address => ConvictInformation)) convictMapping;


    /// modifier only active in the 1st 2 years
    modifier onlyBeginning(){
        require(block.timestamp < (blockDeployment + 2*86400*365));
        _;
    }

    /// constructor
    /// @param _blockRegistry address of a BlockhashRegistry
    constructor(address _blockRegistry) public {
        blockRegistry = BlockhashRegistry(_blockRegistry);
        blockDeployment = block.timestamp;
        owner = msg.sender;
    }

    /// this function must be called by the owner to cancel the unregister-process.
    function cancelUnregisteringServer() external {
        
        OwnerInformation memory oi = ownerIndex[msg.sender];
        require(oi.used, "sender does not own a server");

        In3Server storage server = servers[oi.index];
        require(server.unregisterTime>0, "server is not unregistering");

        server.unregisterTime = 0;

        /// emit event
        emit LogServerUnregisterCanceled(server.url, server.owner);
    }
    

    
    /// confirms the unregistering of a server by its owner
    function confirmUnregisteringServer() external {

        OwnerInformation storage oi = ownerIndex[msg.sender];
        require(oi.used, "sender does not own a server");

        In3Server storage server = servers[oi.index];

        require(server.unregisterTime != 0, "Cannot unregister an active server");
        require(server.unregisterTime < now, "Only confirm after the timeout allowed");

        uint payBackOwner = server.deposit;
  
        if (payBackOwner > 0)
            server.owner.transfer(payBackOwner);
       
        oi.used = false;
        removeServer(oi.index);
    }

    /// commits a blocknumber and a hash
    /// must be called before revealConvict
    /// @param _blockNumber the blocknumber of the wrong blockhash
    /// @param _hash  keccak256(wrong blockhash, msg.sender), used to prevent frontrunning
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

    /// register a new Server with the sender as owner    
    /// @param _url the url of the server, has to be unique
    /// @param _props properties of the server
    /// @param _timeout timespan of how long the server of a deposit will be locked. Will be at least for 1h
    function registerServer(string calldata _url, uint _props, uint64 _timeout) external payable {

        // we lock 0.01 ether (as possible transaction costs for vote kicking)
        require(msg.value >= calculateMinDeposit(msg.value), "not enough deposit");

        if(block.timestamp < (blockDeployment + 86400*365)){
           require(msg.value < 50 ether, "Limit of 50 ETH reached");
        }

        bytes32 urlHash = keccak256(bytes(_url));

        // make sure this url and also this owner was not registered before.
        require (!urlIndex[urlHash].used && !ownerIndex[msg.sender].used, "a Server with the same url or owner is already registered");

        // sets the information of the owner
        ownerIndex[msg.sender].used = true;
        ownerIndex[msg.sender].index = uint128(servers.length);

        // add new In3Server
        In3Server memory m;
        m.url = _url;
        m.props = _props;
        m.owner = msg.sender;
        m.deposit = msg.value;
        m.timeout = _timeout > 3600 ? _timeout : 1 hours;
        m.registerTime = uint128(block.timestamp);
        servers.push(m);

        // sets the information of the url
        UrlInformation memory ui;
        ui.used = true;
        ui.owner = msg.sender;
        urlIndex[urlHash] = ui;
    
        // emit event
        emit LogServerRegistered(_url, _props, msg.sender,msg.value);
    }

    /// a server owner can request to unregister his server
    /// but before he can confirm, he has to wait for his own-set deposit timeout
    function requestUnregisteringServer() external {

        OwnerInformation memory oi = ownerIndex[msg.sender];
        require(oi.used, "sender does not own a server");

        In3Server storage server = servers[oi.index];

        // this can only be called if nobody requested it before
        require(server.unregisterTime == 0, "Server is already unregistering");
       
        server.unregisterTime = uint128(now + server.timeout);

        emit LogServerUnregisterRequested(server.url, server.owner, msg.sender);
    }

    /// returns the deposit after a server has been kicked
    /// only callable after the timeout for the deposit is over
    function returnDeposit() external {
        OwnerInformation storage oi = ownerIndex[msg.sender];

        require(oi.depositAmount > 0, "nothing to transfer");
        require(now > oi.lockedTime, "deposit still locked");

        uint payout = oi.depositAmount;
        oi.depositAmount = 0;
        oi.lockedTime = 0;

        msg.sender.transfer(payout);
   }

    /// reveals the wrongly provided blockhash, so that the server-owner will lose its deposit
    /// @param _owner the server-owner that provided the wrong blockhash
    /// @param _blockhash the wrongly provided blockhash
    /// @param _blockNumber number of the wrongly provided blockhash
    /// @param _v v of the signature
    /// @param _r r of the signature
    /// @param _s s of the signature
    function revealConvict(address _owner, bytes32 _blockhash, uint _blockNumber, uint8 _v, bytes32 _r, bytes32 _s) external {
        
        OwnerInformation storage oi = ownerIndex[_owner];
        ConvictInformation memory ci = convictMapping[_blockNumber][msg.sender];

        // if the blockhash is correct you cannot convict the server
        require(ci.blockHash != _blockhash, "the block is too old or you try to convict with a correct hash");

        require(
            ecrecover(keccak256(abi.encodePacked(_blockhash, _blockNumber)), _v, _r, _s) == _owner, 
            "the block was not signed by the owner of the server");

        require(
            keccak256(abi.encodePacked(_blockhash, msg.sender, _v, _r, _s)) == ci.convictHash, 
            "wrong convict hash");
        
        emit LogServerConvicted(_owner);

        uint deposit;
        // the owner has still an in3-server
        if(servers[oi.index].owner == _owner){
            deposit = servers[oi.index].deposit;
            removeServer(oi.index);
        }
        else {
            deposit = oi.depositAmount;
            oi.depositAmount = 0;
            oi.lockedTime = 0;
        }

        // remove the deposit
        if (deposit > 0) {
            uint payout = deposit / 2;
            // send 50% to the caller of this function
            msg.sender.transfer(payout);
            // and burn the rest by sending it to the 0x0-address
            // this is done in order to make it useless trying to convict your own server with a second account
            // and this getting all the deposit back after signing a wrong hash.
            address(0).transfer(deposit-payout);
        }
        /// for some reason currently deleting the ci storage would cost more gas, so we comment this out for now
        //delete ci.convictHash;
        //delete ci.blockHash;        
    }

    /// updates a Server by adding the msg.value to the deposit and setting the props or timeout
    /// @param _props the new properties
    /// @param _timeout the new timeout of the server, cannot be decreased
    function updateServer(string calldata _url, uint _props, uint64 _timeout) external payable {
       
        OwnerInformation memory oi = ownerIndex[msg.sender];
        In3Server storage server = servers[oi.index];
        
        bytes32 newURl = keccak256(bytes(_url));

        require(oi.used, "sender does not own a server");

        // the url got changed
        if(newURl != keccak256(bytes(server.url))){

            // deleting the old entry
            delete urlIndex[keccak256(bytes(server.url))];
            
            // make sure the new url is not already in use
            require(!urlIndex[newURl].used, "url is already in use");

            UrlInformation memory ui;
            ui.used = true;
            ui.owner = msg.sender;
            urlIndex[newURl] = ui;
        }

        if (msg.value>0) {
          server.deposit += msg.value;
        
            if (now < (blockDeployment + 1*86400*365))
                require( server.deposit < 50 ether, "Limit of 50 ETH reached");
        }

        if (_props != server.props)
          server.props = _props;

        if(_timeout > server.timeout)
            server.timeout = _timeout;

   

        emit LogServerRegistered(server.url, _props, msg.sender,server.deposit);
    }

     /// votes a servers out 
    /// @param _blockNumber the blocknumber (used to generate "random" index positions)
    /// @param _serverOwner the owner of an in3-server to be kicked
    /// @param _signatures array with 65 bytes signatures
    function voteUnregisterServer(uint _blockNumber, address _serverOwner, bytes[] calldata _signatures) external {
       
        // only the last 256 blocks (about 1h on main-net)
        bytes32 evm_blockhash = blockhash(_blockNumber);
        require(evm_blockhash != 0x0, "block not found");
       
        OwnerInformation storage oi = ownerIndex[_serverOwner];
        require(oi.used, "owner does not have a server");
       
        // gets the valid voters and the total voting time / power
        (address[] memory validSigners, uint totalVotingTime) = getValidVoters(_blockNumber,_serverOwner);
        require(_signatures.length >0,"provided no signatures");

        In3Server memory server = servers[oi.index];

        // capping the active time at 2 years at most
        uint activeTime = (now - server.registerTime) > 365*86400*2 ? 365*86400*2 : (now - server.registerTime); 
        
        uint votedTime = 0;

        // iterate through all provided signatures
        for(uint i = 0; i < _signatures.length; i++){

            address signedAddress = recoverAddress(_signatures[i], evm_blockhash, _serverOwner);

            // iterate through all valid voters
            for(uint j=0; j<validSigners.length; j++){

                if(signedAddress == validSigners[j]){

                    votedTime += (now - servers[ownerIndex[signedAddress].index].registerTime) > 365*86400 ? 365*86400 : (now - servers[ownerIndex[signedAddress].index].registerTime);

                    // if we have more then 50% of the total voting time and have at least as much voting power as the server to be kicked
                    if(votedTime > totalVotingTime/2 && votedTime > activeTime){
                        
                        uint transferAmount = server.deposit / 100 < 10 finney ? 10 finney : server.deposit / 100;

                        // we update the owner information
                        oi.lockedTime = now + server.timeout;
                        oi.depositAmount = server.deposit-transferAmount;
                        oi.used = false;

                        // removing the server
                        removeServer(oi.index);
                        msg.sender.transfer(transferAmount);

                        return;
                    }
                   break;
                }
            }
        }
       revert("not enough voting power");
   }
      
   

    /// length of the serverlist
    function totalServers() external view returns (uint)  {
        return servers.length;
    }
   
    /// gets the list of allowed voters for a certain blocknumber and address
    /// @param _blockNumber the blocknumber (used to generate "random" index positions)
    /// @param _voted the address/server owner for the vote to be kicked
    /// @return array with addresses of the voters and the accumulated voting power of all valid voters
    function getValidVoters(uint _blockNumber, address _voted) public view returns (address[] memory, uint totalVoteTime){

        // only the last 256 blocks (about 1h on main-net)
        bytes32 evm_blockhash = blockhash(_blockNumber);
        require(evm_blockhash != 0x0, "block not found");

        // capping the number of required signatures at 24 
        uint requiredSignatures = servers.length > 25? 24: servers.length-1;

        address[] memory validVoters = new address[](requiredSignatures);

        uint uniqueSignatures = 0;
        uint i = 0;

        while(uniqueSignatures < requiredSignatures){
            
            // reading 2 random bytes
            uint8 tempByteOne = uint8(byte(evm_blockhash[(i+uniqueSignatures)%32]));
            uint8 tempByteTwo = uint8(byte(evm_blockhash[(i*2+uniqueSignatures)%32]));

            // calculate position
            uint position = requiredSignatures > 24 ? (tempByteOne+tempByteTwo) % servers.length : i;

            // add to the voting set when the owner is not yet in the array
            if(!checkUnique(servers[position].owner,validVoters) && _voted!=servers[position].owner ){
                validVoters[uniqueSignatures] = servers[position].owner;
                uniqueSignatures++;
                // capping the voting-power at 1 year
                totalVoteTime += (block.timestamp - servers[position].registerTime) > 365*86400 ? 365*86400 : (block.timestamp - servers[position].registerTime);
            }
            i++;
        }
        return (validVoters, totalVoteTime);
    }

    // calculated the minumum deposit for registering 
    function calculateMinDeposit(uint _value) public view returns (uint) {

        // for the first 2 weeks we do not enable spam protection
        if(block.timestamp < (blockDeployment + 86400*14) || servers.length == 0) return 10 finney;

        // we cap the averageDeposit at 50 ether
        uint averageDeposit = (address(this).balance - _value)/ servers.length;
        averageDeposit = averageDeposit > 50 ether ? 50 ether : averageDeposit;

        // accessing the last server of the array and its registerTime
        // it does not necessarily has to be the latest registered server, as server positions can get swapped when an older server gets removed
        // but in that occassion we allow a potential lower minimum deposit for a new server
        uint passedTime = (block.timestamp - servers[servers.length - 1].registerTime);

        uint minDeposit = (86400 * averageDeposit) / (passedTime == 0 ? 1 : passedTime);
        return (minDeposit < 10 finney )? 10 finney : minDeposit;
    }

    /// recovers the address from a provided signature
    /// @param _sig signature as 65 bytes
    /// @param _evmBlockhash blockhash
    /// @param _serverOwner server owner to be voted out
    /// @return calculated address
    function recoverAddress(bytes memory _sig, bytes32 _evmBlockhash, address _serverOwner) public pure returns (address){

        uint8 v;
        bytes32 r;
        bytes32 s;

       assembly {
            r := mload(add(_sig, 32))
            s := mload(add(_sig, 64))
            v := and(mload(add(_sig, 65)), 255)
        }

        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 tempHash = keccak256(abi.encodePacked(_evmBlockhash, _serverOwner));
        bytes32 prefixedHash = keccak256(abi.encodePacked(prefix, tempHash));
        return ecrecover(prefixedHash, v, r, s);
    }


    // internal helper functions    

    /// checks whether the provided address is already in the provided array
    /// @param _new the address to be checked
    /// @param _currentSet the array to be iterated
    /// @return true when the address was found inside of the array
    function checkUnique(address _new, address[] memory _currentSet) internal pure returns (bool){
        for(uint i=0;i<_currentSet.length;i++){
            if(_currentSet[i]==_new) return true;
        }
    }

    /// removes a server from the server-array
    function removeServer(uint _serverIndex) internal {
        // trigger event
        emit LogServerRemoved(servers[_serverIndex].url, servers[_serverIndex].owner);

        // remove from mappings
        urlIndex[keccak256(bytes(servers[_serverIndex].url))].used = false;
        ownerIndex[servers[_serverIndex].owner].used = false;

        uint length = servers.length;
        if (length>0) {
            // move the last entry to the removed one.
            In3Server memory m = servers[length - 1];
            servers[_serverIndex] = m;
        
            OwnerInformation storage oi = ownerIndex[m.owner];
            oi.index = uint128(_serverIndex);
        }
        servers.length--;
    }
    
}
