import type { SocketIO } from './lib/socketIO';

export interface SocketIoAdapterConfig {
    port: number | string;
    auth: boolean;
    secure: boolean;
    bind: string;
    ttl: number | string;
    certPublic: string;
    certPrivate: string;
    certChained: string;
    defaultUser: string;
    leEnabled: boolean;
    leUpdate: boolean;
    language: ioBroker.Languages;
    leCheckPort: number | string;
    forceWebSockets: boolean;
    compatibilityV2: boolean;
}

export declare class IOSocketClass {
    public ioServer: SocketIO | null;

    constructor(
        server: Server,
        settings: SocketSettings,
        adapter: ioBroker.Adapter,
        store: Store,
        checkUser?: (
            user: string,
            pass: string,
            cb: (
                error: Error | null,
                result?: {
                    logged_in: boolean;
                },
            ) => void,
        ) => void,
    );

    getWhiteListIpForAddress(
        remoteIp: string,
        whiteListSettings: {
            [address: string]: WhiteListSettings;
        },
    ): string | null;
    publishAll(type: SocketSubscribeTypes, id: string, obj: ioBroker.Object | ioBroker.State | null | undefined): void;
    publishFileAll(id: string, fileName: string, size: number | null): void;
    publishInstanceMessageAll(sourceInstance: string, messageType: string, sid: string, data: any): void;
    sendLog(obj: ioBroker.LogMessage): void;
    close(): void;
}
