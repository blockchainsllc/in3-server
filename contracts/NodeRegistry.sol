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

    /// a node was convicted
    event LogNodeConvicted(address signer);

    /// a Node is removed
    event LogNodeRemoved(string url, address signer);

    struct In3Node {
        string url;                         /// the url of the node

        uint deposit;                       /// stored deposit

        uint64 timeout;                     /// timeout after which the owner is allowed to receive his stored deposit
        uint64 registerTime;                /// timestamp when the node was registered
        uint128 props;                       /// a list of properties-flags representing the capabilities of the node

        uint64 weight;                      ///  the flag for (future) incentivisation
        address signer;                     /// the signer for requests

        bytes32 proofHash;                  /// keccak(deposit,timeout,registerTime,props,signer,url)
    }

     /// information of a (future) convict (used to prevent frontrunning)
    struct ConvictInformation {
        bytes32 convictHash;                /// keccak256(wrong blockhash, msg.sender, v, r, s)
        uint blockNumberConvict;            /// block number when convict had been called
    }

    /// information of a in3-node owner
    struct SignerInformation {
        uint64 lockedTime;                  /// unix timestamp until a node can proof activity
        address owner;                      /// the owner of the node

        Stages stage;                       /// state of the address

        uint depositAmount;                 /// amount of deposit to be locked, used only after vote-kick

        uint index;                         /// current index-position of the node in the node-array
    }

    /// information of an url
    struct UrlInformation {
        bool used;                          /// flag whether the url is currently used
        address signer;                     /// address of the owner of the url
    }

    enum Stages {
        NotInUse,
        Active,
        Convicted,
        DepositNotWithdrawn
    }

    /// node list of incubed nodes
    In3Node[] public nodes;

    /// id used for signing
    bytes32 public registryId;

    /// add your additional storage here. If you add information before this line you will break in3 nodelist

    /// blockhash registry address
    BlockhashRegistry public blockRegistry;

    /// the timestamp of the deployment
    uint public blockTimeStampDeployment;

    address public unregisterKey;

    /// mapping for information of the owner
    mapping (address => SignerInformation) public signerIndex;

    /// mapping for the information of the url
    /// can be used to access the SignerInformation-struct
    mapping (bytes32 => UrlInformation) public urlIndex;

    /// mapping for convicts: blocknumber => address => convictInformation
    mapping (uint => mapping(address => ConvictInformation)) internal convictMapping;

    /// capping the max deposit timeout on 1 year
    uint constant internal YEAR_DEFINITION = 1 days * 365;

    /// limit for ether per node in the 1st year
    uint constant internal MAX_ETHER_LIMIT = 50 ether;

    /// version: major minor fork(000) date(yyyy/mm/dd)
    uint constant public VERSION = 12300020190709;

    modifier onlyActiveState(address _signer) {

        SignerInformation memory si = signerIndex[_signer];
        require(si.stage == Stages.Active, "address is not an in3-signer");

        In3Node memory n = nodes[si.index];
        require(n.signer == _signer, "not the correct signer");
        _;
    }

    /// constructor
    /// @param _blockRegistry address of a BlockhashRegistry-contract
    constructor(BlockhashRegistry _blockRegistry) public {
        blockRegistry = _blockRegistry;

        // solium-disable-next-line security/no-block-members
        blockTimeStampDeployment = block.timestamp;  // solhint-disable-line not-rely-on-time
        registryId = keccak256(abi.encodePacked(address(this), blockhash(block.number-1)));
        unregisterKey = msg.sender;
    }

    /// @notice commits a blocknumber and a hash
    /// @notice must be called before revealConvict
    /// @param _blockNumber the blocknumber of the wrong blockhash
    /// @param _hash _B used to prevent frontrunning
    function convict(uint _blockNumber, bytes32 _hash) external {

        ConvictInformation memory ci;
        ci.convictHash = _hash;
        ci.blockNumberConvict = block.number;

        convictMapping[_blockNumber][msg.sender] = ci;
    }

    /// @notice register a new node with the sender as owner
    /// @param _url the url of the node, has to be unique
    /// @param _props properties of the node
    /// @param _timeout timespan of how long the node of a deposit will be locked. Will be at least for 1h
    /// @param _weight how many requests per second the node is able to handle
    /// @dev will call the registerNodeInteral function
    function registerNode(
        string calldata _url,
        uint64 _props,
        uint64 _timeout,
        uint64 _weight
    )
        external
        payable
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

    /// @notice register a new node as a owner using a different signer address
    /// @param _url the url of the node, has to be unique
    /// @param _props properties of the node
    /// @param _timeout timespan of how long the node of a deposit will be locked. Will be at least for 1h
    /// @param _signer the signer of the in3-node
    /// @param _weight how many requests per second the node is able to handle
    /// @dev will call the registerNodeInteral function
    function registerNodeFor(
        string calldata _url,
        uint64 _props,
        uint64 _timeout,
        address _signer,
        uint64 _weight
    )
        external
        payable
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

    /// @notice removes an in3-server from the registry
    /// @param _signer the signer-address of the in3-node
    /// @dev only callable by the unregisterKey-account
    /// @dev only callable in the 1st year after deployment
    function removeNodeFromRegistry(address _signer)
        external
        onlyActiveState(_signer)
    {

        // solium-disable-next-line security/no-block-members
        require(block.timestamp < (blockTimeStampDeployment + YEAR_DEFINITION), "only in 1st year");// solhint-disable-line not-rely-on-time
        require(msg.sender == unregisterKey, "only unregisterKey is allowed to remove nodes");

        SignerInformation storage si = signerIndex[_signer];

        In3Node memory n = nodes[si.index];

        // solium-disable-next-line security/no-block-members
        si.lockedTime = uint64(block.timestamp + n.timeout);// solhint-disable-line not-rely-on-time
        si.depositAmount = n.deposit;
        si.stage = Stages.DepositNotWithdrawn;

        removeNode(si.index);

    }

    /// @notice a node owner can request to unregister his node
    /// @notice but before he can confirm, he has to wait for his own-set deposit timeout
    /// @notice can also be called by a non owner, challenging the in3-node to prove that he is active
    /// @notice in order to do so, a challenger has to stake an amount equal to 2% of the node's deposit
    /// @param _signer the signer of the in3-node
    /// @dev reverts when the provided address is not an in3-signer
    /// @dev reverts when the node is already unregistering
    /// @dev reverts when inactivity is claimed
    /// @dev if not the node owner reverts when the send deposit it not correct
    /// @dev reverts when being the owner and sending value through this function
    function requestUnregisteringNode(address _signer)
        external
        onlyActiveState(_signer)
    {

        SignerInformation storage si = signerIndex[_signer];
        In3Node memory n = nodes[si.index];
        require(si.owner == msg.sender, "only for the in3-node owner");

        // solium-disable-next-line security/no-block-members
        si.lockedTime = uint64(block.timestamp + n.timeout);// solhint-disable-line not-rely-on-time
        si.depositAmount = n.deposit;
        si.stage = Stages.DepositNotWithdrawn;
        removeNode(si.index);
    }

    /// @notice returns the deposit after a node has been removed due to inactivity
    /// @notice only callable after the timeout of the deposit is over
    /// @param _signer the signer-address of a former in3-node
    /// @dev reverts when not the owner of the former in3-node
    /// @dev reverts when there is nothing to transfer
    /// @dev reverts if the deposit is still locked
    function returnDeposit(address _signer) external {

        SignerInformation storage si = signerIndex[_signer];

        require(si.stage == Stages.DepositNotWithdrawn, "not in the correct state");
        require(si.owner == msg.sender, "only owner can claim deposit");
        require(si.depositAmount > 0, "nothing to transfer");
        // solium-disable-next-line security/no-block-members
        require(block.timestamp > si.lockedTime, "deposit still locked"); // solhint-disable-line not-rely-on-time

        uint payout = si.depositAmount;
        si.depositAmount = 0;
        si.lockedTime = 0;
        si.stage = Stages.NotInUse;

        msg.sender.transfer(payout);
    }

    /// @notice reveals the wrongly provided blockhash, so that the node-owner will lose its deposit
    /// @param _signer the address that signed the wrong blockhash
    /// @param _blockhash the wrongly provided blockhash
    /// @param _blockNumber number of the wrongly provided blockhash
    /// @param _v v of the signature
    /// @param _r r of the signature
    /// @param _s s of the signature
    /// @dev reverts if a block with that number cannot be found in either the latest 256 blocks or the blockhash registry
    /// @dev reverts when tryin to convict someone with a correct blockhash
    /// @dev reverts when trying to reveal immediately after calling convict
    /// @dev reverts when the _signer did not sign the block
    /// @dev reverts when the wrong convict hash (see convict-function) is used
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

        require(block.number >= ci.blockNumberConvict + 2, "revealConvict still locked");
        require(
            ecrecover(
                keccak256(
                    abi.encodePacked(
                        _blockhash,
                        _blockNumber,
                        registryId)
                    ),
                _v, _r, _s) == _signer,
            "the block was not signed by the signer of the node");

        require(
            keccak256(
                abi.encodePacked(
                    _blockhash, msg.sender, _v, _r, _s
                )
            ) == ci.convictHash, "wrong convict hash");
        emit LogNodeConvicted(_signer);

        uint deposit = 0;
        // the signer is still active
        if (si.stage == Stages.Active) {
            assert(nodes[si.index].signer == _signer);
            deposit = nodes[si.index].deposit;
            nodes[si.index].deposit = 0;
            removeNode(si.index);
        } else {
            // double check that the signer is not active
            assert(si.stage != Stages.Active);
            // the signer is not active anymore
            deposit = si.depositAmount;
            si.depositAmount = 0;
            si.lockedTime = 0;
        }

        si.stage = Stages.Convicted;
        delete convictMapping[_blockNumber][msg.sender];

        // remove the deposit
        uint payout = deposit / 2;
        // send 50% to the caller of this function
        msg.sender.transfer(payout);
        // and burn the rest by sending it to the 0x0-address
        // this is done in order to make it useless trying to convict your own node with a second account
        // and this getting all the deposit back after signing a wrong hash.
        address(0).transfer(deposit-payout);
    }

    /// @notice changes the ownership of an in3-node
    /// @param _signer the signer-address of the in3-node, used as an identifier
    /// @param _newOwner the new owner
    /// @dev reverts when trying to change ownership of an inactive node
    /// @dev reverts when trying to pass ownership to 0x0
    /// @dev reverts when the sender is not the current owner
    /// @dev reverts when inacitivity is claimed
    function transferOwnership(address _signer, address _newOwner)
        external
        onlyActiveState(_signer)
    {
        SignerInformation storage si = signerIndex[_signer];
        require(si.owner == msg.sender, "only for the in3-node owner");

        require(_newOwner != address(0x0), "0x0 address is invalid");
        si.owner = _newOwner;
    }

    /// @notice updates a node by adding the msg.value to the deposit and setting the props or timeout
    /// @param _signer the signer-address of the in3-node, used as an identifier
    /// @param _url the url, will be changed if different from the current one
    /// @param _props the new properties, will be changed if different from the current onec
    /// @param _timeout the new timeout of the node, cannot be decreased
    /// @param _weight the amount of requests per second the node is able to handle
    /// @dev reverts when the sender is not the owner of the node
    /// @dev reverts when the signer does not own a node
    /// @dev reverts when trying to increase the timeout above 10 years
    /// @dev reverts when trying to change the url to an already existing one
    function updateNode(
        address _signer,
        string calldata _url,
        uint64 _props,
        uint64 _timeout,
        uint64 _weight
    )
        external
        payable
        onlyActiveState(_signer)
    {
        SignerInformation memory si = signerIndex[_signer];
        require(_timeout <= YEAR_DEFINITION, "exceeded maximum timeout");
        require(si.owner == msg.sender, "only for the owner");

        In3Node storage node = nodes[si.index];

        bytes32 newURl = keccak256(bytes(_url));

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
            if (block.timestamp < (blockTimeStampDeployment + YEAR_DEFINITION)) {// solhint-disable-line not-rely-on-time
                require(node.deposit < MAX_ETHER_LIMIT, "Limit of 50 ETH reached");
            }
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

    /// @notice length of the nodelist
    /// @return the number of total in3-nodes
    function totalNodes() external view returns (uint) {
        return nodes.length;
    }

    /// @notice calculates the sha3 hash of the most important properties
    /// @param _node the in3 node to calculate the hash from
    /// @return the proof hash of the properties of an in3-node
    function calcProofHash(In3Node memory _node) internal pure returns (bytes32) {

        return keccak256(
            abi.encodePacked(
                _node.deposit,
                _node.timeout,
                _node.registerTime,
                _node.props,
                _node.signer,
                _node.url
            )
        );
    }

    /// @notice registers a node
    /// @param _url the url of a node
    /// @param _props properties of a node
    /// @param _timeout the time before the owner can access the deposit after unregistering a node
    /// @param _signer the address that signs the answers of the node
    /// @param _owner the owner address of the node
    /// @param _deposit the deposit of a node
    /// @param _weight the amount of requests per second a node is able to handle
    /// @dev reverts when time timeout exceed the MAXDEPOSITTIMEOUT
    /// @dev reverts when provided not enough deposit
    /// @dev reverts when trying to register a node with more then 50 ether in the 1st year after deployment
    /// @dev reverts when either the owner or the url is already in use
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

        // enforcing a maximum timeout
        require(_timeout <= YEAR_DEFINITION, "exceeded maximum timeout");

        // enforcing a minimum deposit
        require(_deposit >= 10 finney, "not enough deposit");

        // solium-disable-next-line security/no-block-members
        if (block.timestamp < (blockTimeStampDeployment + YEAR_DEFINITION)) { // solhint-disable-line not-rely-on-time
            require(_deposit < MAX_ETHER_LIMIT, "Limit of 50 ETH reached");
        }

        bytes32 urlHash = keccak256(bytes(_url));

        // make sure this url and also this owner was not registered before.
        // solium-disable-next-line
        require(!urlIndex[urlHash].used && signerIndex[_signer].stage == Stages.NotInUse,
            "a node with the same url or signer is already registered");

        // sets the information of the owner
        signerIndex[_signer].stage = Stages.Active;
        signerIndex[_signer].index = nodes.length;
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

    /// @notice removes a node from the node-array
    /// @param _nodeIndex the nodeIndex to be removed
    function removeNode(uint _nodeIndex) internal {
        // trigger event
        emit LogNodeRemoved(nodes[_nodeIndex].url, nodes[_nodeIndex].signer);
        // deleting the old entry
        delete urlIndex[keccak256(bytes(nodes[_nodeIndex].url))];
        uint length = nodes.length;

        assert(length > 0);

        // reset the index position
        signerIndex[nodes[_nodeIndex].signer].index = 0;

        // move the last entry to the removed one.
        In3Node memory m = nodes[length - 1];
        nodes[_nodeIndex] = m;

        SignerInformation storage si = signerIndex[m.signer];
        si.index = uint64(_nodeIndex);
        nodes.length--;
    }
}
