import { type NextFunction, type Request, type Response } from 'express';
import { Adapter, type AdapterOptions } from '@iobroker/adapter-core';
import type { SocketIoAdapterConfig } from './types';
export declare class SocketIoAdapter extends Adapter {
    config: SocketIoAdapterConfig;
    private server;
    private readonly socketIoFile;
    private store;
    private secret;
    private certificates;
    constructor(options?: Partial<AdapterOptions>);
    onUnload(callback: () => void): void;
    onMessage(obj: ioBroker.Message): void;
    detectUser: (req: Request, res: Response, next: NextFunction) => void;
    serveStaticFile: (req: Request, res: Response, next: NextFunction) => void;
    initWebServer(): void;
    main(): Promise<void>;
}
