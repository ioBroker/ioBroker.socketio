// this file used by iobroker.web to start the socket
import socketio from 'socket.io';
import { type Server, SocketIO } from './socketIO';
import {
    SocketCommon,
    type SocketIoOptions,
    type SocketSettings,
    type SocketSubscribeTypes,
    type Store,
    type WhiteListSettings,
} from '@iobroker/socket-classes';
import type { SocketIO as WebSocketServer } from '@iobroker/ws-server';

class Socket {
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
    ) {
        this.ioServer = new SocketIO(settings, adapter);

        const socketOptions: SocketIoOptions = {
            pingInterval: 120000,
            pingTimeout: 30000,
        };

        if (settings.forceWebSockets) {
            // socket.io 4.0
            socketOptions.transports = ['websocket'];
        }
        if (settings.compatibilityV2 !== false) {
            // socket.io 4.0
            socketOptions.allowEIO3 = true;
        }
        socketOptions.maxHttpBufferSize = 200 * 1024 * 1024; // 200 MB
        // socket.io 4.0
        // do not use it, as it overwrites the cookie
        /*socketOptions.cookie = {
            name: 'connect.sid',
            httpOnly: true,
            path: '/'
        };*/

        this.ioServer.start(
            server,
            socketio as unknown as typeof WebSocketServer,
            { store, secret: settings.secret, checkUser },
            socketOptions,
        );
    }

    getWhiteListIpForAddress(
        remoteIp: string,
        whiteListSettings: {
            [address: string]: WhiteListSettings;
        },
    ): string | null {
        return SocketCommon.getWhiteListIpForAddress(remoteIp, whiteListSettings);
    }

    publishAll(type: SocketSubscribeTypes, id: string, obj: ioBroker.Object | ioBroker.State | null | undefined): void {
        return this.ioServer?.publishAll(type, id, obj);
    }

    publishFileAll(id: string, fileName: string, size: number | null): void {
        return this.ioServer?.publishFileAll(id, fileName, size);
    }

    publishInstanceMessageAll(sourceInstance: string, messageType: string, sid: string, data: any): void {
        return this.ioServer?.publishInstanceMessageAll(sourceInstance, messageType, sid, data);
    }

    sendLog(obj: ioBroker.LogMessage): void {
        this.ioServer?.sendLog(obj);
    }

    close(): void {
        if (this.ioServer) {
            this.ioServer.close();
            this.ioServer = null;
        }
    }
}

module.exports = Socket;
