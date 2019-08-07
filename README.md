# Incubed Server

Typescript-version of the incubed server.
This server provides data and proof used to verify data.

# Building

In order to compile the contracts, simply run `npm run updateContracts` and all the contracts in this repository will be compiled. The compiled contracts for the BlockhashRegistry, the ChainRegistry and the NodeRegistry can be found in the file `contracts.json` within the `contracts`-folder. 

The command `npm run build` will compile all the TypeScript files to JavaScript. 

# BlockHashRegistry

## Deployment

The BlockHash-registry can be deployed using the function `deployBlockhashRegistry(pk: string, url = 'http://localhost:8545', transport?: Transport)` located within the `src/util/registry.ts` file. 

## ABI

```js
[{\"constant\":false,\"inputs\":[{\"name\":\"_blockNumber\",\"type\":\"uint256\"}],\"name\":\"saveBlockNumber\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"_blockheader\",\"type\":\"bytes\"}],\"name\":\"getParentAndBlockhash\",\"outputs\":[{\"name\":\"parentHash\",\"type\":\"bytes32\"},{\"name\":\"bhash\",\"type\":\"bytes32\"}],\"payable\":false,\"stateMutability\":\"pure\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"_startNumber\",\"type\":\"uint256\"},{\"name\":\"_numBlocks\",\"type\":\"uint256\"}],\"name\":\"searchForAvailableBlock\",\"outputs\":[{\"name\":\"\",\"type\":\"uint256\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_blockNumber\",\"type\":\"uint256\"},{\"name\":\"_blockheaders\",\"type\":\"bytes[]\"}],\"name\":\"recreateBlockheaders\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[],\"name\":\"snapshot\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"_blockheaders\",\"type\":\"bytes[]\"},{\"name\":\"_bHash\",\"type\":\"bytes32\"}],\"name\":\"reCalculateBlockheaders\",\"outputs\":[{\"name\":\"bhash\",\"type\":\"bytes32\"}],\"payable\":false,\"stateMutability\":\"pure\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"\",\"type\":\"uint256\"}],\"name\":\"blockhashMapping\",\"outputs\":[{\"name\":\"\",\"type\":\"bytes32\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"inputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"constructor\"},{\"anonymous\":false,\"inputs\":[{\"indexed\":true,\"name\":\"blockNr\",\"type\":\"uint256\"},{\"indexed\":true,\"name\":\"bhash\",\"type\":\"bytes32\"}],\"name\":\"LogBlockhashAdded\",\"type\":\"event\"}]
```

## Usage and Purpose 

The BlockHashRegistry-contract is able to store certain blockHashes and their corresponding numbers. On the one hand it's possible to do either a `snapshot()` (i.e. storing the previous blockHash of the chain), or calling `saveBlockNumber(uint _blockNumber)` (i.e. storing one of the latest 256 blocks). 

In addition, the smart contract is also able to store blockHashes that are (way) older then the latest blocks using the function `recreateBlockheaders(uint _blockNumber, bytes[] memory _blockheaders)`. The user has to provide a blockNumber of an already stored blockHash and it's corresponding serialized blockheader together with more serialized blockheaders in reversed order (e.g. blockNumber #100, blockNumber #99, blockNumber #98).

The smart contract will use the serialized headers to both extract the blockHash of the parentBlock, and also hash the header in order to receive the blockHash. This calculated blockHash is then compared to the previous parent blockHash(or the starting blockHash). Repeating this action enables the smart contract to check for the validity of the provided chain and securely store blockHashes that are way older then the latest blocks. 

Nevertheless, there are some limitations using this function: as the provided payloads can get really big, geth-clients only support up to about 45 serialized blockHeaders. Using a parity-clients enabled the recreation of up to 200 blockHeaders at once. 

In order to achieve the described functionality, there are multiple helper functions using the view modifier, enabling a user to check whether the smart contract would accept his provided chain of blockheaders:
* `getParentAndBlockhash(bytes memory _blockheader)` is used to calculate and return both the parent blockHash and the blockHash of the provided blockHeader
* `reCalculateBlockheaders(bytes[] memory _blockheaders, bytes32 _bHash)` uses starting blockHash `_bHash`and an array of reversed serialized blockHeader. It will either return the blockHash of the last element of the provided array, or it will return `0x0` when the provided chain is not correct
*  `searchForAvailableBlock(uint _startNumber, uint _numBlocks)` allows to search for an already stored blockNumber within the smart contract within the provided range. It will return either 0 (when no blockNumber had been found), or it will return the closest blockNumber that allows the recreation of the chain. 

# Registering a in3-node

If you want to participate in this network and also register a node, you need to send a transaction to the registry-contract calling `function registerNode(string calldata _url, uint64 _props, uint64 _timeout, uint64 _weight)` or `function registerNodeFor( string calldata _url, uint64 _props, uint64 _timeout, address _signer, uint64 _weight, uint8 _v, bytes32 _r, bytes32 _s)`. 

ABI of the registry:

```js
[{\"constant\":false,\"inputs\":[{\"name\":\"_signer\",\"type\":\"address\"},{\"name\":\"_url\",\"type\":\"string\"},{\"name\":\"_props\",\"type\":\"uint64\"},{\"name\":\"_timeout\",\"type\":\"uint64\"},{\"name\":\"_weight\",\"type\":\"uint64\"}],\"name\":\"updateNode\",\"outputs\":[],\"payable\":true,\"stateMutability\":\"payable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[],\"name\":\"registryId\",\"outputs\":[{\"name\":\"\",\"type\":\"bytes32\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_signer\",\"type\":\"address\"}],\"name\":\"removeNodeFromRegistry\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_blockNumber\",\"type\":\"uint256\"},{\"name\":\"_hash\",\"type\":\"bytes32\"}],\"name\":\"convict\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"\",\"type\":\"address\"}],\"name\":\"signerIndex\",\"outputs\":[{\"name\":\"lockedTime\",\"type\":\"uint64\"},{\"name\":\"owner\",\"type\":\"address\"},{\"name\":\"stage\",\"type\":\"uint8\"},{\"name\":\"depositAmount\",\"type\":\"uint256\"},{\"name\":\"index\",\"type\":\"uint256\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_signer\",\"type\":\"address\"}],\"name\":\"unregisteringNode\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"\",\"type\":\"uint256\"}],\"name\":\"nodes\",\"outputs\":[{\"name\":\"url\",\"type\":\"string\"},{\"name\":\"deposit\",\"type\":\"uint256\"},{\"name\":\"timeout\",\"type\":\"uint64\"},{\"name\":\"registerTime\",\"type\":\"uint64\"},{\"name\":\"props\",\"type\":\"uint128\"},{\"name\":\"weight\",\"type\":\"uint64\"},{\"name\":\"signer\",\"type\":\"address\"},{\"name\":\"proofHash\",\"type\":\"bytes32\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[],\"name\":\"unregisterKey\",\"outputs\":[{\"name\":\"\",\"type\":\"address\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_signer\",\"type\":\"address\"},{\"name\":\"_newOwner\",\"type\":\"address\"}],\"name\":\"transferOwnership\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[],\"name\":\"totalNodes\",\"outputs\":[{\"name\":\"\",\"type\":\"uint256\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_url\",\"type\":\"string\"},{\"name\":\"_props\",\"type\":\"uint64\"},{\"name\":\"_timeout\",\"type\":\"uint64\"},{\"name\":\"_signer\",\"type\":\"address\"},{\"name\":\"_weight\",\"type\":\"uint64\"},{\"name\":\"_v\",\"type\":\"uint8\"},{\"name\":\"_r\",\"type\":\"bytes32\"},{\"name\":\"_s\",\"type\":\"bytes32\"}],\"name\":\"registerNodeFor\",\"outputs\":[],\"payable\":true,\"stateMutability\":\"payable\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_signer\",\"type\":\"address\"}],\"name\":\"returnDeposit\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[],\"name\":\"blockTimeStampDeployment\",\"outputs\":[{\"name\":\"\",\"type\":\"uint256\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_signer\",\"type\":\"address\"},{\"name\":\"_blockhash\",\"type\":\"bytes32\"},{\"name\":\"_blockNumber\",\"type\":\"uint256\"},{\"name\":\"_v\",\"type\":\"uint8\"},{\"name\":\"_r\",\"type\":\"bytes32\"},{\"name\":\"_s\",\"type\":\"bytes32\"}],\"name\":\"revealConvict\",\"outputs\":[],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[{\"name\":\"\",\"type\":\"bytes32\"}],\"name\":\"urlIndex\",\"outputs\":[{\"name\":\"used\",\"type\":\"bool\"},{\"name\":\"signer\",\"type\":\"address\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":false,\"inputs\":[{\"name\":\"_url\",\"type\":\"string\"},{\"name\":\"_props\",\"type\":\"uint64\"},{\"name\":\"_timeout\",\"type\":\"uint64\"},{\"name\":\"_weight\",\"type\":\"uint64\"}],\"name\":\"registerNode\",\"outputs\":[],\"payable\":true,\"stateMutability\":\"payable\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[],\"name\":\"blockRegistry\",\"outputs\":[{\"name\":\"\",\"type\":\"address\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"constant\":true,\"inputs\":[],\"name\":\"VERSION\",\"outputs\":[{\"name\":\"\",\"type\":\"uint256\"}],\"payable\":false,\"stateMutability\":\"view\",\"type\":\"function\"},{\"inputs\":[{\"name\":\"_blockRegistry\",\"type\":\"address\"}],\"payable\":false,\"stateMutability\":\"nonpayable\",\"type\":\"constructor\"},{\"anonymous\":false,\"inputs\":[{\"indexed\":false,\"name\":\"url\",\"type\":\"string\"},{\"indexed\":false,\"name\":\"props\",\"type\":\"uint256\"},{\"indexed\":false,\"name\":\"signer\",\"type\":\"address\"},{\"indexed\":false,\"name\":\"deposit\",\"type\":\"uint256\"}],\"name\":\"LogNodeRegistered\",\"type\":\"event\"},{\"anonymous\":false,\"inputs\":[{\"indexed\":false,\"name\":\"signer\",\"type\":\"address\"}],\"name\":\"LogNodeConvicted\",\"type\":\"event\"},{\"anonymous\":false,\"inputs\":[{\"indexed\":false,\"name\":\"url\",\"type\":\"string\"},{\"indexed\":false,\"name\":\"signer\",\"type\":\"address\"}],\"name\":\"LogNodeRemoved\",\"type\":\"event\"}]
```


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

