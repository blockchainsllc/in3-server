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

pragma solidity ^0.5.9;
pragma experimental ABIEncoderV2;

import "./BlockhashRegistry.sol";

/// @title Registry for IN3-nodes
contract NodeRegistry {

    /// node has been registered or updated its registry props or deposit
    event LogNodeRegistered(string url, uint props, address signer, uint deposit);

    ///  a caller requested to unregister a node.
    event LogNodeUnregisterRequested(string url, address signer);

    /// the owner canceled the unregister-proccess
    event LogNodeUnregisterCanceled(string url, address signer);

    /// a node was convicted
    event LogNodeConvicted(address signer);

    /// a Node is removed
    event LogNodeRemoved(string url, address signer);
  
    struct In3Node {
        string url;  // the url of the node

        uint deposit; // stored deposit

        uint64 timeout; // timeout after which the owner is allowed to receive his stored deposit
        uint64 registerTime; // timestamp when the node was registered
        uint64 unregisterTime; // earliest timestamp to call unregister
        uint64 props; // a list of properties-flags representing the capabilities of the node

        uint64 weight; //  the flag for (future) incentivisation
        address signer; // the signer for requests

        bytes32 proofHash;
    }

     /// information of a (future) convict (used to prevent frontrunning)
    struct ConvictInformation {
        bytes32 convictHash;    /// keccak256(wrong blockhash, msg.sender, v, r, s)
        bytes32 blockHash;      /// blockhash of the block to be convicted
    }

    /// information of a in3-node owner
    struct SignerInformation {
        uint64 index;          /// current index-position of the node in the node-array
        bool used;              /// flag whether account is currently a signer of a node
        address payable owner; // the owner of the node

        uint lockedTime;        /// time for the deposit to be locked, used only after vote-kick

        uint depositAmount;     /// amount of deposit to be locked, used only after vote-kick
    }

    /// information of an url
    struct UrlInformation {
        bool used;              /// flag whether the url is currently used
        address signer;          /// address of the owner of the url
    }

    /// node list of incubed nodes    
    In3Node[] public nodes;

    /// add your additional storage here. If you add information before this line you will break in3 nodelist

    BlockhashRegistry public blockRegistry;
    
    /// version: major minor fork(000) date(yyyy/mm/dd)
    uint constant public version = 12300020190328;

    /// the timestamp of the deployment
    uint public blockDeployment;

    bytes32 public registryId;

    /// mapping for information of the owner
    mapping (address => SignerInformation) public signerIndex;

    /// mapping for the information of the url
    /// can be used to access the SignerInformation-struct
    mapping (bytes32 => UrlInformation) public urlIndex;

    /// mapping for convicts: blockhash => address => convictInformation
    mapping (uint => mapping(address => ConvictInformation)) convictMapping;

    /// constructor
    /// @param _blockRegistry address of a BlockhashRegistry
    constructor(address _blockRegistry) public {
        blockRegistry = BlockhashRegistry(_blockRegistry);
        blockDeployment = now;
        registryId = keccak256(abi.encodePacked(address(this),blockhash(block.number-1)));
    }

    /// this function must be called by the owner to cancel the unregister-process.
    /// @param _signer the signer-address of an in3-node
    function cancelUnregisteringNode(address _signer) external {
        
        SignerInformation memory si = signerIndex[_signer];
        require(si.used, "sender does not own a node");
        require(si.owner == msg.sender, "only owner can unregister a node");

        In3Node storage node = nodes[si.index];

        require(node.unregisterTime > 0, "node is not unregistering");

        node.unregisterTime = 0;

        node.proofHash = calcProofHash(node);

        /// emit event
        emit LogNodeUnregisterCanceled(node.url, node.signer);
    }
    
    /// confirms the unregistering of a node by its owner
    /// @param _signer the signer-address of an in3-node
    function confirmUnregisteringNode(address _signer) external {

        SignerInformation storage si = signerIndex[_signer];
        require(si.used, "sender does not own a node");
        require(si.owner == msg.sender, "only owner can unregister a node");


        In3Node storage node = nodes[si.index];
        require(node.unregisterTime != 0, "cannot unregister an active node");
        require(node.unregisterTime < now, "only confirm after the timeout allowed");

        msg.sender.transfer(node.deposit);

        si.used = false;
        removeNode(si.index);
        si.index = 0;

    }

    /// commits a blocknumber and a hash
    /// must be called before revealConvict
    /// @param _blockNumber the blocknumber of the wrong blockhash
    /// @param _hash keccak256(wrong blockhash, msg.sender, v, r, s), used to prevent frontrunning
    function convict(uint _blockNumber, bytes32 _hash) external {
        bytes32 evm_blockhash = blockhash(_blockNumber);

        if(evm_blockhash == 0x0) {
            evm_blockhash = blockRegistry.blockhashMapping(_blockNumber);
        }
        
        // if the blockhash is correct you cannot convict the node
        require(evm_blockhash != 0x0, "block not found");
    
        ConvictInformation memory ci;
        ci.convictHash = _hash;
        ci.blockHash = evm_blockhash;

        convictMapping[_blockNumber][msg.sender] = ci;
    
    }

    /// register a new Node with the sender as owner    
    /// @param _url the url of the node, has to be unique
    /// @param _props properties of the node
    /// @param _timeout timespan of how long the node of a deposit will be locked. Will be at least for 1h
    function registerNode(string calldata _url, uint64 _props, uint64 _timeout, uint64 _weight) external payable {
        registerNodeInternal(_url, _props, _timeout, msg.sender, msg.sender, msg.value, _weight);
    }

     /// register a new Node with the sender as owner    
    /// @param _url the url of the node, has to be unique
    /// @param _props properties of the node
    /// @param _timeout timespan of how long the node of a deposit will be locked. Will be at least for 1h
    /// @param _signer the signer of the in3-node
    function registerNodeFor(string calldata _url, uint64 _props, uint64 _timeout, address _signer, uint64 _weight) external payable {
        registerNodeInternal(_url, _props, _timeout, _signer, msg.sender, msg.value, _weight);
    }

    /// a node owner can request to unregister his node
    /// but before he can confirm, he has to wait for his own-set deposit timeout
    /// @param _signer the signer of the in3-node
    function requestUnregisteringNode(address _signer) external {

        SignerInformation memory si = signerIndex[_signer];
        require(si.used, "sender is not an in3-signer");
        require(si.owner == msg.sender, "only owner can unregister a node");

        In3Node storage node = nodes[si.index];
        require(node.unregisterTime == 0, "node is already unregistering");

        node.unregisterTime = uint64(now + node.timeout);
        node.proofHash = calcProofHash(node);

        emit LogNodeUnregisterRequested(node.url, node.signer);
    }

    /// returns the deposit after a node has been kicked
    /// only callable after the timeout for the deposit is over
    function returnDeposit(address _signer) external {
        SignerInformation storage si = signerIndex[_signer];

        require(si.owner == msg.sender, "only owner can claim deposit");
        require(si.depositAmount > 0, "nothing to transfer");
        require(now > si.lockedTime, "deposit still locked");

        uint payout = si.depositAmount;
        si.depositAmount = 0;
        si.lockedTime = 0;

        msg.sender.transfer(payout);
   }

    /// reveals the wrongly provided blockhash, so that the node-owner will lose its deposit
    /// @param _signer the address that signed the wrong blockhash
    /// @param _blockhash the wrongly provided blockhash
    /// @param _blockNumber number of the wrongly provided blockhash
    /// @param _v v of the signature
    /// @param _r r of the signature
    /// @param _s s of the signature
    function revealConvict(address _signer, bytes32 _blockhash, uint _blockNumber, uint8 _v, bytes32 _r, bytes32 _s) external {
        
        SignerInformation storage si = signerIndex[_signer];
        ConvictInformation memory ci = convictMapping[_blockNumber][msg.sender];

        // if the blockhash is correct you cannot convict the node
        require(ci.blockHash != _blockhash, "the block is too old or you try to convict with a correct hash");

        require(
            ecrecover(keccak256(abi.encodePacked(_blockhash, _blockNumber)), _v, _r, _s) == _signer, 
            "the block was not signed by the signer of the node");

        require(
            keccak256(abi.encodePacked(_blockhash, msg.sender, _v, _r, _s)) == ci.convictHash, 
            "wrong convict hash");
        
        emit LogNodeConvicted(_signer);

        uint deposit = nodes[si.index].signer == _signer ? nodes[si.index].deposit : si.depositAmount;
       
        // the signer is still active
        if(nodes[si.index].signer == _signer){
            
            removeNode(si.index);
            si.index = 0;
        }
        else {
            si.depositAmount = 0;
            si.lockedTime = 0;
        }

        // remove the deposit
        uint payout = deposit / 2;
        // send 50% to the caller of this function
        msg.sender.transfer(payout);
        // and burn the rest by sending it to the 0x0-address
        // this is done in order to make it useless trying to convict your own node with a second account
        // and this getting all the deposit back after signing a wrong hash.
        address(0).transfer(deposit-payout);
        /// for some reason currently deleting the ci storage would cost more gas, so we comment this out for now
        delete convictMapping[_blockNumber][msg.sender];
        
    }

    /// updates a Node by adding the msg.value to the deposit and setting the props or timeout
    /// @param _url the url, will be changed if different from the current one
    /// @param _props the new properties, will be changed if different from the current onec
    /// @param _timeout the new timeout of the node, cannot be decreased
    function updateNode(address _signer, string calldata _url, uint64 _props, uint64 _timeout) external payable {
       
        SignerInformation memory si = signerIndex[_signer];
        require(si.owner == msg.sender, "only node owner can update");

        In3Node storage node = nodes[si.index];

        bytes32 newURl = keccak256(bytes(_url));

        require(si.owner == msg.sender, "only owner can update node");
        require(si.used, "signer does not own a node");

        // the url got changed
        if(newURl != keccak256(bytes(node.url))){

            // deleting the old entry
            delete urlIndex[keccak256(bytes(node.url))];
            
            // make sure the new url is not already in use
            require(!urlIndex[newURl].used, "url is already in use");

            UrlInformation memory ui;
            ui.used = true;
            ui.signer = msg.sender;
            urlIndex[newURl] = ui;
        }

        if (msg.value>0) {
            node.deposit += msg.value;
        
            if (now < (blockDeployment + 52 weeks))
                require( node.deposit < 50 ether, "Limit of 50 ETH reached");
        }

        if (_props != node.props)
          node.props = _props;

        if(_timeout > node.timeout)
            node.timeout = _timeout;
        
        node.proofHash = calcProofHash(node);

        emit LogNodeRegistered(node.url, _props, msg.sender,node.deposit);
    }

     /// votes a nodes out 
    /// @param _blockNumber the blocknumber (used to generate "random" index positions)
    /// @param _signer the owner of an in3-node to be kicked
    /// @param _signatures array with 65 bytes signatures
    function voteUnregisterNode(uint _blockNumber, address _signer, bytes[] calldata _signatures) external {
       
        // only the last 256 blocks (about 1h on main-net)
        bytes32 evmBlockhash = blockhash(_blockNumber);
        require(evmBlockhash != 0x0, "block not found");
       
        SignerInformation storage si = signerIndex[_signer];
        require(si.used, "owner does not have a node");
       
        // gets the valid voters and the total voting time / power
        (address[] memory validSigners, uint totalVotingTime) = getValidVoters(_blockNumber,_signer);
        require(_signatures.length > 0,"provided no signatures");

        In3Node memory node = nodes[si.index];

        // capping the active time at 2 years at most
        uint activeTime = (now - node.registerTime) > 52 weeks *2 ? 52 weeks * 2 : (now - node.registerTime);
        
        uint votedTime = 0;

        // iterate through all provided signatures
        for(uint i = 0; i < _signatures.length; i++){

            address signedAddress = recoverAddress(_signatures[i], evmBlockhash, _signer);

            // iterate through all valid voters
            for(uint j = 0; j < validSigners.length; j++){
                
                if(signedAddress == validSigners[j]){

                    validSigners[j] = address(0x0);
                    votedTime += (now - nodes[signerIndex[signedAddress].index].registerTime) > 52 weeks ? 52 weeks : (now - nodes[signerIndex[signedAddress].index].registerTime);
                    // if we have more then 50% of the total voting time and have at least as much voting power as the node to be kicked
                    if(votedTime > totalVotingTime/2 && votedTime > activeTime){
                                                
                        // sending back the transfer-costs, capping at 1% of the deposit
                        uint transferAmount = (590000 * tx.gasprice > node.deposit/100 ? node.deposit/100 : 590000 * tx.gasprice);

                        transferAmount = transferAmount > 10 finney ? transferAmount : 10 finney;
                        
                        msg.sender.transfer(transferAmount);

                        // burning the rest of 1%
                        uint burnAmount = node.deposit/100 > transferAmount ? node.deposit/100 - transferAmount : 0;
                        address(0).transfer(burnAmount);

                        // we update the owner information
                        si.lockedTime = now + node.timeout;
                        si.depositAmount = node.deposit - burnAmount - transferAmount;
                        si.used = false;

                        // removing the node
                        removeNode(si.index);
                        si.index = 0;

                        return;
                    }
                   break;
                }
            }
        }
       revert("not enough voting power");
   }
      
    /// length of the nodelist
    function totalNodes() external view returns (uint)  {
        return nodes.length;
    }
   
    /// gets the list of allowed voters for a certain blocknumber and address
    /// @param _blockNumber the blocknumber (used to generate "random" index positions)
    /// @param _voted the address/node owner for the vote to be kicked
    /// @return array with addresses of the voters and the accumulated voting power of all valid voters
    function getValidVoters(uint _blockNumber, address _voted) public view returns (address[] memory, uint totalVoteTime){

        // only the last 256 blocks (about 1h on main-net)
        bytes32 evm_blockhash = blockhash(_blockNumber);
        require(evm_blockhash != 0x0, "block not found");

        // capping the number of required signatures at 24 
        uint requiredSignatures = nodes.length > 25 ? 24: nodes.length-1;

        address[] memory validVoters = new address[](requiredSignatures);

        uint uniqueSignatures = 0;
        uint i = 0;

        while(uniqueSignatures < requiredSignatures){
            
            // reading 2 random bytes
            uint8 tempByteOne = uint8(byte(evm_blockhash[(i+uniqueSignatures)%32]));
            uint8 tempByteTwo = uint8(byte(evm_blockhash[(i*2+uniqueSignatures)%32]));

            // calculate position
            uint position = requiredSignatures > 24 ? (tempByteOne+tempByteTwo) % nodes.length : i;

            // add to the voting set when the owner is not yet in the array
            if(!checkUnique(nodes[position].signer,validVoters) && _voted != nodes[position].signer ){
                validVoters[uniqueSignatures] = nodes[position].signer;
                uniqueSignatures++;
                // capping the voting-power at 1 year
                totalVoteTime += (now - nodes[position].registerTime) > 52 weeks ? 52 weeks : (now - nodes[position].registerTime);
            }
            i++;
        }
        return (validVoters, totalVoteTime);
    }

    /// calculated the minumum deposit for registering 
    /// @param _value the value of ether send to it with a transaction, for calls it's adviced to use 0
    /// @return returns the current minumum deposit for registering a new in3-node
    function calculateMinDeposit(uint _value) public view returns (uint) {

        // for the first 2 weeks we do not enable spam protection
        if(now < (blockDeployment + 2 weeks) || nodes.length == 0) return 10 finney;

        // we cap the averageDeposit at 50 ether
        uint averageDeposit = (address(this).balance - _value) / nodes.length;
        averageDeposit = averageDeposit > 50 ether ? 50 ether : averageDeposit;

        // accessing the last node of the array and its registerTime
        // it does not necessarily has to be the latest registered node, as node positions can get swapped when an older node gets removed
        // but in that occassion we allow a potential lower minimum deposit for a new node
        uint passedTime = (now - nodes[nodes.length - 1].registerTime);

        uint minDeposit = (1 days * averageDeposit) / (passedTime == 0 ? 1 : passedTime);
        return (minDeposit < 10 finney )? 10 finney : minDeposit;
    }

    /// calculates the sha3 hash of the most important properties
    /// @param _node the in3 node to calculate the hash from
    function calcProofHash(In3Node memory _node) internal pure returns (bytes32){

        return keccak256(abi.encodePacked(
            _node.deposit,
            _node.timeout,
            _node.registerTime,
            _node.unregisterTime,
            _node.props,
            _node.signer,
            _node.url)
        );
    }

    /// recovers the address from a provided signature
    /// @param _sig signature as 65 bytes
    /// @param _evmBlockhash blockhash
    /// @param _signer node owner to be voted out
    /// @return calculated address
    function recoverAddress(bytes memory _sig, bytes32 _evmBlockhash, address _signer) public pure returns (address){

        uint8 v;
        bytes32 r;
        bytes32 s;

       assembly {
            r := mload(add(_sig, 32))
            s := mload(add(_sig, 64))
            v := and(mload(add(_sig, 65)), 255)
        }

        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 tempHash = keccak256(abi.encodePacked(_evmBlockhash, _signer));
        bytes32 prefixedHash = keccak256(abi.encodePacked(prefix, tempHash));
        return ecrecover(prefixedHash, v, r, s);
        
    }


    // internal helper functions    

    function registerNodeInternal(string memory _url, uint64 _props, uint64 _timeout, address _signer, address payable _owner, uint _deposit, uint64 _weight) internal {

        require(nodes.length < 0xFFFFFFFFFFFFFFFF, "maximum amount of nodes reached");
        // enforcing a minimum deposit
        require(_deposit >= calculateMinDeposit(_deposit), "not enough deposit");

        if(now < (blockDeployment + 52 weeks)){
           require(_deposit < 50 ether, "Limit of 50 ETH reached");
        }

        bytes32 urlHash = keccak256(bytes(_url));

        // make sure this url and also this owner was not registered before.
        require (!urlIndex[urlHash].used && !signerIndex[_owner].used, "a node with the same url or owner is already registered");

        // sets the information of the owner
        signerIndex[_signer].used = true;
        signerIndex[_signer].index = uint64(nodes.length);
        signerIndex[_signer].owner = _owner;

        // add new In3Node
        In3Node memory m;
        m.url = _url;
        m.props = _props;
        m.signer = _signer;
        m.deposit = _deposit;
        m.timeout = _timeout > 1 hours ? _timeout : 1 hours;
        m.registerTime = uint64(now);
        m.weight = _weight;

        m.proofHash = calcProofHash(m);
        nodes.push(m);

        // sets the information of the url
        UrlInformation memory ui;
        ui.used = true;
        ui.signer = _signer;
        urlIndex[urlHash] = ui;
    
        // emit event
        emit LogNodeRegistered(_url, _props, _signer,_deposit);
    }

    /// removes a node from the node-array
    /// @param _nodeIndex the nodeIndex to be removed
    function removeNode(uint _nodeIndex) internal {
        // trigger event
        emit LogNodeRemoved(nodes[_nodeIndex].url, nodes[_nodeIndex].signer);

        
        // remove from mappings
        urlIndex[keccak256(bytes(nodes[_nodeIndex].url))].used = false;

        uint length = nodes.length;
        if (length > 0) {
            // move the last entry to the removed one.
            In3Node memory m = nodes[length - 1];
            nodes[_nodeIndex] = m;
        
            SignerInformation storage si = signerIndex[m.signer];
            si.index = uint64(_nodeIndex);
        }
        nodes.length--;
        
    }

    /// checks whether the provided address is already in the provided array
    /// @param _new the address to be checked
    /// @param _currentSet the array to be iterated
    /// @return true when the address was found inside of the array
    function checkUnique(address _new, address[] memory _currentSet) internal pure returns (bool){
        for(uint i = 0; i < _currentSet.length; i++){
            if(_currentSet[i] == _new) return true;
        }
    }
    
}
