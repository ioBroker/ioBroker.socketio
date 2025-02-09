"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// this file used by iobroker.web to start the socket
const socket_io_1 = __importDefault(require("socket.io"));
const socketIO_1 = require("./socketIO");
const socket_classes_1 = require("@iobroker/socket-classes");
class Socket {
    ioServer;
    constructor(server, settings, adapter, store) {
        this.ioServer = new socketIO_1.SocketIO(settings, adapter);
        const socketOptions = {
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
        this.ioServer.start(server, socket_io_1.default, { store, secret: settings.secret }, socketOptions);
    }
    getWhiteListIpForAddress(remoteIp, whiteListSettings) {
        return socket_classes_1.SocketCommon.getWhiteListIpForAddress(remoteIp, whiteListSettings);
    }
    publishAll(type, id, obj) {
        return this.ioServer?.publishAll(type, id, obj);
    }
    publishFileAll(id, fileName, size) {
        return this.ioServer?.publishFileAll(id, fileName, size);
    }
    publishInstanceMessageAll(sourceInstance, messageType, sid, data) {
        return this.ioServer?.publishInstanceMessageAll(sourceInstance, messageType, sid, data);
    }
    sendLog(obj) {
        this.ioServer?.sendLog(obj);
    }
    close() {
        if (this.ioServer) {
            this.ioServer.close();
            this.ioServer = null;
        }
    }
}
module.exports = Socket;
//# sourceMappingURL=socket.js.map