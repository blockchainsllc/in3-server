#!/bin/bash

CHAINS=("ewc" "ipfs" "goerli" "mainnet" "btc")

echo "Deploying loadbalancer..."
helm upgrade --atomic -i in3-lb in3-lb

for i in "${CHAINS[@]}"
do
    echo "Deploying ${i}..."
    helm upgrade --atomic -i in3-server-${i} in3-server --values in3-server/values-${i}.yaml --values in3-server/values-keys.yaml
done


echo "done."
