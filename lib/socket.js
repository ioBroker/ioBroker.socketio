/* jshint -W097 */// jshint strict:false
/*jslint node: true */
/*jshint -W061 */
'use strict';

var socketio = require('socket.io');
var request  = null;

var cookieParser   = require('cookie-parser');

// From settings used only secure, auth and crossDomain
function IOSocket(server, settings, adapter) {
    if (!(this instanceof IOSocket)) return new IOSocket(settings);

    this.settings   = settings || {};
    this.adapter    = adapter;
    this.webServer  = server;
    this.subscribes = {};
    
    var that = this;

   // Extract user name from socket
    function getUserFromSocket(socket, callback) {
        var wait = false;
        try {
            if (socket.handshake.headers.cookie) {
                var cookie = decodeURIComponent(socket.handshake.headers.cookie);
                var m = cookie.match(/connect\.sid=(.+)/);
                if (m) {
                    // If session cookie exists
                    var c = m[1].split(';')[0];
                    var sessionID = cookieParser.signedCookie(c, that.settings.secret);
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
            if (!wait) {
                var user = socket.request._query.user;
                var pass = socket.request._query.pass;
                if (user && pass) {
                    wait = true;
                    that.adapter.checkPassword(user, pass, function (res) {
                        if (res) {
                            that.adapter.log.debug('Logged in: ' + user);
                            if (callback) callback(null, user);
                        } else {
                            that.adapter.log.warn('Invalid password or user name: ' + user + ', ' + pass[0] + '***(' + pass.length + ')');
                            if (callback) callback('unknown user');
                        }
                    });
                }
            }
        } catch (e) {
            that.adapter.log.error(e);
            wait = false;
        }
        if (!wait && callback) callback('Cannot detect user');
    }

    this.initSocket = function (socket) {
        if (that.adapter.config.auth) {
            getUserFromSocket(socket, function (err, user) {
                if (err || !user) {
                    socket.emit('reauthenticate');
                    adapter.log.error('socket.io ' + err);
                    socket.disconnect();
                } else {
                    socket._secure = true;
                    adapter.log.debug('socket.io client ' + user + ' connected');
                    adapter.calculatePermissions('system.user.' + user, commandsPermissions, function (acl) {
                        var address;
                        if (socket.handshake) {
                            address = socket.handshake.address;
                        }
                        if (!address && socket.request && socket.request.connection) {
                            address = socket.request.connection.remoteAddress;
                        }
                        // socket._acl = acl;
                        socket._acl = mergeACLs(address, acl, that.settings.whiteListSettings);
                        socketEvents(socket);
                    });
                }
            });
        } else {
            adapter.calculatePermissions(that.adapter.config.defaultUser, commandsPermissions, function (acl) {
                var address;
                if (socket.handshake) {
                    address = socket.handshake.address;
                }
                if (!address && socket.request && socket.request.connection) {
                    address = socket.request.connection.remoteAddress;
                }
                // socket._acl = acl;
                socket._acl = mergeACLs(address, acl, that.settings.whiteListSettings);
                socketEvents(socket);
            });
        }
    };

    this.getWhiteListIpForAddress = function (address, whiteList){
        return getWhiteListIpForAddress(address, whiteList);
    };
    
    function getWhiteListIpForAddress(address, whiteList) {
        if (!whiteList) return null;

        // check IPv6 or IPv4 direct match
        if (whiteList.hasOwnProperty(address)) {
            return address;
        }

        // check if address is IPv4
        var addressParts = address.split('.');
        if (addressParts.length !== 4) {
            return null;
        }

        // do we have settings for wild carded ips?
        var wildCardIps = Object.keys(whiteList).filter(function (key) {
            return key.indexOf('*') !== -1;
        });


        if (wildCardIps.length === 0) {
            // no wild carded ips => no ip configured
            return null;
        }

        wildCardIps.forEach(function (ip) {
            var ipParts = ip.split('.');
            if (ipParts.length === 4) {
                for (var i = 0; i < 4; i++) {
                    if (ipParts[i] === '*' && i === 3) {
                        // match
                        return ip;
                    }

                    if (ipParts[i] !== addressParts[i]) break;
                }
            }
        });

        return null;
    }

    function getPermissionsForIp(address, whiteList) {
        return whiteList[getWhiteListIpForAddress(address, whiteList) || 'default'];
    }

    function mergeACLs(address, acl, whiteList) {
        if (whiteList && address) {
            var whiteListAcl = getPermissionsForIp(address, whiteList);
            if (whiteListAcl) {
                ['object', 'state', 'file'].forEach(function (key) {
                    if (acl.hasOwnProperty(key) && whiteListAcl.hasOwnProperty(key)) {
                        Object.keys(acl[key]).forEach(function (permission) {
                            if (whiteListAcl[key].hasOwnProperty(permission)) {
                                acl[key][permission] = acl[key][permission] && whiteListAcl[key][permission];
                            }
                        })
                    }
                });

                if (whiteListAcl.user !== 'auth') {
                    acl.user = 'system.user.' + whiteListAcl.user;
                }
            }
        }

        return acl;
    }

    function pattern2RegEx(pattern) {
        if (!pattern) {
            return null;
        }
        if (pattern !== '*') {
            if (pattern[0] === '*' && pattern[pattern.length - 1] !== '*') pattern += '$';
            if (pattern[0] !== '*' && pattern[pattern.length - 1] === '*') pattern = '^' + pattern;
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
            if (s[i].pattern === pattern) return;
        }

        var p = pattern2RegEx(pattern);
        if (p === null) {
            adapter.log.warn('Empty pattern!');
            return;
        }
        s.push({pattern: pattern, regex: new RegExp(p)});

        if (that.subscribes[type][pattern] === undefined){
            that.subscribes[type][pattern] = 1;
            if (type === 'stateChange') {
                 that.adapter.subscribeForeignStates(pattern);
            } else if (type === 'objectChange') {
                if (that.adapter.subscribeForeignObjects) that.adapter.subscribeForeignObjects(pattern);
            }
        } else {
            that.subscribes[type][pattern]++;
        }
    }

    function showSubscribes(socket, type) {
        var s = socket._subscribe[type] || [];
        var ids = [];
        for (var i = 0; i < s.length; i++) {
            ids.push(s[i].pattern);
        }
        that.adapter.log.debug('Subscribes: ' + ids.join(', '));
    }

    function unsubscribe(socket, type, pattern) {

        //console.log((socket._name || socket.id) + ' unsubscribe ' + pattern);
        if (!that.subscribes[type]) that.subscribes[type] = {};

        if (!socket._subscribe || !socket._subscribe[type]) return;
        for (var i = socket._subscribe[type].length - 1; i >= 0; i--) {
            if (socket._subscribe[type][i].pattern === pattern) {

                // Remove pattern from global list
                if (that.subscribes[type][pattern] !== undefined){
                    that.subscribes[type][pattern]--;
                    if (that.subscribes[type][pattern] <= 0) {
                        if (type === 'stateChange') {
                            //console.log((socket._name || socket.id) + ' unsubscribeForeignStates ' + pattern);
                            that.adapter.unsubscribeForeignStates(pattern);
                        } else if (type === 'objectChange') {
                            //console.log((socket._name || socket.id) + ' unsubscribeForeignObjects ' + pattern);
                            if (that.adapter.unsubscribeForeignObjects) that.adapter.unsubscribeForeignObjects(pattern);
                        }
                        delete that.subscribes[type][pattern];
                    }
                }

                delete socket._subscribe[type][i];
                socket._subscribe[type].splice(i, 1);
                return;
            }
        }
    }

    function unsubscribeSocket(socket, type) {
        if (!socket._subscribe || !socket._subscribe[type]) return;

        for (var i = 0; i < socket._subscribe[type].length; i++) {
            var pattern = socket._subscribe[type][i].pattern;
            if (that.subscribes[type][pattern] !== undefined){
                that.subscribes[type][pattern]--;
                if (that.subscribes[type][pattern] <= 0) {
                    if (type === 'stateChange') {
                        that.adapter.unsubscribeForeignStates(pattern);
                    } else if (type === 'objectChange') {
                        if (that.adapter.unsubscribeForeignObjects) that.adapter.unsubscribeForeignObjects(pattern);
                    }
                    delete that.subscribes[type][pattern];
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
                if (type === 'stateChange') {
                    that.adapter.subscribeForeignStates(pattern);
                } else if (type === 'objectChange') {
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

    // update session ID, but not offter than 60 seconds
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
        chmodFile:          {type: 'file',      operation: 'write'},

        authEnabled:        {type: '',          operation: ''},
        disconnect:         {type: '',          operation: ''},
        listPermissions:    {type: '',          operation: ''},
        getUserPermissions: {type: 'object',    operation: 'read'}
    };

    function checkPermissions(socket, command, callback, arg) {
        if (socket._acl.user !== 'system.user.admin') {
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

            that.adapter.log.warn('No permission for "' + socket._acl.user + '" to call ' + command);
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

        that.adapter.log.info((new Date()).toISOString() + ' Connected ' + socket._acl.user);

        // send api key if exists
        if (that.settings.clientid) {
            socket.emit('apikey', that.settings.clientid);
        }

        if (socket.conn && socket.conn.request.sessionID) {
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

        if (socket.conn) {
            subscribeSocket(socket, 'stateChange');
            subscribeSocket(socket, 'objectChange');
        }

        if (!that.infoTimeout) that.infoTimeout = setTimeout(updateConnectedInfo, 1000);

        socket.on('authenticate', function (user, pass, callback) {
            that.adapter.log.debug((new Date()).toISOString() + ' Request authenticate [' + socket._acl.user + ']');
            if (typeof user === 'function') {
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
            } else if (this._name !== name) {
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
                if (pattern && typeof pattern === 'object' && pattern instanceof Array) {
                    for (var p = 0; p < pattern.length; p++) {
                        subscribe(this, 'objectChange', pattern[p]);
                    }
                } else {
                    subscribe(this, 'objectChange', pattern);
                }
            }
        });

        socket.on('unsubscribeObjects', function (pattern, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'unsubscribeObjects', callback, pattern)) {
                if (pattern && typeof pattern === 'object' && pattern instanceof Array) {
                    for (var p = 0; p < pattern.length; p++) {
                        unsubscribe(this, 'objectChange', pattern[p]);
                    }
                } else {
                    unsubscribe(this, 'objectChange', pattern);
                }
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
                if (typeof pattern === 'function') {
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
                if (pattern && typeof pattern === 'object' && pattern instanceof Array) {
                    for (var p = 0; p < pattern.length; p++) {
                        subscribe(this, 'stateChange', pattern[p]);
                    }
                } else {
                    subscribe(this, 'stateChange', pattern);
                }
                if (that.adapter.log.level === 'debug') showSubscribes(socket, 'stateChange');
            }
        });

        socket.on('unsubscribe', function (pattern, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'unsubscribe', callback, pattern)) {
                if (pattern && typeof pattern === 'object' && pattern instanceof Array) {
                    for (var p = 0; p < pattern.length; p++) {
                        unsubscribe(this, 'stateChange', pattern[p]);
                    }
                } else {
                    unsubscribe(this, 'stateChange', pattern);
                }
                if (that.adapter.log.level === 'debug') showSubscribes(socket, 'stateChange');
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
        // neue History
        socket.on('getHistory', function (id,options, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'getStateHistory', callback, id)) {
                that.adapter.getHistory(id, options, function (err, data, step, sessionId) {
                    callback(err, data, step, sessionId);
                });
            }
        });

        // HTTP
        socket.on('httpGet', function (url, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'httpGet', callback, url)) {
                if (!request) request = require('request');
                that.adapter.log.debug('httpGet: ' + url);
                request(url, callback);
            }
        });

        // commands
        socket.on('sendTo', function (adapterInstance, command, message, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'sendTo', callback, command)) {
                that.adapter.sendTo(adapterInstance, command, message, callback);
            }
        });
        
        socket.on('sendToHost', function (host, command, message, callback) {
            if (updateSession(socket) && checkPermissions(socket, 'sendToHost', callback, command)) {
                that.adapter.sendToHost(host, command, message, callback);
            }
        });

        socket.on('authEnabled', function (callback) {
            if (updateSession(socket) && checkPermissions(socket, 'authEnabled', callback)) {
                // that.settings.auth ??
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
                that.adapter.readFile(_adapter, fileName, {user: socket._acl.user}, function (err, buffer, type) {
                    var data64;
                    if (buffer) {
                        if (type === 'application/json') {
                            data64 = new Buffer(encodeURIComponent(buffer)).toString('base64');
                        } else {
                            if (typeof buffer === 'string') {
                                data64 = new Buffer(buffer).toString('base64');
                            } else {
                                data64 = buffer.toString('base64');
                            }
                        }
                    }

                    //Convert buffer to base 64
                    if (callback) callback(err, data64 || '', type);
                });
            }
        });

        socket.on('writeFile64', function (_adapter, fileName, data64, options, callback) {
            if (typeof options === 'function') {
                callback = options;
                options = {user: socket._acl.user};
            }
            if (!options) options = {};
            options.user = socket._acl.user;

            if (updateSession(socket) && checkPermissions(socket, 'writeFile64', callback, fileName)) {
                //Convert base 64 to buffer
                var buffer = new Buffer(data64, 'base64');
                that.adapter.writeFile(_adapter, fileName, buffer, options, function (err) {
                    if (callback) {
                        callback(err);
                    }
                });
            }
        });

        socket.on('writeFile', function (_adapter, fileName, data, options, callback) {
            if (typeof options === 'function') {
                callback = options;
                options = {user: socket._acl.user};
            }
            if (!options) options = {};
            options.user = socket._acl.user;
            if (updateSession(socket) && checkPermissions(socket, 'writeFile', callback, fileName)) {
                that.adapter.writeFile(_adapter, fileName, data, options, callback);
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
            if (typeof options === 'function') {
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

        socket.on('chmodFile', function (_adapter, dirName, options, callback) {
            if (typeof options === 'function') {
                callback = options;
                options = {};
            }
            options = options || {};
            options.user = socket._acl.user;

            if (options.filter === undefined) options.filter = true;

            if (updateSession(socket) && checkPermissions(socket, 'chmodFile', callback, dirName)) {
                that.adapter.chmodFile(_adapter, dirName, options, callback);
            }
        });

        // connect/disconnect
        socket.on('disconnect', function () {
            unsubscribeSocket(this, 'stateChange');
            unsubscribeSocket(this, 'objectChange');
            if (!that.infoTimeout) that.infoTimeout = setTimeout(updateConnectedInfo, 1000);
        });

        socket.on('reconnect', function () {
            that.adapter.log.debug('reconnect');

            // send api key if exists
            if (that.settings.clientid) {
                socket.emit('apikey', that.settings.clientid);
            }
            
            if (socket._sessionID) {
                that.adapter.getSession(socket._sessionID, function (obj) {
                    if (obj && obj.passport) {
                        socket._acl.user = obj.passport.user;
                    } else {
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

        if (typeof that.settings.extensions === 'function') {
            that.settings.extensions(socket);
        }
    }

    function updateConnectedInfo() {
        if (that.infoTimeout) {
            clearTimeout(that.infoTimeout);
            that.infoTimeout = null;
        }
        if (that.server.sockets) {
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
    }

    this.publishAll = function (type, id, obj) {
        if (id === undefined) {
            console.log('Problem');
        }

        var clients = this.server.sockets.connected;

        for (var i in clients) {
            publish(clients[i], type, id, obj);
        }
    }

    var __construct = (function () {
        // it can be used as client too for cloud
        if (!that.settings.clientid) {
            that.server = socketio.listen(that.webServer);

            // force using only websockets
            if (that.settings.forceWebSockets) that.server.set('transports', ['websocket']);
        } else {
            that.server = server;
        }

        //    socket = socketio.listen(settings.port, (settings.bind && settings.bind !== "0.0.0.0") ? settings.bind : undefined);
        that.adapter.config.defaultUser = that.adapter.config.defaultUser || 'system.user.admin';
        if (!that.adapter.config.defaultUser.match(/^system\.user\./)) that.adapter.config.defaultUser = 'system.user.' + that.adapter.config.defaultUser;

        if (that.settings.auth && that.server) {
            that.server.use(function (socket, next) {
                if (!socket.request._query.user || !socket.request._query.pass) {
                    that.adapter.log.warn('No password or username!');
                    next(new Error('Authentication error'));
                } else {
                    that.adapter.checkPassword(socket.request._query.user, socket.request._query.pass, function (res) {
                        if (res) {
                            that.adapter.log.debug('Logged in: ' + socket.request._query.user + ', ' + socket.request._query.pass);
                            next();
                        } else {
                            that.adapter.log.warn('Invalid password or user name: ' + socket.request._query.user + ', ' + socket.request._query.pass);
                            socket.emit('reauthenticate');
                            next(new Error('Invalid password or user name'));
                        }
                    });
                }
            });
        }

        // Enable cross domain access
        if (that.settings.crossDomain && that.server.set) that.server.set('origins', '*:*');

        that.settings.ttl = that.settings.ttl || 3600;

        that.server.on('connection', that.initSocket);

        if (settings.port) {
            that.adapter.log.info((settings.secure ? 'Secure ' : '') + 'socket.io server listening on port ' + settings.port);
        }

        if (!that.infoTimeout) that.infoTimeout = setTimeout(updateConnectedInfo, 1000);

        if (that.settings.clientid) that.initSocket(that.server);
    })();
}

module.exports = IOSocket;