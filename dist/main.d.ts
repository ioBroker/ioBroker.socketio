import { Adapter, type AdapterOptions } from '@iobroker/adapter-core';
export declare class SocketIoAdapter extends Adapter {
    private wsConfig;
    private server;
    private readonly socketIoFile;
    private bruteForce;
    private store;
    private secret;
    private certificates;
    constructor(options?: Partial<AdapterOptions>);
    onUnload(callback: () => void): void;
    onMessage(obj: ioBroker.Message): void;
    initWebServer(): void;
    main(): Promise<void>;
}
