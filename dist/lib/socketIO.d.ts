import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { SocketCommon, type Store, type SocketSubscribeTypes, type SocketIoOptions } from '@iobroker/socket-classes';
import type { Socket as WebSocketClient, SocketIO as WebSocketServer } from '@iobroker/ws-server';
export type Server = HttpServer | HttpsServer;
export declare class SocketIO extends SocketCommon {
    private secret;
    __getIsNoDisconnect(): boolean;
    __initAuthentication(authOptions: {
        store: Store;
        secret: string;
        checkUser?: (user: string, pass: string, cb: (error: Error | null, result?: {
            logged_in: boolean;
            user?: string;
        }) => void) => void;
    }): void;
    __getUserFromSocket(socket: WebSocketClient, callback: (error: string | null, user?: string, expirationTime?: number) => void): void;
    __getClientAddress(socket: WebSocketClient): AddressInfo;
    __updateSession(socket: WebSocketClient): boolean;
    __getSessionID(socket: WebSocketClient): string | null;
    start(server: Server, socketClass: typeof WebSocketServer, authOptions: {
        store: Store;
        secret: string;
        checkUser?: (user: string, pass: string, cb: (error: Error | null, result?: {
            logged_in: boolean;
            user?: string;
        }) => void) => void;
    }, socketOptions?: SocketIoOptions): void;
    publishAll(type: SocketSubscribeTypes, id: string, obj: ioBroker.Object | ioBroker.State | null | undefined): void;
    publishFileAll(id: string, fileName: string, size: number | null): void;
    publishInstanceMessageAll(sourceInstance: string, messageType: string, sid: string, data: any): void;
}
