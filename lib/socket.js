// this file used by iobroker.web to start the socket
const socketio     = require('socket.io');
const SocketIO     = require('./socketIO');
const SocketCommon = require('@iobroker/socket-classes').SocketCommon;

class Socket {
    constructor(server, settings, adapter, ignore, store) {
        this.ioServer = new SocketIO(settings, adapter);

        this.ioServer.start(server, socketio, {store, secret: settings.secret}, {
            pingInterval: 120000,
            pingTimeout: 30000
        });
    }

    getWhiteListIpForAddress(remoteIp, whiteListSettings) {
        return SocketCommon.getWhiteListIpForAddress(remoteIp, whiteListSettings);
    }

    publishAll(type, id, obj) {
        return this.ioServer.publishAll(type, id, obj);
    }

    sendLog(obj) {
        this.ioServer.sendLog(obj);
    }

    close() {
        this.ioServer.close();
    }
}

module.exports = Socket;