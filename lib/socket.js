const socketio = require('socket.io');
const IOSocket = require('./socketCommon');

// From settings used only secure, auth and crossDomain
class RealSocket extends IOSocket {
    getIsNoDisconnect() {
        return false;
    }

    getSocket() {
        return socketio;
    }

    initAuthentication(options) {
        this.server.use((socket, next) => {
            if (!socket.request._query.user || !socket.request._query.pass) {
                this._getUserFromSocket(socket, (err, user) => {
                    if (err || !user) {
                        socket.emit(IOSocket.COMMAND_RE_AUTHENTICATE);
                        this.adapter.log.error(`socket.io [use] ${err || 'User not found'}`);
                        socket.disconnect();
                    } else {
                        socket._secure = true;
                        this.adapter.calculatePermissions(`system.user.${user}`, IOSocket.COMMANDS_PERMISSIONS, acl => {
                            let address = this.getClientAddress(socket);
                            // socket._acl = acl;
                            socket._acl = IOSocket.mergeACLs(address, acl, this.settings.whiteListSettings);
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
                        socket.emit(IOSocket.COMMAND_RE_AUTHENTICATE);
                        next(new Error('Invalid password or user name'));
                    }
                });
            }
        });
    }

    // Extract username from socket
    _getUserFromSocket(socket, callback) {
        let wait = false;
        try {
            if (socket.handshake.headers.cookie && (!socket.request || !socket.request._query || !socket.request._query.user)) {
                let cookie = decodeURIComponent(socket.handshake.headers.cookie);
                let m = cookie.match(/connect\.sid=(.+)/);
                if (m) {
                    // If session cookie exists
                    let c = m[1].split(';')[0];
                    let sessionID = this._cookieParser.signedCookie(c, this.settings.secret);
                    if (sessionID) {
                        // Get user for session
                        wait = true;
                        this.settings.store.get(sessionID, (err, obj) => {
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
                let user = socket.request._query.user;
                let pass = socket.request._query.pass;

                if (user && pass) {
                    wait = true;
                    this.adapter.checkPassword(user, pass, res => {
                        if (res) {
                            this.adapter.log.debug('Logged in: ' + user);
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

    getClientAddress(socket) {
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
    updateSession(socket) {
        if (socket._sessionID) {
            let time = Date.now();
            if (socket._lastActivity && time - socket._lastActivity > this.settings.ttl * 1000) {
                socket.emit(IOSocket.COMMAND_RE_AUTHENTICATE);
                socket.disconnect();
                return false;
            }
            socket._lastActivity = time;
            if (!socket._sessionTimer) {
                socket._sessionTimer = setTimeout(() => {
                    socket._sessionTimer = null;
                    this.settings.store.get(socket._sessionID, (err, obj) => {
                        if (obj) {
                            this.adapter.setSession(socket._sessionID, this.settings.ttl, obj);
                        } else {
                            socket.emit(IOSocket.COMMAND_RE_AUTHENTICATE);
                            socket.disconnect();
                        }
                    });
                }, 60000);
            }
        }
        return true;
    }

    getSessionID(socket) {
        return socket.conn.request.sessionID;
    }
}

module.exports = RealSocket;
