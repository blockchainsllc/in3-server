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

pragma solidity 0.5.10;
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
        string url;                         /// the url of the node

        uint deposit;                       /// stored deposit

        uint64 timeout;                     /// timeout after which the owner is allowed to receive his stored deposit
        uint64 registerTime;                /// timestamp when the node was registered
        uint64 unregisterTime;              /// earliest timestamp to call unregister
        uint64 props;                       /// a list of properties-flags representing the capabilities of the node

        uint64 weight;                      ///  the flag for (future) incentivisation
        address signer;                     /// the signer for requests

        bytes32 proofHash;
    }

     /// information of a (future) convict (used to prevent frontrunning)
    struct ConvictInformation {
        bytes32 convictHash;                /// keccak256(wrong blockhash, msg.sender, v, r, s)
        uint blockNumberConvict;            /// block number when convict had been called
    }

    /// information of a in3-node owner
    struct SignerInformation {
        uint64 index;                       /// current index-position of the node in the node-array
        bool used;                          /// flag whether account is currently a signer of a node
        address owner;              /// the owner of the node

        uint64 lockedTime;                  /// time for the deposit to be locked, used only after vote-kick
        address payable unregisterCaller;   /// the address that called unregister

        uint depositAmount;                 /// amount of deposit to be locked, used only after vote-kick
        uint unregisterDeposit;
        uint unregisterTimeout;
    }

    /// information of an url
    struct UrlInformation {
        bool used;                          /// flag whether the url is currently used
        address signer;                     /// address of the owner of the url
    }

    /// node list of incubed nodes
    In3Node[] public nodes;

    /// add your additional storage here. If you add information before this line you will break in3 nodelist

    /// blockhash registry address
    BlockhashRegistry public blockRegistry;

    /// version: major minor fork(000) date(yyyy/mm/dd)
    uint constant public VERSION = 12300020190328;

    /// the timestamp of the deployment
    uint public blockTimeStampDeployment;

    /// id used for signing
    bytes32 public registryId;

    /// mapping for information of the owner
    mapping (address => SignerInformation) public signerIndex;

    /// mapping for the information of the url
    /// can be used to access the SignerInformation-struct
    mapping (bytes32 => UrlInformation) public urlIndex;

    /// mapping for convicts: blocknumber => address => convictInformation
    mapping (uint => mapping(address => ConvictInformation)) internal convictMapping;

    mapping (bytes32 => address) public senderMapping;

    /// constructor
    /// @param _blockRegistry address of a BlockhashRegistry
    constructor(address _blockRegistry) public {
        blockRegistry = BlockhashRegistry(_blockRegistry);

        // solium-disable-next-line security/no-block-members
        blockTimeStampDeployment = block.timestamp;  // solhint-disable-line not-rely-on-time
        registryId = keccak256(abi.encodePacked(address(this), blockhash(block.number-1)));
    }

    /// this function must be called by the owner to cancel the unregister-process.
    /// @param _signer the signer-address of an in3-node
    function cancelUnregisteringNode(address _signer) external {

        SignerInformation memory si = signerIndex[_signer];
        require(si.used, "sender does not own a node");
        require(si.owner == msg.sender, "only owner can unregister a node");
        require(si.unregisterCaller == address(0x0), "cancel during challenge not allowed");

        In3Node storage node = nodes[si.index];

        require(node.unregisterTime > 0, "node is not unregistering");

        node.unregisterTime = 0;

        node.proofHash = calcProofHash(node);

        emit LogNodeUnregisterCanceled(node.url, node.signer);
    }

    /// confirms the unregistering of a node by its owner
    /// @param _signer the signer-address of an in3-node
    function confirmUnregisteringNode(address _signer) external {

        SignerInformation storage si = signerIndex[_signer];
        In3Node storage node = nodes[si.index];

        if (si.unregisterCaller == address(0x0)) {
            require(si.used, "sender does not own a node");
            require(si.owner == msg.sender, "only owner can unregister a node");

            require(node.unregisterTime != 0, "cannot unregister an active node");

            // solium-disable-next-line security/no-block-members
            require(node.unregisterTime < block.timestamp, "only confirm after the timeout allowed");//solhint-disable-line not-rely-on-time

            msg.sender.transfer(node.deposit);

        } else {
            require(msg.sender == si.unregisterCaller, "only unregister caller can confirm");
            // solium-disable-next-line security/no-block-members
            require(block.timestamp > si.unregisterTimeout, "only after timeout is over"); //solhint-disable-line not-rely-on-time

            // solium-disable-next-line security/no-block-members
            si.lockedTime = uint64(block.timestamp + node.timeout); //solhint-disable-line not-rely-on-time
            si.depositAmount = node.deposit - si.unregisterDeposit;

            msg.sender.transfer(si.unregisterDeposit*2);

            si.unregisterDeposit = 0;
            si.unregisterCaller = address(0x0);
        }

        removeNode(si.index);
        si.index = 0;
        si.used = false;
    }

    /// commits a blocknumber and a hash
    /// must be called before revealConvict
    /// @param _blockNumber the blocknumber of the wrong blockhash
    /// @param _hash keccak256(wrong blockhash, msg.sender, v, r, s), used to prevent frontrunning
    function convict(uint _blockNumber, bytes32 _hash, address _signer) external {

        ConvictInformation memory ci;
        ci.convictHash = _hash;
        ci.blockNumberConvict = block.number;

        convictMapping[_blockNumber][msg.sender] = ci;

        senderMapping[keccak256(abi.encodePacked(_blockNumber, _signer))] = msg.sender;
    }

    /// register a new Node with the sender as owner
    /// @param _url the url of the node, has to be unique
    /// @param _props properties of the node
    /// @param _timeout timespan of how long the node of a deposit will be locked. Will be at least for 1h
    function registerNode(
        string calldata _url,
        uint64 _props,
        uint64 _timeout,
        uint64 _weight
    )
    external payable
    {
        registerNodeInternal(
            _url,
            _props,
            _timeout,
            msg.sender,
            msg.sender,
            msg.value,
            _weight
        );
    }

     /// register a new Node with the sender as owner
    /// @param _url the url of the node, has to be unique
    /// @param _props properties of the node
    /// @param _timeout timespan of how long the node of a deposit will be locked. Will be at least for 1h
    /// @param _signer the signer of the in3-node
    function registerNodeFor(
        string calldata _url,
        uint64 _props,
        uint64 _timeout,
        address _signer,
        uint64 _weight
    )
    external payable
    {
        registerNodeInternal(
            _url,
            _props,
            _timeout,
            _signer,
            msg.sender,
            msg.value,
            _weight
        );
    }

    /// a node owner can request to unregister his node
    /// but before he can confirm, he has to wait for his own-set deposit timeout
    /// @param _signer the signer of the in3-node
    function requestUnregisteringNode(address _signer) external payable {

        SignerInformation memory si = signerIndex[_signer];
        require(si.used, "address is not an in3-signer");

        In3Node storage node = nodes[si.index];
        require(node.unregisterTime == 0, "node is already unregistering");

        // someone is claiming the node is inactive
        if (msg.sender != si.owner) {
            require(msg.value == calcUnregisterDeposit(_signer), "send deposit is not correct");
            si.unregisterCaller = msg.sender;
            si.unregisterDeposit = msg.value;
            // solium-disable-next-line security/no-block-members
            si.unregisterTimeout = block.timestamp + 28 days; // solhint-disable-line not-rely-on-time

        } else {
            // the owner is calling this function
            require(msg.value == 0, "no value transfer allowed");
             // solium-disable-next-line security/no-block-members
            node.unregisterTime = uint64(block.timestamp + node.timeout); // solhint-disable-line not-rely-on-time
            node.proofHash = calcProofHash(node);
        }

        emit LogNodeUnregisterRequested(node.url, node.signer);
    }

    /// reveals the wrongly provided blockhash, so that the node-owner will lose its deposit
    /// @param _signer the address that signed the wrong blockhash
    /// @param _blockhash the wrongly provided blockhash
    /// @param _blockNumber number of the wrongly provided blockhash
    /// @param _v v of the signature
    /// @param _r r of the signature
    /// @param _s s of the signature
    function revealConvict(
        address _signer,
        bytes32 _blockhash,
        uint _blockNumber,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    )
    external
    {
        // solium-disable-next-line security/no-block-members
        bytes32 evmBlockhash = blockhash(_blockNumber);

        if (evmBlockhash == 0x0) {
            evmBlockhash = blockRegistry.blockhashMapping(_blockNumber);
        }

        require(evmBlockhash != 0x0, "block not found");

        // if the blockhash is correct you cannot convict the node
        require(evmBlockhash != _blockhash, "you try to convict with a correct hash");

        SignerInformation storage si = signerIndex[_signer];
        ConvictInformation storage ci = convictMapping[_blockNumber][msg.sender];

        bytes32 convictIdent = keccak256(abi.encodePacked(_blockNumber, _signer));

        if (senderMapping[convictIdent] != msg.sender) {
            require(block.number >= ci.blockNumberConvict + 10, "revealConvict still locked");
        }

        require(
            ecrecover(
                keccak256(
                    abi.encodePacked(
                        _blockhash,
                        _blockNumber,
                        registryId)
                    ),
                _v,
                _r,
                _s
            ) == _signer,
            "the block was not signed by the signer of the node");

        require(
            keccak256(
                abi.encodePacked(
                    _blockhash,
                    msg.sender,
                    _v,
                    _r,
                    _s
                )
            ) == ci.convictHash, "wrong convict hash");

        emit LogNodeConvicted(_signer);

        uint deposit = nodes[si.index].signer == _signer ? nodes[si.index].deposit : si.depositAmount;

        // the signer is still active
        if (nodes[si.index].signer == _signer) {
            removeNode(si.index);
            si.index = 0;
        } else {
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

        delete convictMapping[_blockNumber][msg.sender];
        delete senderMapping[convictIdent];
    }

    function transferOwnership(address _signer, address _newOwner) external {
        SignerInformation storage si = signerIndex[_signer];

        require(si.owner == msg.sender, "only current owner can transfer ownership");
        require(si.used, "owner changes only on active nodes");

        si.owner = _newOwner;

    }

    /// updates a Node by adding the msg.value to the deposit and setting the props or timeout
    /// @param _url the url, will be changed if different from the current one
    /// @param _props the new properties, will be changed if different from the current onec
    /// @param _timeout the new timeout of the node, cannot be decreased
    function updateNode(
        address _signer,
        string calldata _url,
        uint64 _props,
        uint64 _timeout,
        uint64 _weight
    )
    external payable
    {
        SignerInformation memory si = signerIndex[_signer];
        require(si.owner == msg.sender, "only node owner can update");

        In3Node storage node = nodes[si.index];

        bytes32 newURl = keccak256(bytes(_url));

        require(si.owner == msg.sender, "only owner can update node");
        require(si.used, "signer does not own a node");

        // the url got changed
        if (newURl != keccak256(bytes(node.url))) {

            // deleting the old entry
            delete urlIndex[keccak256(bytes(node.url))];

            // make sure the new url is not already in use
            require(!urlIndex[newURl].used, "url is already in use");

            UrlInformation memory ui;
            ui.used = true;
            ui.signer = msg.sender;
            urlIndex[newURl] = ui;
        }

        if (msg.value > 0) {
            node.deposit += msg.value;

            // solium-disable-next-line security/no-block-members
            if (block.timestamp < (blockTimeStampDeployment + 52 weeks)) // solhint-disable-line not-rely-on-time
                require(node.deposit < 50 ether, "Limit of 50 ETH reached");
        }

        if (_props != node.props) {
            node.props = _props;
        }

        if (_timeout > node.timeout) {
            node.timeout = _timeout;
        }

        if (_weight != node.weight) {
            node.weight = _weight;
        }

        node.proofHash = calcProofHash(node);

        emit LogNodeRegistered(
            node.url,
            _props,
            msg.sender,
            node.deposit
        );
    }

    /// length of the nodelist
    function totalNodes() external view returns (uint) {
        return nodes.length;
    }

    function calcUnregisterDeposit(address _signer) public view returns (uint) {
        return (nodes[signerIndex[_signer].index].deposit / 50 + tx.gasprice + 50000);
    }

    /// calculates the sha3 hash of the most important properties
    /// @param _node the in3 node to calculate the hash from
    function calcProofHash(In3Node memory _node) internal pure returns (bytes32) {

        return keccak256(
            abi.encodePacked(
                _node.deposit,
                _node.timeout,
                _node.registerTime,
                _node.unregisterTime,
                _node.props,
                _node.signer,
                _node.url)
        );
    }

    // internal helper functions
    function registerNodeInternal(
        string memory _url,
        uint64 _props,
        uint64 _timeout,
        address _signer,
        address payable _owner,
        uint _deposit,
        uint64 _weight
    )
    internal
    {

        require(nodes.length < 0xFFFFFFFFFFFFFFFF, "maximum amount of nodes reached");
        // enforcing a minimum deposit
        require(_deposit >= 10 finney, "not enough deposit");

        // solium-disable-next-line security/no-block-members
        if (block.timestamp < (blockTimeStampDeployment + 52 weeks)) { // solhint-disable-line not-rely-on-time
            require(_deposit < 50 ether, "Limit of 50 ETH reached");
        }

        bytes32 urlHash = keccak256(bytes(_url));

        // make sure this url and also this owner was not registered before.
        require(!urlIndex[urlHash].used && !signerIndex[_owner].used, "a node with the same url or owner is already registered");

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
        // solium-disable-next-line security/no-block-members
        m.registerTime = uint64(block.timestamp); // solhint-disable-line not-rely-on-time
        m.weight = _weight;

        m.proofHash = calcProofHash(m);
        nodes.push(m);

        // sets the information of the url
        UrlInformation memory ui;
        ui.used = true;
        ui.signer = _signer;
        urlIndex[urlHash] = ui;

        emit LogNodeRegistered(
            _url,
            _props,
            _signer,
            _deposit
        );
    }

    /// removes a node from the node-array
    /// @param _nodeIndex the nodeIndex to be removed
    function removeNode(uint _nodeIndex) internal {
        // trigger event
        emit LogNodeRemoved(nodes[_nodeIndex].url, nodes[_nodeIndex].signer);

        uint length = nodes.length;

        assert(length > 0);
        // move the last entry to the removed one.
        In3Node memory m = nodes[length - 1];
        nodes[_nodeIndex] = m;

        SignerInformation storage si = signerIndex[m.signer];
        si.index = uint64(_nodeIndex);
        nodes.length--;
    }
}
