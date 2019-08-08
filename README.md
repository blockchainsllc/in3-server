# Concept 

The in3-node provides data from the ethereum clients to the in3-clients. They can either act as an regular RPC-provider, but they can also provide merkle-proofs for their responses and also sign blockhashes. 

The merkle-proofs can be used by the clients to make sure that the response was correct (see https://in3.readthedocs.io/en/develop/poa.html for more information). The blockHeaders are an essential part for each proof. An in3-client can also ask an in3-node to sign the blockHeader of the proofs, staking the deposit of the node to the correct answer. If the signed blockhashes is not part of the chain, he can be convicted and will lose its deposit. 

Using this technique an in3-client has some kind of insurance that he will receive correct responses and results. 

# Building

In order to compile the contracts, simply run `npm run updateContracts` and all the contracts in this repository will be compiled. The compiled contracts for the BlockhashRegistry, the ChainRegistry and the NodeRegistry can be found in the file `contracts.json` within the `contracts`-folder. 

The command `npm run build` will compile all the TypeScript files to JavaScript. 

# Testing

The test can be run by using the command `npm test`. However, the tests for the in3-node are using the `evm_increaseTime` command that regular ethereum-clients do not support, but is needed in order to test how the contract react to certain dates in the future (e.g. 1 year after deployment). For this, there is a special docker container using a reverse proxy in combination with libfaketime (see https://github.com/wolfcw/libfaketime) allowing the change of time for parities. Nevertheless, the test should also run using a regular geth-client. 


# NodeRegistry

## Deployment

The NodeRegistry can be deployed using the function `deployNodeRegistry(pk: string, url = 'http://localhost:8545', transport?: Transport)`. As the NodeRegistry needs a BlockhashRegistry contract-address during the deployment, both of them will be deployed at once and automatically linked. 

An alternative way of deploying only the NodeRegistry and using an already deployed BlockhashRegistry-contract would be using `deployContract(url, '0x' + bin.contracts[Object.keys(bin.contracts).find(_ => _.indexOf('NodeRegistry') >= 0)].bin + padStart(blockHashAddress, 64, "0")`. 

Both of the function can be found within the `src/util/registry.ts` file.

## ABI 

```js
[{\"constant\":false,\"inputs\":[{\"name\":\"_signer\",\"type\":\"address\"},{\"name\":\"_url\",\"type\":\"string\"},{\"name\":\"_props\",\"type\":\"uint64\"},{\"name\":\"_timeout\",\"type\":\"uint64\"},{\"name\":\"_weight\",\"type\":\"uint64\"}],\"name\":\"updateNode\",\"outputs\":[],\"payable\":true,\"stateMutability\":\"payable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[],\"name\":\"registryId\",\"outputs\":[{\"name\":\"\",\"type\":\"bytes32\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_signer\",\"type\":\"address\"}],\"name\":\"removeNodeFromRegistry\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_blockNumber\",\"type\":\"uint256\"},{\"name\":\"_hash\",\"type\":\"bytes32\"}],\"name\":\"convict\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"\",\"type\":\"address\"}],\"name\":\"signerIndex\",\"outputs\":[{\"name\":\"lockedTime\",\"type\":\"uint64\"},{\"name\":\"owner\",\"type\":\"address\"},{\"name\":\"stage\",\"type\":\"uint8\"},{\"name\":\"depositAmount\",\"type\":\"uint256\"},{\"name\":\"index\",\"type\":\"uint256\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_signer\",\"type\":\"address\"}],\"name\":\"unregisteringNode\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"\",\"type\":\"uint256\"}],\"name\":\"nodes\",\"outputs\":[{\"name\":\"url\",\"type\":\"string\"},{\"name\":\"deposit\",\"type\":\"uint256\"},{\"name\":\"timeout\",\"type\":\"uint64\"},{\"name\":\"registerTime\",\"type\":\"uint64\"},{\"name\":\"props\",\"type\":\"uint128\"},{\"name\":\"weight\",\"type\":\"uint64\"},{\"name\":\"signer\",\"type\":\"address\"},{\"name\":\"proofHash\",\"type\":\"bytes32\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[],\"name\":\"unregisterKey\",\"outputs\":[{\"name\":\"\",\"type\":\"address\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_signer\",\"type\":\"address\"},{\"name\":\"_newOwner\",\"type\":\"address\"}],\"name\":\"transferOwnership\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[],\"name\":\"totalNodes\",\"outputs\":[{\"name\":\"\",\"type\":\"uint256\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_url\",\"type\":\"string\"},{\"name\":\"_props\",\"type\":\"uint64\"},{\"name\":\"_timeout\",\"type\":\"uint64\"},{\"name\":\"_signer\",\"type\":\"address\"},{\"name\":\"_weight\",\"type\":\"uint64\"},{\"name\":\"_v\",\"type\":\"uint8\"},{\"name\":\"_r\",\"type\":\"bytes32\"},{\"name\":\"_s\",\"type\":\"bytes32\"}],\"name\":\"registerNodeFor\",\"outputs\":[],\"payable\":true,\"stateMutability\":\"payable\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_signer\",\"type\":\"address\"}],\"name\":\"returnDeposit\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[],\"name\":\"blockTimeStampDeployment\",\"outputs\":[{\"name\":\"\",\"type\":\"uint256\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_signer\",\"type\":\"address\"},{\"name\":\"_blockhash\",\"type\":\"bytes32\"},{\"name\":\"_blockNumber\",\"type\":\"uint256\"},{\"name\":\"_v\",\"type\":\"uint8\"},{\"name\":\"_r\",\"type\":\"bytes32\"},{\"name\":\"_s\",\"type\":\"bytes32\"}],\"name\":\"revealConvict\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"\",\"type\":\"bytes32\"}],\"name\":\"urlIndex\",\"outputs\":[{\"name\":\"used\",\"type\":\"bool\"},{\"name\":\"signer\",\"type\":\"address\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_url\",\"type\":\"string\"},{\"name\":\"_props\",\"type\":\"uint64\"},{\"name\":\"_timeout\",\"type\":\"uint64\"},{\"name\":\"_weight\",\"type\":\"uint64\"}],\"name\":\"registerNode\",\"outputs\":[],\"payable\":true,\"stateMutability\":\"payable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[],\"name\":\"blockRegistry\",\"outputs\":[{\"name\":\"\",\"type\":\"address\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[],\"name\":\"VERSION\",\"outputs\":[{\"name\":\"\",\"type\":\"uint256\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"inputs\":[{\"name\":\"_blockRegistry\",\"type\":\"address\"}],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"constructor\"},{\"anonymous\":false,\"inputs\":[{\"indexed\":false,\"name\":\"url\",\"type\":\"string\"},{\"indexed\":false,\"name\":\"props\",\"type\":\"uint256\"},{\"indexed\":false,\"name\":\"signer\",\"type\":\"address\"},{\"indexed\":false,\"name\":\"deposit\",\"type\":\"uint256\"}],\"name\":\"LogNodeRegistered\",\"type\":\"event\"},{\"anonymous\":false,\"inputs\":[{\"indexed\":false,\"name\":\"signer\",\"type\":\"address\"}],\"name\":\"LogNodeConvicted\",\"type\":\"event\"},{\"anonymous\":false,\"inputs\":[{\"indexed\":false,\"name\":\"url\",\"type\":\"string\"},{\"indexed\":false,\"name\":\"signer\",\"type\":\"address\"}],\"name\":\"LogNodeRemoved\",\"type\":\"event\"}]
```

## Usage and Purpose 

The main purpose of the NodeRegistry contracts is storing an array with currently active in3-nodes (= nodeList). In order to achieve that functionality, there are function for registering, updating, unregistering and also convicting nodes that signed wrong blockhashes, i.e. returning wrong results for requests. 

### Registering an in3-node

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

### Updating an in3-node

In case that the properties of the node changed (e.g. deposit, props, etc), the `updateNode(address _signer, string _url, uint64 _props, uint64 _timeout, uint64 _weight)` can be called, updating the values. 

For the update the same rules as for onboarding do apply. In addtion there are some more rules:
* if the `_url` is different from the current one, the new one also has to be unique and not yet registered within the smart contract
* the `_timeout` cannot be decreased, so if a new timeout smaller then the old one is provided, it will be ignored by the smart contract

### Unregister

In order to unregister a node, the function `unregisteringNode(address _signer)` can be called by the owner of the in3-node. The node will then immediately removed from the in3-nodeList. However, the deposit of the former in3-node will be locked until the provided timeout of that node is over. This is done to make sure the node can still be made liable for returning wrong signed blockhashes.

After the timeout-period is over, the deposit can be withdrawn using the function `returnDeposit(address _signer)` which will the deposit of the former node to its former owner.

### Convicting an in3-node

If an in3-node sends a wrong response to the clients, he can be convicted using two steps: 

Calling the `convict(uint _blockNumber, bytes32 _hash)` function with uses 2 parameters:
* `_blockNumber` the blockNumber of the block with the wrong blockhash
* `_hash` a hash calculated using the formula `keccak256(wrong blockhash, msg.sender, v, r, s)`, i.e. hashing the wrongly provided blockhash, the sender of the convict-transaction and the signature paramters of the in3-node response the client received. 

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

# BlockHashRegistry

## Deployment

The BlockHash-registry can be deployed using the function `deployBlockhashRegistry(pk: string, url = 'http://localhost:8545', transport?: Transport)` located within the `src/util/registry.ts` file. 

## ABI

```js
[{\"constant\":false,\"inputs\":[{\"name\":\"_blockNumber\",\"type\":\"uint256\"}],\"name\":\"saveBlockNumber\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"_blockheader\",\"type\":\"bytes\"}],\"name\":\"getParentAndBlockhash\",\"outputs\":[{\"name\":\"parentHash\",\"type\":\"bytes32\"},{\"name\":\"bhash\",\"type\":\"bytes32\"}],\"payable\":false,\"stateMutability\":\"pure\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"_startNumber\",\"type\":\"uint256\"},{\"name\":\"_numBlocks\",\"type\":\"uint256\"}],\"name\":\"searchForAvailableBlock\",\"outputs\":[{\"name\":\"\",\"type\":\"uint256\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_blockNumber\",\"type\":\"uint256\"},{\"name\":\"_blockheaders\",\"type\":\"bytes[]\"}],\"name\":\"recreateBlockheaders\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[],\"name\":\"snapshot\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"_blockheaders\",\"type\":\"bytes[]\"},{\"name\":\"_bHash\",\"type\":\"bytes32\"}],\"name\":\"reCalculateBlockheaders\",\"outputs\":[{\"name\":\"bhash\",\"type\":\"bytes32\"}],\"payable\":false,\"stateMutability\":\"pure\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"\",\"type\":\"uint256\"}],\"name\":\"blockhashMapping\",\"outputs\":[{\"name\":\"\",\"type\":\"bytes32\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"inputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"constructor\"},{\"anonymous\":false,\"inputs\":[{\"indexed\":true,\"name\":\"blockNr\",\"type\":\"uint256\"},{\"indexed\":true,\"name\":\"bhash\",\"type\":\"bytes32\"}],\"name\":\"LogBlockhashAdded\",\"type\":\"event\"}]
```

## Usage and Purpose 

The BlockHashRegistry-contract is able to store certain blockhashes and their corresponding numbers. On the one hand it's possible to do either a `snapshot()` (i.e. storing the previous blockhash of the chain), or calling `saveBlockNumber(uint _blockNumber)` (i.e. storing one of the latest 256 blocks). 

In addition, the smart contract is also able to store blockhashes that are (way) older then the latest blocks using the function `recreateBlockheaders(uint _blockNumber, bytes[] memory _blockheaders)`. The user has to provide a blockNumber of an already stored blockhash and it's corresponding serialized blockheader together with more serialized blockheaders in reversed order (e.g. blockNumber #100, blockNumber #99, blockNumber #98).

The smart contract will use the serialized headers to both extract the blockhash of the parentBlock, and also hash the header in order to receive the blockhash. This calculated blockhash is then compared to the previous parent blockhash(or the starting blockhash). Repeating this action enables the smart contract to check for the validity of the provided chain and securely store blockhashes that are way older then the latest blocks. 

Nevertheless, there are some limitations using this function: as the provided payloads can get really big, geth-clients only support up to about 45 serialized blockHeaders. Using a parity-clients enabled the recreation of up to 200 blockHeaders at once. 

In order to achieve the described functionality, there are multiple helper functions using the view modifier, enabling a user to check whether the smart contract would accept his provided chain of blockheaders:
* `getParentAndBlockhash(bytes memory _blockheader)` is used to calculate and return both the parent blockhash and the blockhash of the provided blockHeader
* `reCalculateBlockheaders(bytes[] memory _blockheaders, bytes32 _bHash)` uses starting blockhash `_bHash`and an array of reversed serialized blockHeader. It will either return the blockhash of the last element of the provided array, or it will return `0x0` when the provided chain is not correct
*  `searchForAvailableBlock(uint _startNumber, uint _numBlocks)` allows to search for an already stored blockNumber within the smart contract within the provided range. It will return either 0 (when no blockNumber had been found), or it will return the closest blockNumber that allows the recreation of the chain. 




### Running an in3-node

To run a incubed node, you simply use docker-compose:

```yml
version: '2'
services:
  incubed-server:
    image: slockit/in3-server:latest
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
    image: slockit/parity-in3:v2.2                          # parity-image with the getProof-function implemented
    command:
    - --auto-update=none                                    # do not automaticly update the client
    - --pruning=archive 
    - --pruning-memory=30000                                # limit storage
```

