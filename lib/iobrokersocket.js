/* jshint -W097 */// jshint strict:false
/*jslint node: true */
/*jshint -W061 */
"use strict";

var socketio = require('socket.io');
var request  = null;

var cookieParser      = require('cookie-parser');

// From settings used only secure, auth and crossDomain
function IOBrokerSocket(server, settings, adapter) {
    if (!(this instanceof IOBrokerSocket)) return new IOBrokerSocket(settings);

    this.settings   = settings;
    this.adapter    = adapter;
    this.webServer  = server;
    this.subscribes = {};
    
    var that = this;

    var __construct = (function () {
        that.server = socketio.listen(that.webServer);

        //    socket = socketio.listen(settings.port, (settings.bind && settings.bind != "0.0.0.0") ? settings.bind : undefined);
        that.adapter.config.defaultUser = that.adapter.config.defaultUser || 'system.user.admin';
        if (!that.adapter.config.defaultUser.match(/^system\.user\./)) that.adapter.config.defaultUser = 'system.user.' + that.adapter.config.defaultUser;

        if (that.settings.auth) {
            that.server.use(function (socket, next) {
                if (!socket.request._query.user || !socket.request._query.pass) {
                    that.adapter.log.warn("No password or username!");
                    next(new Error('Authentication error'));
                } else {
                    that.adapter.checkPassword(socket.request._query.user, socket.request._query.pass, function (res) {
                        if (res) {
                            that.adapter.log.debug("Logged in: " + socket.request._query.user + ', ' + socket.request._query.pass);
                            return next();
                        } else {
                            that.adapter.log.warn("Invalid password or user name: " + socket.request._query.user + ', ' + socket.request._query.pass);
                            next(new Error('Invalid password or user name'));
                        }
                    });
                }
            });
        }

        // Enable cross domain access
        if (that.settings.crossDomain) that.server.set('origins', '*:*');

        that.settings.ttl    = that.settings.ttl || 3600;

        that.server.on('connection', initSocket);

        that.adapter.log.info((settings.secure ? 'Secure ' : '') + 'socket.io server listening on port ' + settings.port);

        if (!that.infoTimeout) that.infoTimeout = setTimeout(updateConnectedInfo, 1000);
    })();

    // Extract user name from socket
    function getUserFromSocket(socket, callback) {
        var wait = false;
        try {
            if (socket.handshake.headers.cookie) {
                var cookie = decodeURIComponent(socket.handshake.headers.cookie);
                var m = cookie.match(/connect\.sid=(.+)/);
                if (m) {
                    // If session cookie exists
                    var sessionID = cookieParser.signedCookie(m[1], that.settings.secret);
                    if (sessionID) {
                        // Get user for session
                        wait = true;
                        that.settings.store.get(sessionID, function (err, obj) {
                            if (obj && obj.passport && obj.passport.user) {
                                socket._sessionID = sessionID;
                                if (callback) callback(null, obj.passport.user);
                            } else {
                                if (callback) callback('unknown user');
                            }
                        });
                    }
                }
            }
        } catch (e) {
            that.adapter.log.error(e);
            wait = false;
        }
        if (!wait && callback) callback("Cannot detect user");
    }

    function initSocket(socket) {
        if (that.adapter.config.auth) {
            getUserFromSocket(socket, function (err, user) {
                if (err || !user) {
                    socket.emit('reauthenticate');
                    adapter.log.error('socket.io ' + err);
                    socket.disconnect();
                    return;
                } else {
                    socket._secure = true;
                    adapter.log.debug('socket.io client ' + user + ' connected');
                    adapter.calculatePermissions('system.user.' + user, commandsPermissions, function (acl) {
                        socket._acl = acl;
                        socketEvents(socket);
                    });
                }
            });
        } else {
            adapter.calculatePermissions(that.adapter.config.defaultUser, commandsPermissions, function (acl) {
                socket._acl = acl;
                socketEvents(socket);
            });
        }
    }

    function pattern2RegEx(pattern) {
        if (pattern != '*') {
            if (pattern[0] == '*' && pattern[pattern.length - 1] != '*') pattern += '$';
            if (pattern[0] != '*' && pattern[pattern.length - 1] == '*') pattern = '^' + pattern;
        }
        pattern = pattern.replace(/\./g, '\\.');
        pattern = pattern.replace(/\*/g, '.*');
        return pattern;
    }

    function subscribe(socket, type, pattern) {
        //console.log((socket._name || socket.id) + ' subscribe ' + pattern);
        socket._subscribe = socket._subscribe || {};
        if (!that.subscribes[type]) that.subscribes[type] = {};

        var s = socket._subscribe[type] = socket._subscribe[type] || [];
        for (var i = 0; i < s.length; i++) {
            if (s[i].pattern == pattern) {
                //console.log((socket._name || socket.id) + ' subscribe ' + pattern + ' found');
                return;
            }
        }

        s.push({pattern: pattern, regex: new RegExp(pattern2RegEx(pattern))});

        if (that.subscribes[type][pattern] === undefined){
            that.subscribes[type][pattern] = 1;
            if (type == 'stateChange') {
                console.log((socket._name || socket.id) + ' subscribeForeignStates ' + pattern);
                that.adapter.subscribeForeignStates(pattern);
            } else if (type == 'objectChange') {
                console.log((socket._name || socket.id) + ' subscribeForeignObjects ' + pattern);
                if (that.adapter.subscribeForeignObjects) that.adapter.subscribeForeignObjects(pattern);
            }
        } else {
            that.subscribes[type][pattern]++;
            //console.log((socket._name || socket.id) + ' subscribeForeignStates ' + pattern + ' ' + that.subscribes[type][pattern]);
        }
    }

    function unsubscribe(socket, type, pattern) {

        //console.log((socket._name || socket.id) + ' unsubscribe ' + pattern);
        if (!that.subscribes[type]) that.subscribes[type] = {};

        if (!socket._subscribe || !socket._subscribe[type]) return;
        for (var i = 0; i < socket._subscribe[type].length; i++) {
            if (socket._subscribe[type][i].pattern == pattern) {

                // Remove pattern from global list
                if (that.subscribes[type][pattern] !== undefined){
                    that.subscribes[type][pattern]--;
                    if (!that.subscribes[type][pattern]) {
                        if (type == 'stateChange') {
                            //console.log((socket._name || socket.id) + ' unsubscribeForeignStates ' + pattern);
                            that.adapter.unsubscribeForeignStates(pattern);
                        } else if (type == 'objectChange') {
                            //console.log((socket._name || socket.id) + ' unsubscribeForeignObjects ' + pattern);
                            if (that.adapter.unsubscribeForeignObjects) that.adapter.unsubscribeForeignObjects(pattern);
                        }
                        delete that.subscribes[type][pattern];
                    } else {
                        //console.log((socket._name || socket.id) + ' unsubscribeForeignStates ' + pattern + ' ' + that.subscribes[type][pattern]);
                    }
                }

                delete socket._subscribe[type][i];
                return;
            }
        }
    }

    function unsubscribeSocket(socket, type) {
        //console.log((socket._name || socket.id) + ' unsubscribeSocket');
        if (!socket._subscribe || !socket._subscribe[type]) return;

        for (var i = 0; i < socket._subscribe[type].length; i++) {
            var pattern = socket._subscribe[type][i].pattern;
            if (that.subscribes[type][pattern] !== undefined){
                that.subscribes[type][pattern]--;
                if (!that.subscribes[type][pattern]) {
                    if (type == 'stateChange') {
                        //console.log((socket._name || socket.id) + ' unsubscribeForeignStates ' + pattern);
                        that.adapter.unsubscribeForeignStates(pattern);
                    } else if (type == 'objectChange') {
                        //console.log((socket._name || socket.id) + ' unsubscribeForeignObjects ' + pattern);
                        if (that.adapter.unsubscribeForeignObjects) that.adapter.unsubscribeForeignObjects(pattern);
                    }
                    delete that.subscribes[type][pattern];
                } else {
                    //console.log((socket._name || socket.id) + ' unsubscribeForeignStates ' + pattern + that.subscribes[type][pattern]);
                }
            }
        }
    }

    function subscribeSocket(socket, type) {
        //console.log((socket._name || socket.id) + ' subscribeSocket');
        if (!socket._subscribe || !socket._subscribe[type]) return;

        for (var i = 0; i < socket._subscribe[type].length; i++) {
            var pattern = socket._subscribe[type][i].pattern;
            if (that.subscribes[type][pattern] === undefined){
                that.subscribes[type][pattern] = 1;
                if (type == 'stateChange') {
                    console.log((socket._name || socket.id) + ' subscribeForeignStates' + pattern);
                    that.adapter.subscribeForeignStates(pattern);
                } else if (type == 'objectChange') {
                    console.log((socket._name || socket.id) + ' subscribeForeignObjects' + pattern);
                    if (that.adapter.subscribeForeignObjects) that.adapter.subscribeForeignObjects(pattern);
                }
            } else {
                that.subscribes[type][pattern]++;
            }
        }
    }

    function publish(socket, type, id, obj) {
        if (!socket._subscribe || !socket._subscribe[type]) return;
        var s = socket._subscribe[type];
        for (var i = 0; i < s.length; i++) {
            if (s[i].regex.test(id)) {
                updateSession(socket);
                socket.emit(type, id, obj);
                return;
            }
        }
    }

    // upadate session ID, but not offter than 60 seconds
    function updateSession(socket) {
        if (socket._sessionID) {
            var time = (new Date()).getTime();
            if (socket._lastActivity && time - socket._lastActivity > settings.ttl * 1000) {
                socket.emit('reauthenticate');
                socket.disconnect();
                return false;
            }
            socket._lastActivity = time;
            if (!socket._sessionTimer) {
                socket._sessionTimer = setTimeout(function () {
                    socket._sessionTimer = null;
                    that.settings.store.get(socket._sessionID, function (err, obj) {
                        if (obj) {
                            that.adapter.setSession(socket._sessionID, settings.ttl, obj);
                        } else {
                            socket.emit('reauthenticate');
                            socket.disconnect();
                        }
                    });
                }, 60000);
            }
        }
        return true;
    }

    // static information
    var commandsPermissions = {
        getObject:          {type: 'object',    operation: 'read'},
        getObjects:         {type: 'object',    operation: 'list'},
        getObjectView:      {type: 'object',    operation: 'list'},
        setObject:          {type: 'object',    operation: 'write'},
        subscribeObjects:   {type: 'object',    operation: 'read'},
        unsubscribeObjects: {type: 'object',    operation: 'read'},

        getStates:          {type: 'state',     operation: 'list'},
        getState:           {type: 'state',     operation: 'read'},
        setState:           {type: 'state',     operation: 'write'},
        getStateHistory:    {type: 'state',     operation: 'read'},
        subscribe:          {type: 'state',     operation: 'read'},
        unsubscribe:        {type: 'state',     operation: 'read'},
        getVersion:         {type: '',          operation: ''},

        httpGet:            {type: 'other',     operation: 'http'},
        sendTo:             {type: 'other',     operation: 'sendto'},
        sendToHost:         {type: 'other',     operation: 'sendto'},

        readFile:           {type: 'file',      operation: 'read'},
        readFile64:         {type: 'file',      operation: 'read'},
        writeFile:          {type: 'file',      operation: 'write'},
        writeFile64:        {type: 'file',      operation: 'write'},
        unlink:             {type: 'file',      operation: 'delete'},
        rename:             {type: 'file',      operation: 'write'},
        mkdir:              {type: 'file',      operation: 'write'},
        readDir:            {type: 'file',      operation: 'list'},

        authEnabled:        {type: '',          operation: ''},
        disconnect:         {type: '',          operation: ''},
        listPermissions:    {type: '',          operation: ''},
        getUserPermissions: {type: 'object',    operation: 'read'}
    };

    function checkPermissions(socket, command, callback, arg) {
        if (socket._acl.user != 'system.user.admin') {
            // type: file, object, state, other
            // operation: create, read, write, list, delete, sendto, execute, sendto
            if (commandsPermissions[command]) {
                // If permission required
                if (commandsPermissions[command].type) {
                    if (socket._acl[commandsPermissions[command].type] && socket._acl[commandsPermissions[command].type][commandsPermissions[command].operation]) {
                        return true;
                    }
                } else {
                    return true;
                }
            }

            console.log('No permission for "' + socket._acl.user + '" to call ' + command);
            if (callback) {
                callback('permissionError');
            } else {
                socket.emit('permissionError', {
                    command:    command,
                    type:       commandsPermissions[command].type,
                    operation:  commandsPermissions[command].operation,
                    arg:        arg
                });
            }
            return false;
        } else {
            return true;
        }
    }

    function socketEvents(socket) {

        console.log((new Date()).toISOString() + ' Connected ' + socket._acl.user);

        if (socket.conn.request.sessionID) {
            socket._secure    = true;
            socket._sessionID = socket.conn.request.sessionID;
            // Get user for session
            that.settings.store.get(socket.conn.request.sessionID, function (err, obj) {
                if (!obj || !obj.passport) {
                    socket._acl.user = '';
                    socket.emit('reauthenticate');
                    socket.disconnect();
                }
                if (socket._authPending) {
                    socket._authPending(!!socket._acl.user, true);
                    delete socket._authPending;
                }
            });
        }

        subscribeSocket(socket, 'stateChange');
        subscribeSocket(socket, 'objectChange');

        if (!that.infoTimeout) that.infoTimeout = setTimeout(updateConnectedInfo, 1000);

        socket.on('authenticate', function (user, pass, callback) {
            console.log((new Date()).toISOString() + ' Request authenticate [' + socket._acl.user + ']');
            if (typeof user == 'function') {
                callback = user;
                user = undefined;
            }
            if (socket._acl.user !== null) {
                callback(socket._acl.user !== null, socket._secure);
            } else {
                socket._authPending = callback;
            }
        });

        socket.on('name', function (name) {
            updateSession(socket);
            if (this._name === undefined) {
                this._name = name;
                if (!that.infoTimeout) that.infoTimeout = setTimeout(updateConnectedInfo, 1000);
            } else if (this._name != name) {
                that.adapter.log.warn('socket ' + this.id + ' changed socket name from ' + this._name + ' to ' + name);
                this._name = name;
            }
        });

        /*
         *      objects
         */
        socket.on('getObject', function (id, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'getObject', callback, id)) {
                that.adapter.getForeignObject(id, callback);
            }
        });

        socket.on('getObjects', function (callback) {
            if (updateSession(socket) && checkPermissions(socket, 'getObjects', callback)) {
                that.adapter.getForeignObjects('*', 'state', 'rooms', function (err, objs) {
                    callback(err, objs);
                });
            }
        });

        socket.on('subscribeObjects', function (pattern, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'subscribeObjects', callback, pattern)) {
                subscribe(this, 'objectChange', pattern);
            }
        });

        socket.on('unsubscribeObjects', function (pattern, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'unsubscribeObjects', callback, pattern)) {
                unsubscribe(this, 'objectChange', pattern);
            }
        });
        
        socket.on('getObjectView', function (design, search, params, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'getObjectView', callback, search)) {
                that.adapter.objects.getObjectView(design, search, params, callback);
            }
        });

        socket.on('setObject', function (id, obj, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'setObject', callback, id)) {
                that.adapter.setForeignObject(id, obj, callback);
            }
        });

        /*
         *      states
         */
        socket.on('getStates', function (pattern, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'getStates', callback, pattern)) {
                if (typeof pattern == 'function') {
                    callback = pattern;
                    pattern = null;
                }
                that.adapter.getForeignStates(pattern || '*', {user: socket._acl.user}, callback);
            }
        });

        socket.on('getState', function (id, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'getState', callback, id)) {
                that.adapter.getForeignState(id, {user: socket._acl.user}, callback);
            }
        });

        socket.on('setState', function (id, state, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'setState', callback, id)) {
                if (typeof state !== 'object') state = {val: state};
                that.adapter.setForeignState(id, state, {user: socket._acl.user}, function (err, res) {
                    if (typeof callback === 'function') callback(err, res);
                });
            }
        });

        socket.on('getVersion', function (callback) {
            if (updateSession(socket) && checkPermissions(socket, 'getVersion', callback)) {
                if (typeof callback === 'function') callback(that.adapter.version);
            }
        });

        socket.on('subscribe', function (pattern, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'subscribe', callback, pattern)) {
                subscribe(this, 'stateChange', pattern);
            }
        });

        socket.on('unsubscribe', function (pattern, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'unsubscribe', callback, pattern)) {
                unsubscribe(this, 'stateChange', pattern);
            }
        });

        /*
         *      History
         */
        socket.on('getStateHistory', function (id, start, end, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'getStateHistory', callback, id)) {
                that.adapter.getForeignStateHistory(id, start, end, callback);
            }
        });

        // HTTP
        socket.on('httpGet', function (url, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'httpGet', callback, url)) {
                if (!request) request = require('request');

                request(url, callback);
            }
        });

        // iobroker commands
        socket.on('sendTo', function (adapterInstance, command, message, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'sendTo', callback, command)) {
                that.adapter.sendTo(adapterInstance, command, message, callback);
            }
        });

        socket.on('authEnabled', function (callback) {
            if (updateSession(socket) && checkPermissions(socket, 'authEnabled', callback)) {
                callback(that.adapter.config.auth, socket._acl.user.replace(/^system\.user\./, ''));
            }
        });

        // file operations
        socket.on('readFile', function (_adapter, fileName, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'readFile', callback, fileName)) {
                that.adapter.readFile(_adapter, fileName, {user: socket._acl.user}, callback);
            }
        });

        socket.on('readFile64', function (_adapter, fileName, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'readFile64', callback, fileName)) {
                that.adapter.readFile(_adapter, fileName, {user: socket._acl.user}, function (err, buffer) {
                    var data64;
                    if (buffer) {
                        data64 = buffer.toString('base64');
                    }
                    //Convert buffer to base 64
                    if (callback) {
                        callback(err, data64);
                    }
                });
            }
        });

        socket.on('writeFile64', function (_adapter, fileName, data64, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'writeFile64', callback, fileName)) {
                //Convert base 64 to buffer
                var buffer = new Buffer(data64, 'base64');
                that.adapter.writeFile(_adapter, fileName, buffer, {user: socket._acl.user}, function (err) {
                    if (callback) {
                        callback(err);
                    }
                });
            }
        });

        socket.on('writeFile', function (_adapter, fileName, data, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'writeFile', callback, fileName)) {
                that.adapter.writeFile(_adapter, fileName, data, {user: socket._acl.user}, callback);
            }
        });

        socket.on('unlink', function (_adapter, name, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'unlink', callback, name)) {
                that.adapter.unlink(_adapter, name, {user: socket._acl.user}, callback);
            }
        });

        socket.on('rename', function (_adapter, oldName, newName, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'rename', callback, oldName)) {
                that.adapter.rename(_adapter, oldName, newName, {user: socket._acl.user}, callback);
            }
        });

        socket.on('mkdir', function (_adapter, dirName, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'mkdir', callback, dirName)) {
                that.adapter.mkdir(_adapter, dirName, {user: socket._acl.user}, callback);
            }
        });

        socket.on('readDir', function (_adapter, dirName, options, callback) {
            if (typeof options == 'function') {
                callback = options;
                options = {};
            }
            options = options || {};
            options.user = socket._acl.user;

            if (options.filter === undefined) options.filter = true;

            if (updateSession(socket) && checkPermissions(socket, 'readDir', callback, dirName)) {
                that.adapter.readDir(_adapter, dirName, options, callback);
            }
        });

        // connect/disconnect
        socket.on('disconnect', function () {
            //console.log('disonnect');
            unsubscribeSocket(this, 'stateChange');
            unsubscribeSocket(this, 'objectChange');
            if (!that.infoTimeout) that.infoTimeout = setTimeout(updateConnectedInfo, 1000);
        });

        socket.on('reconnect', function () {
            console.log('reconnect');

            if (socket._sessionID) {
                that.adapter.getSession(socket._sessionID, function (obj) {
                    if (obj && obj.passport) {
                        socket._acl.user = obj.passport.user;
                    } else {
                        socket._acl.user = '';
                        socket.emit('reauthenticate');
                        socket.disconnect();
                    }
                    console.log('Got sessionID for '+ socket._acl.user);
                    if (socket._authPending) {
                        socket._authPending(!!socket._acl.user, true);
                        delete socket._authPending;
                    }
                });
            }

            subscribeSocket(this, 'stateChange');
            subscribeSocket(this, 'objectChange');
        });

        socket.on('logout', function (callback) {
            that.adapter.destroySession(socket._sessionID, callback);
        });

        socket.on('listPermissions', function (callback) {
            if (updateSession(socket)) {
                if (callback) callback(commandsPermissions);
            }
        });

        socket.on('getUserPermissions', function (callback) {
            if (updateSession(socket) && checkPermissions(socket, 'getUserPermissions', callback)) {
                if (callback) callback(null, socket._acl);
            }
        });

    }

    function updateConnectedInfo() {
        if (that.infoTimeout) {
            clearTimeout(that.infoTimeout);
            that.infoTimeout = null;
        }
        var text = '';
        var cnt = 0;
        if (that.server) {
            var clients = that.server.sockets.connected;

            for (var i in clients) {
                text += (text ? ', ' : '') + (clients[i]._name || 'noname');
                cnt++;
            }
        }
        text = '[' + cnt + ']' + text;
        that.adapter.setState('connected', text, true);
    }

    this.publishAll = function(type, id, obj) {
        if (id === undefined) {
            console.log('Problem');
        }

        var clients = this.server.sockets.connected;

        for (var i in clients) {
            publish(clients[i], type, id, obj);
        }
    }
}



module.exports = IOBrokerSocket;