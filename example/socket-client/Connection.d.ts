import type { ConnectionProps, LogMessage } from './ConnectionProps.js';
import type { EmitEventHandler, ListenEventHandler, SocketClient } from './SocketClient.js';
/** Possible progress states. */
export declare enum PROGRESS {
    /** The socket is connecting. */
    CONNECTING = 0,
    /** The socket is successfully connected. */
    CONNECTED = 1,
    /** All objects are loaded. */
    OBJECTS_LOADED = 2,
    /** The socket is ready for use. */
    READY = 3
}
export declare enum ERRORS {
    PERMISSION_ERROR = "permissionError",
    NOT_CONNECTED = "notConnectedError",
    TIMEOUT = "timeout",
    NOT_ADMIN = "Allowed only in admin",
    NOT_SUPPORTED = "Not supported"
}
/** @deprecated Use {@link ERRORS.PERMISSION_ERROR} instead */
export declare const PERMISSION_ERROR = ERRORS.PERMISSION_ERROR;
/** @deprecated Use {@link ERRORS.NOT_CONNECTED} instead */
export declare const NOT_CONNECTED = ERRORS.NOT_CONNECTED;
/**
 * @internal
 */
export interface RequestOptions<T> {
    /** The key that is used to cache the results for later requests of the same kind */
    cacheKey?: string;
    /** Used to bypass the cache */
    forceUpdate?: boolean;
    /** Can be used to identify the request method in error messages */
    requestName?: string;
    /**
     * The timeout in milliseconds after which the call will reject with a timeout error.
     * If no timeout is given, the default is used. Set this to `false` to explicitly disable the timeout.
     */
    commandTimeout?: number | false;
    /** Will be called when the timeout elapses */
    onTimeout?: () => void;
    /** Whether the call should only be allowed in the admin adapter */
    requireAdmin?: boolean;
    /** Require certain features to be supported for this call */
    requireFeatures?: string[];
    /** The function that does the actual work */
    executor: (resolve: (value: T | PromiseLike<T> | Promise<T>) => void, reject: (reason?: any) => void, 
    /** Can be used to check in the executor whether the request has timed out and/or stop it from timing out */
    timeout: Readonly<{
        elapsed: boolean;
        clearTimeout: () => void;
    }>) => void | Promise<void>;
}
export type BinaryStateChangeHandler = (id: string, base64: string | null) => void;
export type FileChangeHandler = (id: string, fileName: string, size: number | null) => void;
export interface OldObject {
    _id: string;
    type: string;
}
export type ObjectChangeHandler = (id: string, obj: ioBroker.Object | null | undefined, oldObj?: OldObject) => void | Promise<void>;
export type InstanceMessageCallback = (data: any, sourceInstance: string, messageType: string) => void | Promise<void>;
export type InstanceSubscribe = {
    messageType: string;
    callback: InstanceMessageCallback;
};
export declare class Connection<CustomListenEvents extends Record<keyof CustomListenEvents, ListenEventHandler> = Record<string, never>, CustomEmitEvents extends Record<keyof CustomEmitEvents, EmitEventHandler> = Record<string, never>> {
    constructor(props: Partial<ConnectionProps>);
    private applyDefaultProps;
    private readonly props;
    private ignoreState;
    private connected;
    private subscribed;
    private firstConnect;
    waitForRestart: boolean;
    loaded: boolean;
    private simStates;
    private readonly statesSubscribes;
    private readonly filesSubscribes;
    private readonly objectsSubscribes;
    private objects;
    private states;
    acl: any;
    isSecure: boolean;
    onReadyDone: boolean;
    private readonly onConnectionHandlers;
    private readonly onLogHandlers;
    private onCmdStdoutHandler?;
    private onCmdStderrHandler?;
    private onCmdExitHandler?;
    private onError;
    /** The socket instance */
    protected _socket: SocketClient<CustomListenEvents, CustomEmitEvents>;
    private _waitForSocketPromise?;
    private readonly _waitForFirstConnectionPromise;
    /** array with all subscriptions to instances */
    private _instanceSubscriptions;
    /** Cache for server requests */
    private readonly _promises;
    protected _authTimer: any;
    protected _systemConfig?: ioBroker.SystemConfigObject;
    /** The "system.config" object */
    get systemConfig(): Readonly<ioBroker.SystemConfigObject> | undefined;
    /** System language. It could be changed during runtime */
    systemLang: ioBroker.Languages;
    /**
     * Checks if this connection is running in a web adapter and not in an admin.
     *
     * @returns True if running in a web adapter or in a socketio adapter.
     */
    static isWeb(): boolean;
    private waitForSocketLib;
    /**
     * Starts the socket.io connection.
     */
    startSocket(): Promise<void>;
    /**
     * Called internally.
     */
    private onPreConnect;
    /**
     * Checks if running in ioBroker cloud
     */
    static isCloud(): boolean;
    /**
     * Checks if the socket is connected.
     *
     * @returns true if connected.
     */
    isConnected(): boolean;
    /**
     * Returns a promise which is resolved when the socket is connected.
     */
    waitForFirstConnection(): Promise<void>;
    /**
     * Called internally.
     */
    private getUserPermissions;
    /** Loads the important data and retries a couple of times if it takes too long */
    private loadData;
    /**
     * Called after the socket is connected. Loads the necessary data.
     */
    private doLoadData;
    /**
     * Called internally.
     */
    private authenticate;
    /**
     * Subscribe to the changes of the given state.
     * In compare to the subscribeObject method,
     * this method calls the handler with the current state value immediately after subscribing.
     *
     * @param id The ioBroker state ID or array of state IDs.
     * @param binary Set to true if the given state is binary and requires Base64 decoding.
     * @param cb The callback.
     */
    subscribeState(id: string | string[], binary: true, cb: BinaryStateChangeHandler): Promise<void>;
    subscribeState(id: string | string[], binary: false, cb: ioBroker.StateChangeHandler): Promise<void>;
    subscribeState(id: string | string[], cb: ioBroker.StateChangeHandler): Promise<void>;
    /**
     * Subscribe to the changes of the given state and wait for answer.
     *
     * @param id The ioBroker state ID.
     * @param cb The callback.
     */
    subscribeStateAsync(id: string | string[], cb: ioBroker.StateChangeHandler): Promise<void>;
    /**
     * Unsubscribes the given callback from changes of the given state.
     *
     * @param id The ioBroker state ID or array of state IDs.
     * @param cb The callback.
     */
    unsubscribeState(id: string | string[], cb?: ioBroker.StateChangeHandler): void;
    /**
     * Subscribe to changes of the given object.
     * In compare to the subscribeState method,
     * this method does not call the handler with the current value immediately after subscribe.
     *
     * the current value.
     *
     * @param id The ioBroker object ID.
     * @param cb The callback.
     */
    subscribeObject(id: string | string[], cb: ObjectChangeHandler): Promise<void>;
    /**
     * Unsubscribes all callbacks from changes of the given object.
     *
     * @param id The ioBroker object ID.
     */
    /**
     * Unsubscribes the given callback from changes of the given object.
     *
     * @param id The ioBroker object ID.
     * @param cb The callback.
     */
    unsubscribeObject(id: string | string[], cb?: ObjectChangeHandler): Promise<void>;
    /**
     * Called internally.
     *
     * @param id The ioBroker object ID.
     * @param obj The new object.
     */
    private objectChange;
    /**
     * Called internally.
     *
     * @param id The ioBroker state ID.
     * @param state The new state value.
     */
    private stateChange;
    /**
     * Called internally.
     *
     * @param messageType The message type from the instance
     * @param sourceInstance The source instance
     * @param data The message data
     */
    private instanceMessage;
    /**
     * Called internally.
     *
     * @param id The ioBroker object ID of type 'meta'.
     * @param fileName - file name
     * @param size - size of the file
     */
    private fileChange;
    /**
     * Subscribe to changes of the files.
     *
     * @param id The ioBroker state ID for a "meta" object. Could be a pattern
     * @param filePattern Pattern or file name, like 'main/*' or 'main/visViews.json`
     * @param cb The callback.
     */
    subscribeFiles(id: string, filePattern: string | string[], cb: FileChangeHandler): Promise<void>;
    /**
     * Unsubscribes the given callback from changes of files.
     *
     * @param id The ioBroker state ID.
     * @param filePattern Pattern or file name, like 'main/*' or 'main/visViews.json`
     * @param cb The callback.
     */
    unsubscribeFiles(id: string, filePattern: string | string[], cb?: FileChangeHandler): void;
    /** Requests data from the server or reads it from the cache */
    protected request<T>({ cacheKey, forceUpdate, commandTimeout, onTimeout, requireAdmin, requireFeatures, executor, }: RequestOptions<T>): Promise<T>;
    /**
     * Deletes cached promise.
     * So next time the information will be requested anew
     */
    resetCache(key: string, isAll?: boolean): void;
    /**
     * Gets all states.
     *
     * @param pattern Pattern of states or array of IDs
     */
    getStates(pattern?: string | string[]): Promise<Record<string, ioBroker.State>>;
    /**
     * Gets the given state.
     *
     * @param id The state ID.
     */
    getState(id: string): Promise<ioBroker.State | null | undefined>;
    /**
     * Gets the given binary state Base64 encoded.
     *
     * @deprecated since js-controller 5.0. Use files instead.
     * @param id The state ID.
     */
    getBinaryState(id: string): Promise<string | undefined>;
    /**
     * Sets the given binary state.
     *
     * @deprecated since js-controller 5.0. Use files instead.
     * @param id The state ID.
     * @param base64 The Base64 encoded binary data.
     */
    setBinaryState(id: string, base64: string): Promise<void>;
    /**
     * Sets the given state value.
     *
     * @param id The state ID.
     * @param val The state value.
     * @param ack Acknowledgement flag.
     */
    setState(id: string, val: ioBroker.State | ioBroker.StateValue | ioBroker.SettableState, ack?: boolean): Promise<void>;
    /**
     * Gets all objects.
     *
     * @param update Callback that is executed when all objects are retrieved.
     */
    /**
     * Gets all objects.
     *
     * @param update Set to true to retrieve all objects from the server (instead of using the local cache).
     * @param disableProgressUpdate don't call onProgress() when done
     */
    getObjects(update?: boolean, disableProgressUpdate?: boolean): Promise<Record<string, ioBroker.Object>>;
    /**
     * Gets the list of objects by ID.
     *
     * @param list array of IDs to retrieve
     */
    getObjectsById(list: string[]): Promise<Record<string, ioBroker.Object> | undefined>;
    /**
     * Called internally.
     *
     * @param isEnable Set to true if subscribing, false to unsubscribe.
     */
    private _subscribe;
    /**
     * Requests log updates.
     *
     * @param isEnabled Set to true to get logs.
     */
    requireLog(isEnabled: boolean): Promise<void>;
    /**
     * Deletes the given object.
     *
     * @param id The object ID.
     * @param maintenance Force deletion of non conform IDs.
     */
    delObject(id: string, maintenance?: boolean): Promise<void>;
    /**
     * Deletes the given object and all its children.
     *
     * @param id The object ID.
     * @param maintenance Force deletion of non conform IDs.
     */
    delObjects(id: string, maintenance: boolean): Promise<void>;
    /**
     * Sets the object.
     *
     * @param id The object ID.
     * @param obj The object.
     */
    setObject(id: string, obj: ioBroker.SettableObject): Promise<void>;
    /**
     * Gets the object with the given id from the server.
     *
     * @param id The object ID.
     * @returns The object.
     */
    getObject<T extends string>(id: T): ioBroker.GetObjectPromise<T>;
    /**
     * Sends a message to a specific instance or all instances of some specific adapter.
     *
     * @param instance The instance to send this message to.
     * @param command Command name of the target instance.
     * @param data The message data to send.
     */
    sendTo<T = any>(instance: string, command: string, data?: any): Promise<T>;
    /**
     * Extend an object and create it if it might not exist.
     *
     * @param id The id.
     * @param obj The object.
     */
    extendObject(id: string, obj: ioBroker.PartialObject): Promise<void>;
    /**
     * Register a handler for log messages.
     *
     * @param handler The handler.
     */
    registerLogHandler(handler: (message: LogMessage) => void): void;
    /**
     * Unregister a handler for log messages.
     *
     * @param handler The handler.
     */
    unregisterLogHandler(handler: (message: LogMessage) => void): void;
    /**
     * Register a handler for the connection state.
     *
     * @param handler The handler.
     */
    registerConnectionHandler(handler: (connected: boolean) => void): void;
    /**
     * Unregister a handler for the connection state.
     *
     * @param handler The handler.
     */
    unregisterConnectionHandler(handler: (connected: boolean) => void): void;
    /**
     * Set the handler for standard output of a command.
     *
     * @param handler The handler.
     */
    registerCmdStdoutHandler(handler: (id: string, text: string) => void): void;
    /**
     * Unset the handler for standard output of a command.
     */
    unregisterCmdStdoutHandler(): void;
    /**
     * Set the handler for standard error of a command.
     *
     * @param handler The handler.
     */
    registerCmdStderrHandler(handler: (id: string, text: string) => void): void;
    /**
     * Unset the handler for standard error of a command.
     */
    unregisterCmdStderrHandler(): void;
    /**
     * Set the handler for exit of a command.
     *
     * @param handler The handler.
     */
    registerCmdExitHandler(handler: (id: string, exitCode: number) => void): void;
    /**
     * Unset the handler for exit of a command.
     */
    unregisterCmdExitHandler(): void;
    /**
     * Get all enums with the given name.
     *
     * @param _enum The name of the enum, like `rooms` or `functions`
     * @param update Force update.
     */
    getEnums(_enum?: string, update?: boolean): Promise<Record<string, ioBroker.EnumObject>>;
    /**
     * @deprecated since version 1.1.15, cause parameter order does not match backend
     * Query a predefined object view.
     * @param start The start ID.
     * @param end The end ID.
     * @param type The type of object.
     */
    getObjectView<T extends ioBroker.ObjectType>(start: string | undefined, end: string | undefined, type: T): Promise<Record<string, ioBroker.AnyObject & {
        type: T;
    }>>;
    /**
     * Query a predefined object view.
     *
     * @param type The type of object.
     * @param start The start ID.
     * @param [end] The end ID.
     */
    getObjectViewSystem<T extends ioBroker.ObjectType>(type: T, start?: string, end?: string): Promise<Record<string, ioBroker.AnyObject & {
        type: T;
    }>>;
    /**
     * Query a predefined object view.
     *
     * @param design design - 'system' or other designs like `custom`.
     * @param type The type of object.
     * @param start The start ID.
     * @param [end] The end ID.
     */
    getObjectViewCustom<T extends ioBroker.ObjectType>(design: string, type: T, start?: string, end?: string): Promise<Record<string, ioBroker.AnyObject & {
        type: T;
    }>>;
    /**
     * Read the meta items.
     */
    readMetaItems(): Promise<ioBroker.Object[]>;
    /**
     * Read the directory of an adapter.
     *
     * @param namespace (this may be the adapter name, the instance name or the name of a storage object within the adapter).
     * @param path The directory name.
     */
    readDir(namespace: string | null, path: string): Promise<ioBroker.ReadDirResult[]>;
    /**
     * Read a file of an adapter.
     *
     * @param namespace (this may be the adapter name, the instance name or the name of a storage object within the adapter).
     * @param fileName The file name.
     * @param base64 If it must be a base64 format
     */
    readFile(namespace: string | null, fileName: string, base64?: boolean): Promise<{
        file: string;
        mimeType: string;
    }>;
    /**
     * Write a file of an adapter.
     *
     * @param namespace (this may be the adapter name, the instance name or the name of a storage object within the adapter).
     * @param fileName The file name.
     * @param data The data (if it's a Buffer, it will be converted to Base64).
     */
    writeFile64(namespace: string, fileName: string, data: ArrayBuffer | string): Promise<void>;
    /**
     * Delete a file of an adapter.
     *
     * @param namespace (this may be the adapter name, the instance name or the name of a storage object within the adapter).
     * @param fileName The file name.
     */
    deleteFile(namespace: string, fileName: string): Promise<void>;
    /**
     * Delete a folder of an adapter.
     *
     * @param namespace (this may be the adapter name, the instance name or the name of a storage object within the adapter).
     * @param folderName The folder name.
     */
    deleteFolder(namespace: string, folderName: string): Promise<void>;
    /**
     * Rename file or folder in ioBroker DB
     *
     * @param namespace (this may be the adapter name, the instance name or the name of a storage object within the adapter).
     * @param oldName current file name, e.g., main/vis-views.json
     * @param newName new file name, e.g., main/vis-views-new.json
     */
    rename(namespace: string, oldName: string, newName: string): Promise<void>;
    /**
     * Rename file in ioBroker DB
     *
     * @param namespace (this may be the adapter name, the instance name or the name of a storage object within the adapter).
     * @param oldName current file name, e.g., main/vis-views.json
     * @param newName new file name, e.g., main/vis-views-new.json
     */
    renameFile(namespace: string, oldName: string, newName: string): Promise<void>;
    /**
     * Execute a command on a host.
     */
    cmdExec(
    /** Host name */
    host: string, 
    /** Command to execute */
    cmd: string, 
    /** Command ID */
    cmdId: number, 
    /** Timeout of command in ms */
    cmdTimeout?: number): Promise<void>;
    /**
     * Gets the system configuration.
     *
     * @param update Force update.
     */
    getSystemConfig(update?: boolean): Promise<ioBroker.SystemConfigObject>;
    getCompactSystemConfig(update?: boolean): Promise<ioBroker.SystemConfigObject>;
    /**
     * Read all states (which might not belong to this adapter) which match the given pattern.
     *
     * @param pattern The pattern to match.
     */
    getForeignStates(pattern?: string | string[] | null): ioBroker.GetStatesPromise;
    /**
     * Get foreign objects by pattern, by specific type and resolve their enums.
     *
     * @param pattern The pattern to match.
     * @param type The type of the object.
     */
    getForeignObjects<T extends ioBroker.ObjectType>(pattern: string | null | undefined, type: T): Promise<Record<string, ioBroker.AnyObject & {
        type: T;
    }>>;
    /**
     * Sets the system configuration.
     *
     * @param obj The new system configuration.
     */
    setSystemConfig(obj: ioBroker.SystemConfigObject): Promise<void>;
    /**
     * Get the raw socket.io socket.
     */
    getRawSocket(): any;
    /**
     * Get the history of a given state.
     *
     * @param id The state ID.
     * @param options The query options.
     */
    getHistory(id: string, options: ioBroker.GetHistoryOptions): Promise<ioBroker.GetHistoryResult>;
    /**
     * Get the history of a given state.
     *
     * @param id The state ID.
     * @param options The query options.
     */
    getHistoryEx(id: string, options: ioBroker.GetHistoryOptions): Promise<{
        values: ioBroker.GetHistoryResult;
        sessionId: number;
        step: number;
    }>;
    /**
     * Get the IP addresses of the given host.
     *
     * @param host The host name.
     * @param update Force update.
     */
    getIpAddresses(host: string, update?: boolean): Promise<string[]>;
    /**
     * Gets the version.
     */
    getVersion(update?: boolean): Promise<{
        version: string;
        serverName: string;
    }>;
    /**
     * Gets the web server name.
     */
    getWebServerName(): Promise<string>;
    /**
     * Check if the file exists
     *
     * @param adapter adapter name
     * @param filename file name with the full path. it could be like vis.0/*
     */
    fileExists(adapter: string, filename: string): Promise<boolean>;
    /**
     * Read current user
     */
    getCurrentUser(): Promise<string>;
    /**
     * Get uuid
     */
    getUuid(): Promise<string>;
    /**
     * Checks if a given feature is supported.
     *
     * @param feature The feature to check.
     * @param update Force update.
     */
    checkFeatureSupported(feature: string, update?: boolean): Promise<any>;
    /**
     * Get all adapter instances.
     *
     * @param update Force update.
     */
    /**
     * Get all instances of the given adapter.
     *
     * @param adapter The name of the adapter.
     * @param update Force update.
     */
    getAdapterInstances(adapter?: string | boolean, update?: boolean): Promise<ioBroker.InstanceObject[]>;
    /**
     * Get adapters with the given name.
     *
     * @param adapter The name of the adapter.
     * @param update Force update.
     */
    getAdapters(adapter?: string, update?: boolean): Promise<ioBroker.AdapterObject[]>;
    /**
     * Get the list of all groups.
     *
     * @param update Force update.
     */
    getGroups(update?: boolean): Promise<ioBroker.GroupObject[]>;
    /**
     * Logout current user
     */
    logout(): Promise<string | null>;
    /**
     * Subscribe on instance message
     *
     * @param targetInstance instance, like 'cameras.0'
     * @param messageType message type like 'startCamera/cam3'
     * @param data optional data object
     * @param callback message handler
     */
    subscribeOnInstance(targetInstance: string, messageType: string, data: any, callback: InstanceMessageCallback): Promise<{
        error?: string;
        accepted?: boolean;
        heartbeat?: number;
    } | null>;
    /**
     * Unsubscribe from instance message
     *
     * @param targetInstance instance, like 'cameras.0'
     * @param messageType message type like 'startCamera/cam3'
     * @param callback message handler
     */
    unsubscribeFromInstance(targetInstance: string, messageType: string, callback: InstanceMessageCallback): Promise<boolean>;
    /**
     * Send log to ioBroker log
     *
     * @param text Log text
     * @param level `info`, `debug`, `warn`, `error` or `silly`
     */
    log(text: string, level?: string): Promise<null>;
    /**
     * This is a special method for vis.
     * It is used to not send to server the changes about "nothing_selected" state
     *
     * @param id The state that has to be ignored by communication
     */
    setStateToIgnore(id: string): void;
}
