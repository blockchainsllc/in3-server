# INCUBED Server
 [![Forks](https://img.shields.io/github/forks/slockit/in3-server)](https://github.com/slockit/in3-server/network/members)
  [![Stars](https://img.shields.io/github/stars/slockit/in3-server)](https://github.com/slockit/in3-server/stargazers)
  [![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://github.com/slockit/in3-server/blob/master/LICENSE.AGPL)
 
 INCUBED (in3) is a minimal verification client for blockchain networks, this version of the in3 node is written
 in typescript. The in3-node provides the data and proof used by the client for verification.
 
 The in3-node mainly provides data from the Ethereum clients to the in3-clients. The in3-node can act as a regular RPC-provider,
  but in3-nodes also have the ability to provide [merkle-proofs](https://github.com/ethereum/wiki/wiki/JSON-RPC#eth_getproof) 
  with signed blockhashes in their responses. The merkle-proofs can be used by the clients to make sure that the 
  [response was correct](https://in3.readthedocs.io/en/develop/poa.html). The signed blockHeader in the response acts as 
  a extra layer of security, in case the in3-node was found to have provided a blockHeader that is not part of the chain,
  their deposit can be taken away.
  Using this technique an in3-client has an insurance that it will receive a valid response, allowing it to query
  nodes that it might not be affiliated with. 
    
  ![in3_image](in3_image.png)
  
  A more detailed explanation of in3 can be found [here](https://in3.readthedocs.io/en/develop/intro.html).
 
  For information on the in3 typescript client, please go [here](https://github.com/slockit/in3).

 For information on the in3 C client, please go [here](https://github.com/slockit/in3-c).
 
 
 ## Installation and Usage
 
 Please only run an in3-node if you have some experience with networking and private key management. It is not expected
 for regular users to run their own in3-node, you may always use public in3-nodes. A list of public nodes for use by 
 anyone can be found [here](https://in3.readthedocs.io/en/develop/getting_started.html#supported-chains).
 
 
 |         | package manager           | Link  | Use case |
 | ------------- |:-------------:| -----:| :----:|
 | in3-node (ts)      | Docker Hub | [![DockerHub](https://img.shields.io/badge/DockerHub-image-blue)](https://hub.docker.com/r/slockit/in3-node)| To run the in3-node, which the in3-client can use to connect to the in3 network |

 ### Docker Hub
1. Pull the image from docker using ```docker pull slockit/in3-node```
2. In order to run your own in3-node, you must first register the node. The information for registering a node can be found 
[here](https://in3.readthedocs.io/en/develop/getting_started.html#registering-an-incubed-node)
3. Run the in3-node image using a direct docker command or a docker-compose file, the parameters for which are explained 
[here](https://in3.readthedocs.io/en/develop/api-node-server.html)

 ## Example 
 ### POST Request
  
  Once the in3-node has been registered in the in3 network, and the in3-node port has been exposed, you can test the in3-node
  with the following POST request to the IP/URL configured to your in3-node:
  ```
{
  "id": 1, 
  "jsonrpc": "2.0",
  "method": "eth_getBlockByNumber", 
  "params": ["latest",true], 
	"in3": {
		"chainid": "0x5",
		"verification": "proof"
	}	
}
```
  This JSON rpc request should return the the latest block of the chain specified in "chainid". The POST request mentioned above 
  is configured for the Görli test chain. 
  
  ## Features
 
 |                            | in3-node  | Pruned Node | Full Node | 
 | -------------------------- | :----------------: | :----------------: |  :----------------: |
 | Failsafe connection        |         ✔️         |     ❌     |  ❌️ |
 | Multi-chain support        |         ✔️         |     ❌️    |  ❌ |
 | Full verification of JSON-RPC methods   |         ✔️         |  ❌  |    ✔️  |
 | Caching support            |         ✔️         |    ❌      |  ❌ |
 | Proof-Levels               |         ✔️         |    ❌      |  ❌ |
 | POA Support                |         ✔️         |    ✔️    |  ✔️   |
 | Database setup size-minutes|        0-instant️   |    ~Hours    |  ~Days️ |
 
 ## Resources 
 
 * [in3-Node API reference](https://in3.readthedocs.io/en/develop/api-node.html)
 * [Registering your node](https://in3.readthedocs.io/en/develop/api-node.html#registering-your-own-incubed-node)
 * [in3 typescript client](https://github.com/slockit/in3)
 * [in3 C client](https://github.com/slockit/in3-c)
 * [Website](https://slock.it/incubed/) 
 * [ReadTheDocs](https://in3.readthedocs.io/en/develop/)
 * [Blog](https://blog.slock.it/)
 * [Incubed concept video by Christoph Jentzsch](https://www.youtube.com/watch?v=_vodQubed2A)
 * [Ethereum verification explained by Simon Jentzsch](https://www.youtube.com/watch?v=wlUlypmt6Oo)
 
 ## Contributors welcome!

 We at Slock.it believe in the power of the open source community. Feel free to open any issues you may come across, fork
  the repository and integrate in your own projects. You can reach us on various social media platforms for any questions
  and suggestions.  
 
 [![Twitter](https://img.shields.io/badge/Twitter-Page-blue)](https://twitter.com/slockitproject?s=17)
 [![Blog](https://img.shields.io/badge/Blog-Medium-blue)](https://blog.slock.it/)
 [![Youtube](https://img.shields.io/badge/Youtube-channel-blue)](https://www.youtube.com/channel/UCPOrzp3CZmdb5HJWxSjv4Ig)
 [![LinkedIn](https://img.shields.io/badge/Linkedin-page-blue)](https://www.linkedin.com/company/10327305)
 [![Gitter](https://img.shields.io/badge/Gitter-chat-blue)](https://gitter.im/slockit-in3/community?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge)
 
 ## Got any questions?
 Send us an email at <a href="mailto:team-in3@slock.it">team-in3@slock.it</a>





                                                                                                                                                                                                                                                                                                                                                                                                                                                                 