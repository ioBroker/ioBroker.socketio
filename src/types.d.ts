import type { SocketIO } from './lib/socketIO';
import type { Socket as IOSocketClass } from './lib/socket';

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

export type { SocketIO };
export type { IOSocketClass };
