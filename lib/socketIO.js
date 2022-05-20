// const SocketCommon = require('./socketCommon');
// const SocketCommands = require('./socketCommands');
const SocketCommon = require('@iobroker/socket-classes').SocketCommon;
const SocketCommands = require('@iobroker/socket-classes').SocketCommands;
const path = require('path');
let cookieParser; // require('cookie-parser') - only if auth is activated

// From settings used only secure, auth and crossDomain
class SocketIO extends SocketCommon {
    __getIsNoDisconnect() {
        return false;
    }

    __initAuthentication(authOptions) {
        cookieParser = cookieParser || require('@iobroker/socket-classes').cookieParser;

        this.secret = authOptions.secret;

        if (authOptions.store && !this.store) {
            this.store = authOptions.store;
        } else if (!authOptions.store && this.store) {
            authOptions.store = this.store;
        }

        this.server.use((socket, next) => {
            if (!socket.request._query.user || !socket.request._query.pass) {
                this.__getUserFromSocket(socket, (err, user) => {
                    if (err || !user) {
                        socket.emit(SocketCommon.COMMAND_RE_AUTHENTICATE);
                        this.adapter.log.error(`socket.io [use] ${err || 'User not found'}`);
                        socket.disconnect();
                    } else {
                        socket._secure = true;
                        this.adapter.calculatePermissions(`system.user.${user}`, SocketCommands.COMMANDS_PERMISSIONS, acl => {
                            const address = this.__getClientAddress(socket);
                            socket._acl = SocketCommon._mergeACLs(address, acl, this.settings.whiteListSettings);
                            next();
                        });
                    }
                });
            } else {
                this.adapter.checkPassword(socket.request._query.user, socket.request._query.pass, res => {
                    if (res) {
                        this.adapter.log.debug(`Logged in: ${socket.request._query.user}, ${socket.request._query.pass}`);
                        next();
                    } else {
                        this.adapter.log.warn(`Invalid password or user name: ${socket.request._query.user}, ${socket.request._query.pass}`);
                        socket.emit(SocketCommon.COMMAND_RE_AUTHENTICATE);
                        next(new Error('Invalid password or user name'));
                    }
                });
            }
        });
    }

    // Extract username from socket
    __getUserFromSocket(socket, callback) {
        let wait = false;
        try {
            if (socket.handshake.headers.cookie && (!socket.request || !socket.request._query || !socket.request._query.user)) {
                const cookie = decodeURIComponent(socket.handshake.headers.cookie);
                const m = cookie.match(/connect\.sid=(.+)/);
                if (m) {
                    // If session cookie exists
                    const c = m[1].split(';')[0];
                    const sessionID = cookieParser.signedCookie(c, this.secret);
                    if (sessionID) {
                        // Get user for session
                        wait = true;
                        this.store.get(sessionID, (err, obj) => {
                            if (obj && obj.passport && obj.passport.user) {
                                socket._sessionID = sessionID;
                                if (typeof callback === 'function') {
                                    callback(null, obj.passport.user);
                                } else {
                                    this.adapter.log.warn('[_getUserFromSocket] Invalid callback');
                                }
                            } else {
                                if (typeof callback === 'function') {
                                    callback('unknown user');
                                } else {
                                    this.adapter.log.warn('[_getUserFromSocket] Invalid callback');
                                }
                            }
                        });
                    }
                }
            }

            if (!wait) {
                const user = socket.request._query.user;
                const pass = socket.request._query.pass;

                if (user && pass) {
                    wait = true;
                    this.adapter.checkPassword(user, pass, res => {
                        if (res) {
                            this.adapter.log.debug(`Logged in: ${user}`);
                            if (typeof callback === 'function') {
                                callback(null, user);
                            } else {
                                this.adapter.log.warn('[_getUserFromSocket] Invalid callback');
                            }
                        } else {
                            this.adapter.log.warn(`Invalid password or user name: ${user}, ${pass[0]}***(${pass.length})`);
                            if (typeof callback === 'function') {
                                callback('unknown user_');
                            } else {
                                this.adapter.log.warn('[_getUserFromSocket] Invalid callback');
                            }
                        }
                    });
                }
            }
        } catch (e) {
            this.adapter.log.error(e);
            wait = false;
        }

        !wait && callback('Cannot detect user');
    }

    __getClientAddress(socket) {
        let address;
        if (socket.handshake) {
            address = socket.handshake.address;
        }
        if (!address && socket.request && socket.request.connection) {
            address = socket.request.connection.remoteAddress;
        }
        return address;
    }

    // update session ID, but not ofter than 60 seconds
    __updateSession(socket) {
        if (socket._sessionID) {
            let time = Date.now();
            if (socket._lastActivity && time - socket._lastActivity > this.settings.ttl * 1000) {
                socket.emit(SocketCommon.COMMAND_RE_AUTHENTICATE);
                socket.disconnect();
                return false;
            }
            socket._lastActivity = time;
            if (!socket._sessionTimer) {
                socket._sessionTimer = setTimeout(() => {
                    socket._sessionTimer = null;
                    this.store.get(socket._sessionID, (err, obj) => {
                        if (obj) {
                            this.adapter.setSession(socket._sessionID, this.settings.ttl, obj);
                        } else {
                            socket.emit(SocketCommon.COMMAND_RE_AUTHENTICATE);
                            socket.disconnect();
                        }
                    });
                }, 60000);
            }
        }
        return true;
    }

    __getSessionID(socket) {
        return socket.conn.request.sessionID;
    }

    start(server, socketClass, authOptions, socketOptions) {
        let pathResolve;

        // is required only for socket.io@2.x
        if (!server.__inited) {
            //
            // WORKAROUND for socket.io issue #3555 (https://github.com/socketio/socket.io/issues/3555)
            // needed until socket.io update is release which incorporates PR #3557
            //
            // Problem: Socket.io always search "upwards" for their client files and not in its own node_modules
            //
            // Solution: We hook on path.resolve to correctly handle the relevant case
            //
            pathResolve = path.resolve;

            // do not make this function with => (lambda)
            const pathResolveHooked = function () {
                //console.log('arguments: ' + arguments.length + ': ' + arguments[0] + ' - ' + arguments[1] + ' - ' + arguments[2]);
                if (arguments.length === 3 && arguments[1] === './../../' && arguments[2].startsWith('socket.io-client/dist/socket.io.js')) {
                    path.resolve = pathResolve; // reset because require.resolve also uses path.resolve internally
                    // We want to have the same client files as provided by socket.io
                    // So lookup socket.io first ...
                    const socketIoDir = require.resolve('socket.io');
                    // ... and then from their (with normally unneeded fallback to "us")
                    // we look up the client library
                    const clientPath = require.resolve('socket.io-client', {
                        paths: [path.dirname(socketIoDir), __dirname]
                    });
                    //console.log('1: ' + clientPath);
                    path.resolve = pathResolveHooked; // and restore to hooked one again
                    return path.normalize(path.join(path.dirname(clientPath), '..', '..', arguments[2]));
                }
                // if not our special case, just pass request through to original resolve logic
                return pathResolve.apply(null, arguments);
            };

            path.resolve = pathResolveHooked; // hook path.resolve
        }

        // force using only websockets
        if (this.settings.forceWebSockets) {
            // socket.io 4.x
            socketOptions.transports = ['websocket'];
        }
        if (this.settings.compatibilityV2 !== false) {
            // socket.io 4.x
            socketOptions.allowEIO3 = true;
        }

        // force using only websockets (Only socket.io 2.x)
        this.settings.forceWebSockets && this.server.set && this.server.set('transports', ['websocket']);

        super.start(server, socketClass, authOptions, socketOptions);

        /*server.use(function (req, res, next) {
            res.header('Access-Control-Allow-Origin', req.header('origin') );
            next();
        });*/
        if (pathResolve) {
            path.resolve = pathResolve; // restore path.resolve once done
        }
    }

    publishAll(type, id, obj) {
        if (id === undefined) {
            console.log('Problem');
        }

        if (this.server && this.server.sockets) {
            const sockets = this.server.sockets.sockets || this.server.sockets.connected;

            // this could be an object or array
            Object.keys(sockets).forEach(i => {
                if (this.publish(sockets[i], type, id, obj)) {
                    this.__updateSession(sockets[i]);
                }
            });
        }
    }
}

module.exports = SocketIO;
