// this file used by iobroker.web to start the socket
const socketio     = require('socket.io');
const SocketIO     = require('./socketIO');
const SocketCommon = require('@iobroker/socket-classes').SocketCommon;

class Socket {
    constructor(server, settings, adapter, ignore, store) {
        this.ioServer = new SocketIO(settings, adapter);

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
        // socket.io 4.0
        // do not use it, as it overwrites the cookie
        /*socketOptions.cookie = {
            name: 'connect.sid',
            httpOnly: true,
            path: '/'
        };*/

        this.ioServer.start(server, socketio, {store, secret: settings.secret}, socketOptions);
    }

    getWhiteListIpForAddress(remoteIp, whiteListSettings) {
        return SocketCommon.getWhiteListIpForAddress(remoteIp, whiteListSettings);
    }

    publishAll(type, id, obj) {
        return this.ioServer.publishAll(type, id, obj);
    }

    publishFileAll(id, fileName, size) {
        return this.ioServer.publishFileAll(id, fileName, size);
    }

    sendLog(obj) {
        this.ioServer.sendLog(obj);
    }

    close() {
        this.ioServer.close();
    }
}

module.exports = Socket;