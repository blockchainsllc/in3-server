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
* For more information, please refer to https://slock.it    *
* For questions, please contact info@slock.it              *
***********************************************************/

pragma solidity ^0.5.4;

contract ChainRegistry {

    struct Chain {
        address owner;
        string bootNodes;
        string meta;
        address registryContract;
        bytes32 contractChain;
    }

    mapping (bytes32 => Chain) public chains;

    event LogChainRegistered(bytes32 indexed chain);

    function registerChain(bytes32 chain, string calldata bootNodes, string calldata meta, address registryContract, bytes32 contractChain) external {
        Chain storage data = chains[chain];
        require(data.owner==address(0x0) || data.owner==msg.sender);
        data.bootNodes = bootNodes;
        data.owner = msg.sender;
        data.registryContract = registryContract;
        data.contractChain = contractChain;
        data.meta=meta;
        emit LogChainRegistered(chain);
    }
    

}