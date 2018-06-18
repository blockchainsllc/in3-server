#INCUBED API

* [**RPC**](#type-rpc) : `class`  - the default rpc-handler

* **[config](https://github.com/slockit/in3-server/blob/master/src/index.ts#L12)** :[`IN3RPCConfig`](#type-in3rpcconfig) - the configuration

* **[s](https://github.com/slockit/in3-server/blob/master/src/index.ts#L9)** :[`Application`](#type-application) 


## Type RPC


Source: [server/rpc.ts](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L9)



* `constructor` **[constructor](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L11)**(conf :[`IN3RPCConfig`](#type-in3rpcconfig), transport :[`Transport`](#type-transport), nodeList :[`ServerList`](#type-serverlist)) :[`RPC`](#type-rpc) 

* **[conf](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L10)** :[`IN3RPCConfig`](#type-in3rpcconfig) 

* **[handlers](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L11)**

* **[getHandler](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L79)**(chainId :`string`) :[`RPCHandler`](#type-rpchandler) 

* **[handle](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L35)**(request :[`RPCRequest`](#type-rpcrequest)[]) :`Promise<>` 

* **[init](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L72)**() :`Promise<>` 


## Type RPCHandler


Source: [server/rpc.ts](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L87)



* **[chainId](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L88)** :`string` 

* **[config](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L95)** :[`IN3RPCHandlerConfig`](#type-in3rpchandlerconfig) 

* **[watcher](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L96)** :[`Watcher`](#type-watcher) *(optional)*  

* **[checkRegistry](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L94)**() :`Promise<any>` 

* **[getAllFromServer](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L91)**(request :[`Partial<RPCRequest>`](#type-partial)[]) :`Promise<>` 

* **[getFromServer](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L90)**(request :[`Partial<RPCRequest>`](#type-partial)) :[`Promise<RPCResponse>`](#type-rpcresponse) 

* **[getNodeList](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L92)**(includeProof :`boolean`, limit :`number`, seed :`string`, addresses :`string`[], signers :`string`[]) :[`Promise<ServerList>`](#type-serverlist) 

* **[handle](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L89)**(request :[`RPCRequest`](#type-rpcrequest)) :[`Promise<RPCResponse>`](#type-rpcresponse) 

* **[updateNodeList](https://github.com/slockit/in3-server/blob/master/src/server/rpc.ts#L93)**(blockNumber :`number`) :`Promise<void>` 


## Type Watcher


Source: [chains/watch.ts](https://github.com/slockit/in3-server/blob/master/src/chains/watch.ts#L16)



* **[defaultMaxListeners](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1012)** :`number` 

* `static` **[listenerCount](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1011)**(emitter :[`EventEmitter`](#type-eventemitter), event :`string`|`symbol`) :`number` 

* **[_interval](https://github.com/slockit/in3-server/blob/master/src/chains/watch.ts#L23)** :`any` 

* **[_lastBlock](https://github.com/slockit/in3-server/blob/master/src/chains/watch.ts#L18)**

    * **[hash](https://github.com/slockit/in3-server/blob/master/src/chains/watch.ts#L20)** :`string` 

    * **[number](https://github.com/slockit/in3-server/blob/master/src/chains/watch.ts#L19)** :`number` 

* `constructor` **[constructor](https://github.com/slockit/in3-server/blob/master/src/chains/watch.ts#L27)**(handler :[`RPCHandler`](#type-rpchandler), interval :`number` = 5, persistFile :`string` = "lastBlock.json", startBlock :`number`) :[`Watcher`](#type-watcher) 

* **[handler](https://github.com/slockit/in3-server/blob/master/src/chains/watch.ts#L24)** :[`RPCHandler`](#type-rpchandler) 

* **[interval](https://github.com/slockit/in3-server/blob/master/src/chains/watch.ts#L25)** :`number` 

* **[persistFile](https://github.com/slockit/in3-server/blob/master/src/chains/watch.ts#L26)** :`string` 

* **[running](https://github.com/slockit/in3-server/blob/master/src/chains/watch.ts#L27)** :`boolean` 

*  **block()** 

* **[addListener](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1014)**(event :`string`|`symbol`, listener :) :`this` 

* **[check](https://github.com/slockit/in3-server/blob/master/src/chains/watch.ts#L83)**() :`void` 

* **[emit](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1026)**(event :`string`|`symbol`, args :`any`[]) :`boolean` 

* **[eventNames](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1027)**() :[`Array<>`](#type-array) 

* **[getMaxListeners](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1023)**() :`number` 

* **[listenerCount](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1028)**(type :`string`|`symbol`) :`number` 

* **[listeners](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1024)**(event :`string`|`symbol`) :[`Function`](#type-function)[] 

* **[off](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1020)**(event :`string`|`symbol`, listener :) :`this` 

* **[on](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1015)**(event :`string`|`symbol`, listener :) :`this` 

* **[once](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1016)**(event :`string`|`symbol`, listener :) :`this` 

* **[prependListener](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1017)**(event :`string`|`symbol`, listener :) :`this` 

* **[prependOnceListener](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1018)**(event :`string`|`symbol`, listener :) :`this` 

* **[rawListeners](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1025)**(event :`string`|`symbol`) :[`Function`](#type-function)[] 

* **[removeAllListeners](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1021)**(event :`string`|`symbol`) :`this` 

* **[removeListener](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1019)**(event :`string`|`symbol`, listener :) :`this` 

* **[setMaxListeners](https://github.com/slockit/in3-server/blob/master/src//Users/simon/ws/slock/n3/in3-server/node_modules/@types/node/index.d.ts#L1022)**(n :`number`) :`this` 

* **[stop](https://github.com/slockit/in3-server/blob/master/src/chains/watch.ts#L72)**() :`void` 

* **[update](https://github.com/slockit/in3-server/blob/master/src/chains/watch.ts#L95)**() :`Promise<>` 

