#INCUBED API

* [**RPC**](#type-rpc) : `class`  - the default rpc-handler

* **[config](https://github.com/slockit/usn-lib/blob/develop/index.ts#L11)** :`any` - the configuration

* **[s](https://github.com/slockit/usn-lib/blob/develop/index.ts#L8)** :[`Application`](#type-application) 


## Type RPC


Source: [server/rpc.ts](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L9)



* `constructor` **[constructor](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L11)**(conf :[`IN3RPCConfig`](#type-in3rpcconfig), transport :[`Transport`](#type-transport), nodeList :[`ServerList`](#type-serverlist)) :[`RPC`](#type-rpc) 

* **[conf](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L10)** :[`IN3RPCConfig`](#type-in3rpcconfig) 

* **[handlers](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L11)**

* **[getHandler](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L80)**(chainId :`string`) :[`RPCHandler`](#type-rpchandler) 

* **[handle](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L35)**(request :[`RPCRequest`](#type-rpcrequest)[]) :`Promise<>` 

* **[init](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L72)**() :`Promise<>` 


## Type RPCHandler


Source: [server/rpc.ts](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L88)



* **[chainId](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L89)** :`string` 

* **[config](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L98)** :[`IN3RPCHandlerConfig`](#type-in3rpchandlerconfig) 

* **[watcher](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L99)** :[`Watcher`](#type-watcher) *(optional)*  

* **[checkPrivateKey](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L97)**() :`Promise<any>` 

* **[checkRegistry](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L96)**() :`Promise<any>` 

* **[getAllFromServer](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L93)**(request :[`Partial<RPCRequest>`](#type-partial)[]) :`Promise<>` 

* **[getFromServer](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L92)**(request :[`Partial<RPCRequest>`](#type-partial)) :[`Promise<RPCResponse>`](#type-rpcresponse) 

* **[getNodeList](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L94)**(includeProof :`boolean`, limit :`number`, seed :`string`, addresses :`string`[], signers :`string`[]) :[`Promise<ServerList>`](#type-serverlist) 

* **[handle](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L90)**(request :[`RPCRequest`](#type-rpcrequest)) :[`Promise<RPCResponse>`](#type-rpcresponse) 

* **[sign](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L91)**(blocks :[]) :[`Signature`](#type-signature)[] 

* **[updateNodeList](https://github.com/slockit/usn-lib/blob/develop/server/rpc.ts#L95)**(blockNumber :`number`) :`Promise<void>` 


## Type Watcher


Source: [chains/watch.ts](https://github.com/slockit/usn-lib/blob/develop/chains/watch.ts#L15)



* **[defaultMaxListeners](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1012)** :`number` 

* `static` **[listenerCount](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1011)**(emitter :[`EventEmitter`](#type-eventemitter), event :`string`|`symbol`) :`number` 

* **[_interval](https://github.com/slockit/usn-lib/blob/develop/chains/watch.ts#L22)** :`any` 

* **[_lastBlock](https://github.com/slockit/usn-lib/blob/develop/chains/watch.ts#L17)**

    * **[hash](https://github.com/slockit/usn-lib/blob/develop/chains/watch.ts#L19)** :`string` 

    * **[number](https://github.com/slockit/usn-lib/blob/develop/chains/watch.ts#L18)** :`number` 

* `constructor` **[constructor](https://github.com/slockit/usn-lib/blob/develop/chains/watch.ts#L26)**(handler :[`RPCHandler`](#type-rpchandler), interval :`number` = 5, persistFile :`string` = "lastBlock.json", startBlock :`number`) :[`Watcher`](#type-watcher) 

* **[handler](https://github.com/slockit/usn-lib/blob/develop/chains/watch.ts#L23)** :[`RPCHandler`](#type-rpchandler) 

* **[interval](https://github.com/slockit/usn-lib/blob/develop/chains/watch.ts#L24)** :`number` 

* **[persistFile](https://github.com/slockit/usn-lib/blob/develop/chains/watch.ts#L25)** :`string` 

* **[running](https://github.com/slockit/usn-lib/blob/develop/chains/watch.ts#L26)** :`boolean` 

*  **block()** 

* **[addListener](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1014)**(event :`string`|`symbol`, listener :) :`this` 

* **[check](https://github.com/slockit/usn-lib/blob/develop/chains/watch.ts#L76)**() :`void` 

* **[emit](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1026)**(event :`string`|`symbol`, args :`any`[]) :`boolean` 

* **[eventNames](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1027)**() :[`Array<>`](#type-array) 

* **[getMaxListeners](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1023)**() :`number` 

* **[listenerCount](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1028)**(type :`string`|`symbol`) :`number` 

* **[listeners](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1024)**(event :`string`|`symbol`) :[`Function`](#type-function)[] 

* **[off](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1020)**(event :`string`|`symbol`, listener :) :`this` 

* **[on](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1015)**(event :`string`|`symbol`, listener :) :`this` 

* **[once](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1016)**(event :`string`|`symbol`, listener :) :`this` 

* **[prependListener](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1017)**(event :`string`|`symbol`, listener :) :`this` 

* **[prependOnceListener](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1018)**(event :`string`|`symbol`, listener :) :`this` 

* **[rawListeners](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1025)**(event :`string`|`symbol`) :[`Function`](#type-function)[] 

* **[removeAllListeners](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1021)**(event :`string`|`symbol`) :`this` 

* **[removeListener](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1019)**(event :`string`|`symbol`, listener :) :`this` 

* **[setMaxListeners](https://github.com/slockit/usn-lib/blob/develop//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1022)**(n :`number`) :`this` 

* **[stop](https://github.com/slockit/usn-lib/blob/develop/chains/watch.ts#L65)**() :`void` 

* **[update](https://github.com/slockit/usn-lib/blob/develop/chains/watch.ts#L88)**() :`Promise<>` 

