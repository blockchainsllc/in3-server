# Incubed Server

Typescript-version of the incubed server.
This server provides data and proof used to verify data.


# Registering a in3-node

If you want to participate in this network and also register a node, you need to send a transaction to the registry-contract calling `registerServer(string _url, uint _props)`.

ABI of the registry:

```js
[{"constant":true,"inputs":[],"name":"totalServers","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_serverIndex","type":"uint256"},{"name":"_props","type":"uint256"}],"name":"updateServer","outputs":[],"payable":true,"stateMutability":"payable","type":"function"},{"constant":false,"inputs":[{"name":"_url","type":"string"},{"name":"_props","type":"uint256"}],"name":"registerServer","outputs":[],"payable":true,"stateMutability":"payable","type":"function"},{"constant":true,"inputs":[{"name":"","type":"uint256"}],"name":"servers","outputs":[{"name":"url","type":"string"},{"name":"owner","type":"address"},{"name":"deposit","type":"uint256"},{"name":"props","type":"uint256"},{"name":"unregisterTime","type":"uint128"},{"name":"unregisterDeposit","type":"uint128"},{"name":"unregisterCaller","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_serverIndex","type":"uint256"}],"name":"cancelUnregisteringServer","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"_serverIndex","type":"uint256"},{"name":"_blockhash","type":"bytes32"},{"name":"_blocknumber","type":"uint256"},{"name":"_v","type":"uint8"},{"name":"_r","type":"bytes32"},{"name":"_s","type":"bytes32"}],"name":"convict","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"name":"_serverIndex","type":"uint256"}],"name":"calcUnregisterDeposit","outputs":[{"name":"","type":"uint128"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_serverIndex","type":"uint256"}],"name":"confirmUnregisteringServer","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"_serverIndex","type":"uint256"}],"name":"requestUnregisteringServer","outputs":[],"payable":true,"stateMutability":"payable","type":"function"},{"anonymous":false,"inputs":[{"indexed":false,"name":"url","type":"string"},{"indexed":false,"name":"props","type":"uint256"},{"indexed":false,"name":"owner","type":"address"},{"indexed":false,"name":"deposit","type":"uint256"}],"name":"LogServerRegistered","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"url","type":"string"},{"indexed":false,"name":"owner","type":"address"},{"indexed":false,"name":"caller","type":"address"}],"name":"LogServerUnregisterRequested","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"url","type":"string"},{"indexed":false,"name":"owner","type":"address"}],"name":"LogServerUnregisterCanceled","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"url","type":"string"},{"indexed":false,"name":"owner","type":"address"}],"name":"LogServerConvicted","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"url","type":"string"},{"indexed":false,"name":"owner","type":"address"}],"name":"LogServerRemoved","type":"event"}]
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

