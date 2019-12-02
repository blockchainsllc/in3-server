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


/// @title Incubed White List Contract
/// @dev this is used as an optional step to define the nodes a client will use.
///      This each client may reference a whitelist, which can be managed by a organisation or individually.
contract IN3WhiteList {

    /// @notice proof hash for whiteListNodesList
    /// @dev    this value is the first storage-entry and is used to verify the correct whitelist in the client. 
    ///         This way we only need to verify the merkle proof for this one storage value and compare it against the hash of the data.
    bytes32 public proofHash;

    /// @notice Blocknumber for last event of adding or removing node from whitelist, which is used for the client to find out, if his list is up to date.
    /// @dev    this value is used for easier lookup. Instead on running eth_getLogs, we can simply find out be fetching this blocknumber
    uint public lastEventBlockNumber;

    /// @notice bytes array of whitelist nodes
    /// @dev    the list contains concatenated addresses (each 20 bytes) as the most compact representation of the whole list.
    bytes public whiteListNodesList;

    /// @notice in3 nodes list in mappings, which can be used as lookup. The uint represents the end of the entry in the whiteListNodesList
    /// @dev    it is internally used for faster lookups
    mapping(address=>uint) public whiteListNodes;

    /// @notice for tracking this white listing belongs to which node registry
    address public nodeRegistry;

    /// @notice owner of this white listing contract, can be multisig
    address public owner;

    /// @notice version: major minor fork(000) date(yyyy/mm/dd)
    uint constant public VERSION = 12300020191017;

    /// @notice event for looking node added to whitelisting contract
    event LogNodeWhiteListed(address nodeAddress);

    /// @notice event for looking node removed from whitelisting contract
    event LogNodeRemoved(address nodeAddress);

    /// @notice only owner modifier
    modifier onlyOwner {
        require(msg.sender == owner, "Only owner can call this function.");
        _;
    }

    /// @notice constructor
    /// @param _nodeRegistry address of a Node Registry-contract
    /// @dev   white listing contract constructor
    constructor(address _nodeRegistry) public {
        nodeRegistry = _nodeRegistry;
        owner = msg.sender;
    }

    /// @notice whitelisting node
    /// @notice only owner is allowed to add node to whitelist
    /// @param _nodeAddr address of node to be whitelisted
    function whiteListNode( address _nodeAddr)
        external
        onlyOwner
    {
        require(whiteListNodes[_nodeAddr] == 0, "Node already exists in whitelist.");

        bytes memory newAddr = abi.encodePacked(_nodeAddr);
        for (uint i = 0; i < 20; i++) whiteListNodesList.push(newAddr[i]);
        whiteListNodes[_nodeAddr] = whiteListNodesList.length;

        proofHash = keccak256(abi.encodePacked(whiteListNodesList));

        lastEventBlockNumber = block.number;

        emit LogNodeWhiteListed(_nodeAddr);
    }

    /// @notice removing node from white listing contract
    /// @param _nodeAddr node address to be removed from whitelist
    function removeNode(address _nodeAddr)
        external
        onlyOwner
    {
        uint location = whiteListNodes[_nodeAddr];  //location is not zero based index stored in mappings, it starts from 1
        require(location > 0, "Node doesnt exist in whitelist.");

        uint length = whiteListNodesList.length-1;
        for (uint i = 0; i < 20; i++) {
            if (location != length+1) { //check if its not first or not last addr then swap last with item to be deleted
                whiteListNodesList[location-i-1] = whiteListNodesList[length-i];
            }

            delete whiteListNodesList[length-i];
        }

        whiteListNodesList.length -= 20;

        lastEventBlockNumber = block.number;
        emit LogNodeRemoved(_nodeAddr);
    }

    /// @notice getting whitelist byte array
    function getWhiteList() public view returns (bytes memory tempBytes) {
        tempBytes = whiteListNodesList;
    }

    /// @notice function for getting proof hash of bytes array of whitelisted nodes addresses
    function getProofHash() public view returns (bytes32 tempBytes) {
        tempBytes = proofHash;
    }

    /// @notice function for getting last event blocknumber
    function getLastEventBlockNumber()  public view returns (uint) {
        return lastEventBlockNumber;
    }

}