"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketIO = void 0;
const node_path_1 = __importDefault(require("node:path"));
const socket_classes_1 = require("@iobroker/socket-classes");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
// From settings used only secure, auth and crossDomain
class SocketIO extends socket_classes_1.SocketCommon {
    secret = '';
    __getIsNoDisconnect() {
        return false;
    }
    __initAuthentication(authOptions) {
        this.secret = authOptions.secret;
        const socketIoServer = this.server;
        if (authOptions.store && !this.store) {
            this.store = authOptions.store;
        }
        else if (!authOptions.store && this.store) {
            authOptions.store = this.store;
        }
        socketIoServer?.use((socket, next) => {
            const socketIo = socket;
            if (!socketIo.request._query.user || !socketIo.request._query.pass) {
                this.__getUserFromSocket(socket, (err, user) => {
                    if (err || !user) {
                        socketIo.emit(socket_classes_1.SocketCommon.COMMAND_RE_AUTHENTICATE);
                        this.adapter.log.error(`socket.io [use] ${err || 'User not found'}`);
                        socketIo.disconnect();
                    }
                    else {
                        socketIo._secure = true;
                        void this.adapter.calculatePermissions(`system.user.${user}`, socket_classes_1.SocketCommands.COMMANDS_PERMISSIONS, (acl) => {
                            const address = this.__getClientAddress(socket);
                            socketIo._acl = socket_classes_1.SocketCommon._mergeACLs(address.address, acl, this.settings.whiteListSettings);
                            next();
                        });
                    }
                });
            }
            else {
                void this.adapter.checkPassword(socketIo.request._query.user, socketIo.request._query.pass, (res) => {
                    if (res) {
                        this.adapter.log.debug(`Logged in: ${socketIo.request._query.user}, ${socketIo.request._query.pass}`);
                        next();
                    }
                    else {
                        this.adapter.log.warn(`Invalid password or user name: ${socketIo.request._query.user}, ${socketIo.request._query.pass}`);
                        socketIo.emit(socket_classes_1.SocketCommon.COMMAND_RE_AUTHENTICATE);
                        next(new Error('Invalid password or user name'));
                    }
                });
            }
        });
    }
    // Extract username from socket
    __getUserFromSocket(socket, callback) {
        const socketIo = socket;
        let wait = false;
        try {
            const textCookie = socketIo.handshake.query['connect.sid'] || socketIo.handshake.headers.cookie;
            if (textCookie && (!socketIo.request || !socketIo.request._query?.user)) {
                const cookie = decodeURIComponent(textCookie);
                const m = cookie.match(/connect\.sid=(.+)/);
                if (m || socketIo.handshake.query['connect.sid']) {
                    let sessionID;
                    // If session cookie exists
                    if (socketIo.handshake.query['connect.sid']) {
                        sessionID = cookie_parser_1.default.signedCookie(socketIo.handshake.query['connect.sid'], this.secret);
                    }
                    else {
                        const c = m[1].split(';')[0];
                        sessionID = cookie_parser_1.default.signedCookie(c, this.secret);
                    }
                    if (sessionID) {
                        // Get user for session
                        wait = true;
                        this.store?.get(sessionID, (_err, obj) => {
                            if (obj?.passport?.user) {
                                socketIo._sessionID = sessionID;
                                if (typeof callback === 'function') {
                                    callback(null, obj.passport.user);
                                }
                                else {
                                    this.adapter.log.warn('[_getUserFromSocket] Invalid callback');
                                }
                            }
                            else {
                                if (typeof callback === 'function') {
                                    callback('unknown user');
                                }
                                else {
                                    this.adapter.log.warn('[_getUserFromSocket] Invalid callback');
                                }
                            }
                        });
                    }
                }
            }
            if (!wait) {
                const user = socketIo.request._query.user;
                const pass = socketIo.request._query.pass;
                if (user && pass) {
                    wait = true;
                    void this.adapter.checkPassword(user, pass, (res) => {
                        if (res) {
                            this.adapter.log.debug(`Logged in: ${user}`);
                            if (typeof callback === 'function') {
                                callback(null, user);
                            }
                            else {
                                this.adapter.log.warn('[_getUserFromSocket] Invalid callback');
                            }
                        }
                        else {
                            this.adapter.log.warn(`Invalid password or user name: ${user}, ${pass[0]}***(${pass.length})`);
                            if (typeof callback === 'function') {
                                callback('unknown user_');
                            }
                            else {
                                this.adapter.log.warn('[_getUserFromSocket] Invalid callback');
                            }
                        }
                    });
                }
            }
        }
        catch (e) {
            this.adapter.log.error(e);
            wait = false;
        }
        !wait && callback('Cannot detect user');
    }
    __getClientAddress(socket) {
        const socketIo = socket;
        let address;
        if (socketIo.handshake) {
            address = socketIo.handshake.address;
        }
        if (!address && socketIo.request?.connection) {
            address = socketIo.request.connection.remoteAddress;
        }
        if (address) {
            return {
                address,
                family: address.includes(':') ? 'IPv6' : 'IPv4',
                port: 0, // not used
            };
        }
        throw new Error('Cannot detect client address');
    }
    // update session ID, but not ofter than 60 seconds
    __updateSession(socket) {
        const socketIo = socket;
        if (socketIo?._sessionID) {
            const time = Date.now();
            if (socketIo._lastActivity && time - socketIo._lastActivity > (this.settings.ttl || 3600) * 1000) {
                socketIo.emit(socket_classes_1.SocketCommon.COMMAND_RE_AUTHENTICATE);
                socketIo.disconnect();
                return false;
            }
            socketIo._lastActivity = time;
            socketIo._sessionTimer ||= setTimeout(() => {
                socketIo._sessionTimer = undefined;
                this.store?.get(socketIo._sessionID, (_err, obj) => {
                    if (obj) {
                        void this.adapter.setSession(socketIo._sessionID || '', this.settings.ttl || 3600, obj);
                    }
                    else {
                        socketIo.emit(socket_classes_1.SocketCommon.COMMAND_RE_AUTHENTICATE);
                        socketIo.disconnect();
                    }
                });
            }, 60000);
        }
        return true;
    }
    __getSessionID(socket) {
        const socketIo = socket;
        return socketIo.conn.request.sessionID;
    }
    start(server, socketClass, authOptions, socketOptions) {
        // is required only for socket.io@2.x
        //
        // WORKAROUND for socket.io issue #3555 (https://github.com/socketio/socket.io/issues/3555)
        // needed until socket.io update is release which incorporates PR #3557
        //
        // Problem: Socket.io always search "upwards" for their client files and not in its own node_modules
        //
        // Solution: We hook on path.resolve to correctly handle the relevant case
        //
        const pathResolve = node_path_1.default.resolve;
        // do not make this function with => (lambda)
        const pathResolveHooked = function (...args) {
            //console.log('arguments: ' + arguments.length + ': ' + arguments[0] + ' - ' + arguments[1] + ' - ' + arguments[2]);
            if (args.length === 3 &&
                args[1] === './../../' &&
                args[2].startsWith('socket.io-client/dist/socket.io.js')) {
                node_path_1.default.resolve = pathResolve; // reset because require.resolve also uses path.resolve internally
                // We want to have the same client files as provided by socket.io
                // So lookup socket.io first ...
                const socketIoDir = require.resolve('socket.io');
                // ... and then from their (with normally unneeded fallback to "us")
                // we look up the client library
                const clientPath = require.resolve('socket.io-client', {
                    paths: [node_path_1.default.dirname(socketIoDir), __dirname],
                });
                // console.log('1: ' + clientPath);
                node_path_1.default.resolve = pathResolveHooked; // and restore to hooked one again
                return node_path_1.default.normalize(node_path_1.default.join(node_path_1.default.dirname(clientPath), '..', '..', args[2]));
            }
            // if not our special case, just pass request through to original resolve logic
            return pathResolve(...args);
        };
        socketOptions ||= {
            pingTimeout: 120000,
            pingInterval: 30000,
        };
        node_path_1.default.resolve = pathResolveHooked; // hook path.resolve
        // force using only websockets
        if (this.settings.forceWebSockets) {
            // socket.io 4.x
            socketOptions.transports = ['websocket'];
        }
        if (this.settings.compatibilityV2 !== false) {
            // socket.io 4.x
            socketOptions.allowEIO3 = true;
        }
        // for v4
        socketOptions.cookie = {
            cookieName: 'io',
            cookieHttpOnly: false,
            cookiePath: '/',
        };
        super.start(server, socketClass, authOptions, socketOptions);
        // force using only websockets (Only socket.io 2.x)
        if (this.settings.forceWebSockets) {
            // @ts-expect-error
            this.server?.set?.('transports', ['websocket']);
        }
        // set max size of the message (Only socket.io 2.x)
        if (socketOptions.maxHttpBufferSize) {
            // @ts-expect-error
            this.server?.set?.('destroy buffer size', socketOptions.maxHttpBufferSize);
        }
        // for socket.io 3.x
        // socketOptions.maxHttpBufferSize && this.server?.set?.('maxHttpBufferSize', socketOptions.maxHttpBufferSize);
        if (pathResolve) {
            node_path_1.default.resolve = pathResolve; // restore path.resolve once done
        }
    }
    publishAll(type, id, obj) {
        if (id === undefined) {
            console.log('Problem');
        }
        if (this.server?.sockets) {
            const sockets = this.server.sockets.sockets || this.server.sockets.connected;
            // this could be an object or array
            for (const socket of sockets) {
                if (this.publish(socket, type, id, obj)) {
                    this.__updateSession(socket);
                }
            }
        }
    }
    publishFileAll(id, fileName, size) {
        if (id === undefined) {
            console.log('Problem');
        }
        if (this.server?.sockets) {
            const sockets = this.server.sockets.sockets || this.server.sockets.connected;
            // this could be an object or array
            for (const socket of sockets) {
                if (this.publishFile(socket, id, fileName, size)) {
                    this.__updateSession(socket);
                }
            }
        }
    }
    publishInstanceMessageAll(sourceInstance, messageType, sid, data) {
        if (this.server?.sockets) {
            const sockets = this.server.sockets.sockets || this.server.sockets.connected;
            // this could be an object or array
            for (const socket of sockets) {
                if (socket.id === sid) {
                    if (this.publishInstanceMessage(socket, sourceInstance, messageType, data)) {
                        this.__updateSession(socket);
                    }
                }
            }
        }
    }
}
exports.SocketIO = SocketIO;
//# sourceMappingURL=socketIO.js.map