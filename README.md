# Concept

The in3-node provides data from the ethereum clients to the in3-clients. They can either act as an regular RPC-provider, but they can also provide merkle-proofs(see https://github.com/ethereum/wiki/wiki/JSON-RPC#eth_getproof) for their responses and also sign blockhashes.

The merkle-proofs can be used by the clients to make sure that the response was correct (see https://in3.readthedocs.io/en/develop/poa.html for more information). The blockheaders are an essential part for each proof. An in3-client can also ask an in3-node to sign the blockHeader of the proofs, staking the deposit of the node to the correct answer. If the signed blockhashes is not part of the chain, he can be convicted and will lose its deposit.

Using this technique an in3-client has some kind of insurance that he will receive correct responses and results.

# Building

In order to compile the contracts, simply run `npm run updateContracts` and all the contracts in this repository will be compiled. The compiled contracts for the BlockhashRegistry, the ChainRegistry and the NodeRegistry can be found in the file `contracts.json` within the `contracts`-folder.

The command `npm run build` will compile all the TypeScript files to JavaScript.

# Testing

The test can be run by using the command `npm test`. However, the tests for the in3-node are using the `evm_increaseTime` command that regular ethereum-clients do not support, but is needed in order to test how the contract react to certain dates in the future (e.g. 1 year after deployment). For this, there is a special docker container using a reverse proxy in combination with libfaketime (see https://github.com/wolfcw/libfaketime) allowing the change of time for parities. Nevertheless, the test should also run using a regular geth-client.

# usage

**not yet implemented**

## registering a node

Running the command `npm run registerServer config.json` will parse the provided JSON-file and try to unboard a new configuration using the desired configuration.

Such a JSON-file has different field with some of then being optional:
* `pk`: the privateKey for signing blockhashes with the in3-node. If not provided the standard account of the user is used
* `registry_address`: the address of the NodeRegistry contract. If not provided the in3-contract for mainnet is used (if no different chainID is provided)
* `rpc_endPoint`: the RPC to be used for deploying. If not provided a slock.it rpc is used.
* `chainId`: the chainId of the chain to be used. If not provided the mainnet-id will be used
* `in3_node_url` the url for the new in3-node. Has to be provided
* `depositAmount` the amount of deposit the user is willing to stake in the NodeRegistry-contract. If not provided 10 finney will be used
* `properties` the properties of the in3-node as bitmask. If not provided the standard properties will be used
* `timeout` the timeout until the user can receive his deposit after he unregistered his in3-node. If not provided 1h will be used
* `weight` the amount of requests the node is able to handle.

## update a node

Running the command `npm run updateServer config.json` will parse the provided JSON-file and try to update an existing in3-node to a new configuration using the desired configuration.

Such a JSON-file has different field with some of then being optional:
* `pk`: the privateKey for signing blockhashes with the in3-node. If not provided the standard account of the user is used
* `registry_address`: the address of the NodeRegistry contract. If not provided the in3-contract for mainnet is used (if no different chainID is provided)
* `rpc_endPoint`: the RPC to be used for deploying. If not provided a slock.it rpc is used.
* `chainId`: the chainId of the chain to be used. If not provided the mainnet-id will be used
* `in3_node_url` the url for the new in3-node. If not provided the current one will be used
* `depositAmount` the amount of deposit the user is willing to stake in the NodeRegistry-contract. If not provided 10 finney will be used
* `properties` the properties of the in3-node as bitmask. If not provided the standard properties will be used
* `timeout` the timeout until the user can receive his deposit after he unregistered his in3-node. If not provided 1h will be used
* `weight` the amount of requests the node is able to handle.

## unregister

Running the command `npm run unregisterServer config.json` will parse the provided JSON-file and unregister an existing in3-node

Such a JSON-file has different field with some of then being optional:
* `pk`: the privateKey for signing blockhashes with the in3-node. If not provided the standard account of the user is used
* `registry_address`: the address of the NodeRegistry contract. If not provided the in3-contract for mainnet is used (if no different chainID is provided)
* `rpc_endPoint`: the RPC to be used for deploying. If not provided a slock.it rpc is used.
* `chainId`: the chainId of the chain to be used. If not provided the mainnet-id will be used
* `depositAmount` the amount of deposit the user is willing to stake in the NodeRegistry-contract. If not provided 10 finney will be used

# Running an in3-node

## docker

To run a incubed node, you simply use docker-compose:

```yml
version: '2'
services:
  incubed-server:
    image: .
    volumes:
    - $PWD/keys:/secure                                     # directory where the private key is stored
    ports:
    - 8500:8500/tcp                                         # open the port 8500 to be accessed by public
    command:
    - --privateKey=/secure/myKey.json                       # internal path to the key
    - --privateKeyPassphrase=dummy                          # passphrase to unlock the key
    - --chain=0x1                                           # chain (mainnet)
    - --rpcUrl=http://incubed-parity:8545                   # url of the kovan-client
    - --registry=0xFdb0eA8AB08212A1fFfDB35aFacf37C3857083ca # url of the incubed-registry
    - --autoRegistry-url=http://in3.server:8500             # check or register this node for this url
    - --autoRegistry-deposit=2                              # deposit to use when registering

  incubed-parity:
    image: parity/parity                                    # parity-image with the getProof-function implemented
    command:
    - --auto-update=none                                    # do not automaticly update the client
```

A full list with possible commands to configure the in3-node can be found in the documentation: https://in3.readthedocs.io/en/develop/api-docker.html

## node

It s also possible to run a node without docker using the command:

`node js/src/server/server.js --chain=0x1 --privateKey=/secure/myKey.json --rpcUrl=http://incubed-parity:8545  --registry=0xFdb0eA8AB08212A1fFfDB35aFacf37C3857083ca`

A full list with possible commands to configure the in3-node for node can be found in the documentation: https://in3.readthedocs.io/en/develop/api-node.html#comandline-arguments

# in depth

## NodeRegistry

### Deployment

The NodeRegistry can be deployed using the function `deployNodeRegistry(pk: string, url = 'http://localhost:8545', transport?: Transport)`. As the NodeRegistry needs a BlockhashRegistry contract-address during the deployment, both of them will be deployed at once and automatically linked.

An alternative way of deploying only the NodeRegistry and using an already deployed BlockhashRegistry-contract would be using `deployContract(url, '0x' + bin.contracts[Object.keys(bin.contracts).find(_ => _.indexOf('NodeRegistry') >= 0)].bin + padStart(blockHashAddress, 64, "0")`.

Both of the function can be found within the `src/util/registry.ts` file.

### compiled contract

The output of the compiled can be either received by running `npm run updateContracts`. Afterwards the information of the contract can be found in the `contracts.json` file located in the `contracts` folder.

**not yet implemented**
In addition, the output of the latest compilation is also stored within IPFS:
* ipf-Hash: ...
* link: ...

### Usage and Purpose

The main purpose of the NodeRegistry contracts is storing an array with currently active in3-nodes (= nodeList). In order to achieve that functionality, there are function for registering, updating, unregistering and also convicting nodes that signed wrong blockhashes, i.e. returning wrong results for requests.

#### Registering an in3-node

There are two different ways of registering an in3-node within the smart contract:
* `registerNode(string _url, uint64 _props, uint64 _timeout, uint64 _weight)` registers a new node with the sender of the transaction as signer for in3-requests
* `registerNodeFor(string _url, uint64 _props, uint64 _timeout, address _signer, uint64 _weight, uint8 _v, bytes32 _r, bytes32 _s)` registers a new node with the `_signer` as signer for in3-requests.

Both functions share some parameters:
* `_url`: the url of the in3-node. Has to be unique, so if there is already an in3-node with the same url the register-transaction will fail
* `_props`: the properties of the new in3-node (e.g. archive-node) as bitmask
* `_timeout`: the time until the owner of the in3-node can access his deposit after he unregistered his node in seconds
* `_weight`: how many requests the node is able to handle

When using the `registerNodeFor`-function, the owner and the signer of an in3-node are different. In order to make sure that the owner has also control over the signer-address, the signer has to sign an ethereum-message containing the  `_url`, `_props`, `_timeout`, `_weight` and the owner (= msg.sender of the `registerNodeFor`-transaction) and using the resulting parameters (v,r,s) within the function.

In addition, the user has to provide a minimum deposit of `10 finney` = `0.01 ether`. In addition, during the 1st year after deployment, the maximum amount of deposit a node is allowed to have it `50 ether`.

The `_timeout` parameter has certain boundaries: the minimal timeout is 1h (3600 sec). So when registering a new node with a timeout smaller then 1h this will be overwritten by the smart contract and the timeout will be set to 1h. There is also an upper boundary of 1 year. When trying to register a new in3-node with a timeout greater then 1 year the transaction will fail.

#### Updating an in3-node

In case that the properties of the node changed (e.g. deposit, props, etc), the `updateNode(address _signer, string _url, uint64 _props, uint64 _timeout, uint64 _weight)` can be called, updating the values.

For the update the same rules as for onboarding do apply. In addition there are some more rules:
* if the `_url` is different from the current one, the new one also has to be unique and not yet registered within the smart contract
* the `_timeout` cannot be decreased, so if a new timeout smaller then the old one is provided, it will be ignored by the smart contract

#### Unregister

In order to unregister a node, the function `unregisteringNode(address _signer)` can be called by the owner of the in3-node. The node will then immediately removed from the in3-nodeList. However, the deposit of the former in3-node will be locked until the provided timeout of that node is over. This is done to make sure the node can still be made liable for returning wrong signed blockhashes.

After the timeout-period is over, the deposit can be withdrawn using the function `returnDeposit(address _signer)` which will the deposit of the former node to its former owner.

#### Convicting an in3-node

If an in3-node sends a wrong response to the clients, he can be convicted using two steps:

Calling the `convict(uint _blockNumber, bytes32 _hash)` function with uses 2 parameters:
* `_blockNumber` the blockNumber of the block with the wrong blockhash
* `_hash` a hash calculated using the formula `keccak256(wrong blockhash, msg.sender, v, r, s)`, i.e. hashing the wrongly provided blockhash, the sender of the convict-transaction and the signature parameters of the in3-node response the client received.

After this transaction was mined, the user has to wait for at least 2 blocks until he can call `revealConvict(address _signer, bytes32 _blockhash, uint _blockNumber, uint8 _v, bytes32 _r,bytes32 _s)` with the parameters:
* `_signer` the address of the in3 node that provided a wrong blockhash
* `_blockhash` the wrong blockhash
* `_blockNumber` the blockNumber of block with the wrong blockhash
* `_v` v of the signature with the wrong blockhash
* `_r` r of the signature with the wrong blockhash
* `_s` s of the signature with the wrong blockhash

If the wrongfully block was within the latest 256 blocks, there both functions can be called without further actions. Nevertheless, the NodeRegistry is also able to handle blocks that are older then this, thus cannot be found within the evm directly. For older blocks the blockhash has to be stored (and found) within the BlockHashRegistry.

If a node has been successfully convicted, 50% of the deposit will be transferred to the caller of the `revealConcict`-caller, the rest will be burned. In addition, the node will also be removed from the registry.

**Usually the users do not have to care about convicting mechanics, as the in3-nodes can (and will) handle the full convict circle automatically (including the possible recreation of blockHeaders for the BlockHashRegistry of it's worth it)**

## BlockHashRegistry

### Deployment

The BlockHash-registry can be deployed using the function `deployBlockhashRegistry(pk: string, url = 'http://localhost:8545', transport?: Transport)` located within the `src/util/registry.ts` file.

### compiled contract

The output of the compiled can be either received by running `npm run updateContracts`. Afterwards the information of the contract can be found in the `contracts.json` file located in the `contracts` folder.

**not yet implemented**
In addition, the output of the latest compilation is also stored within IPFS:
* ipfs-Hash: ...
* link: ...

### Usage and Purpose

The BlockHashRegistry-contract is able to store certain blockhashes and their corresponding numbers. On the one hand it's possible to do either a `snapshot()` (i.e. storing the previous blockhash of the chain), or calling `saveBlockNumber(uint _blockNumber)` (i.e. storing one of the latest 256 blocks).

In addition, the smart contract is also able to store blockhashes that are (way) older then the latest blocks using the function `recreateBlockheaders(uint _blockNumber, bytes[] memory _blockheaders)`. The user has to provide a blockNumber of an already stored blockhash and its corresponding serialized blockheader together with more serialized blockheaders in reversed order (e.g. blockNumber #100, blockNumber #99, blockNumber #98).

The smart contract will use the serialized headers to both extract the blockhash of the parentBlock, and also hash the header in order to receive the blockhash. This calculated blockhash is then compared to the previous parent blockhash(or the starting blockhash). Repeating this action enables the smart contract to check for the validity of the provided chain and securely store blockhashes that are way older then the latest blocks.

Nevertheless, there are some limitations using this function: as the provided payloads can get really big, geth-clients only support up to about 45 serialized blockHeaders. Using a parity-clients enabled the recreation of up to 200 blockHeaders at once.

In order to achieve the described functionality, there are multiple helper functions using the view modifier, enabling a user to check whether the smart contract would accept his provided chain of blockheaders:
* `getParentAndBlockhash(bytes memory _blockheader)` is used to calculate and return both the parent blockhash and the blockhash of the provided blockHeader
* `reCalculateBlockheaders(bytes[] memory _blockheaders, bytes32 _bHash)` uses starting blockhash `_bHash`and an array of reversed serialized blockHeader. It will either return the blockhash of the last element of the provided array, or it will return `0x0` when the provided chain is not correct
*  `searchForAvailableBlock(uint _startNumber, uint _numBlocks)` allows to search for an already stored blockNumber within the smart contract within the provided range. It will return either 0 (when no blockNumber had been found), or it will return the closest blockNumber that allows the recreation of the chain.
