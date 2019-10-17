#!/bin/sh
# define the chain
export IN3_CHAIN=local

# a key with some ether
IN3_PK=`in3 key my_keyfile.json`
BASE_URL=https://in3.slock.it/testnet/nd-

# define the private keys of the nodes :
PK1=0x...
PK2=0x...
PK3=0x...
PK4=0x...
PK5=0x...

# calculate the address out of the keys
NODE1=`in3 pk2address $PK1`
NODE2=`in3 pk2address $PK2`
NODE3=`in3 pk2address $PK3`
NODE4=`in3 pk2address $PK4`
NODE5=`in3 pk2address $PK5`

# get the code for the registry
CODE=0x`cat ../contracts/contracts.json | jq -r '.contracts."/contracts/ServerRegistry.sol:ServerRegistry".bin'`

# deploy the registry
REGISTRY=`in3 send -gas 5000000  -d $CODE -w  | jq -r .contractAddress`
echo "   new registry-address: $REGISTRY"
# sending some ether to pay for gas
in3 send -to $NODE1 -value 0.2eth -w >/dev/null
in3 send -to $NODE2 -value 0.2eth -w >/dev/null
in3 send -to $NODE3 -value 0.2eth -w >/dev/null
in3 send -to $NODE4 -value 0.2eth -w >/dev/null
in3 send -to $NODE5 -value 0.2eth -w >/dev/null


# now register the node
in3 -to $REGISTRY  -gas 1000000 -pk $PK1 send "registerServer(string,uint256)" "${BASE_URL}1" 0xFF >/dev/null
in3 -to $REGISTRY  -gas 1000000 -pk $PK2 send "registerServer(string,uint256)" "${BASE_URL}2" 0xFF >/dev/null
in3 -to $REGISTRY  -gas 1000000 -pk $PK3 send "registerServer(string,uint256)" "${BASE_URL}3" 0xFF >/dev/null
in3 -to $REGISTRY  -gas 1000000 -pk $PK4 send "registerServer(string,uint256)" "${BASE_URL}4" 0xFF >/dev/null
in3 -to $REGISTRY  -gas 1000000 -pk $PK5 send "registerServer(string,uint256)" "${BASE_URL}5" 0xFF >/dev/null

echo "done..."


