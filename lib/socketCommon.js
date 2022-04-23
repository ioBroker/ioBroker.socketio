/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */
/* jshint -W061 */
'use strict';

const path         = require('path');
const fs           = require('fs');
const EventEmitter = require('events');
const tools        = require('@iobroker/js-controller-common').tools;
let axios          = null;

// From settings used only secure, auth and crossDomain
class IOSocket extends EventEmitter {
    static COMMAND_RE_AUTHENTICATE = 'reauthenticate';
    static ERROR_PERMISSION = 'permissionError';
    static COMMANDS_PERMISSIONS = {
        getObject:          {type: 'object',    operation: 'read'},
        getObjects:         {type: 'object',    operation: 'list'},
        getObjectView:      {type: 'object',    operation: 'list'},
        setObject:          {type: 'object',    operation: 'write'},
        requireLog:         {type: 'object',    operation: 'write'}, // just mapping to some command
        delObject:          {type: 'object',    operation: 'delete'},
        extendObject:       {type: 'object',    operation: 'write'},
        getHostByIp:        {type: 'object',    operation: 'list'},
        subscribeObjects:   {type: 'object',    operation: 'read'},
        unsubscribeObjects: {type: 'object',    operation: 'read'},

        getStates:          {type: 'state',     operation: 'list'},
        getState:           {type: 'state',     operation: 'read'},
        setState:           {type: 'state',     operation: 'write'},
        delState:           {type: 'state',     operation: 'delete'},
        createState:        {type: 'state',     operation: 'create'},
        subscribe:          {type: 'state',     operation: 'read'},
        unsubscribe:        {type: 'state',     operation: 'read'},
        getStateHistory:    {type: 'state',     operation: 'read'},
        getVersion:         {type: '',          operation: ''},
        getAdapterName:     {type: '',          operation: ''},

        addUser:            {type: 'users',     operation: 'create'},
        delUser:            {type: 'users',     operation: 'delete'},
        addGroup:           {type: 'users',     operation: 'create'},
        delGroup:           {type: 'users',     operation: 'delete'},
        changePassword:     {type: 'users',     operation: 'write'},

        httpGet:            {type: 'other',     operation: 'http'},
        cmdExec:            {type: 'other',     operation: 'execute'},
        sendTo:             {type: 'other',     operation: 'sendto'},
        sendToHost:         {type: 'other',     operation: 'sendto'},
        readLogs:           {type: 'other',     operation: 'execute'},

        readDir:            {type: 'file',      operation: 'list'},
        createFile:         {type: 'file',      operation: 'create'},
        writeFile:          {type: 'file',      operation: 'write'},
        readFile:           {type: 'file',      operation: 'read'},
        deleteFile:         {type: 'file',      operation: 'delete'},
        readFile64:         {type: 'file',      operation: 'read'},
        writeFile64:        {type: 'file',      operation: 'write'},
        unlink:             {type: 'file',      operation: 'delete'},
        rename:             {type: 'file',      operation: 'write'},
        mkdir:              {type: 'file',      operation: 'write'},
        chmodFile:          {type: 'file',      operation: 'write'},

        authEnabled:        {type: '',          operation: ''},
        disconnect:         {type: '',          operation: ''},
        listPermissions:    {type: '',          operation: ''},
        getUserPermissions: {type: 'object',    operation: 'read'}
    };

    constructor(server, settings, adapter, ignore, store, checkUser) {
        super();

        this._store = store || settings.store;

        this.settings   = settings || {};
        this.adapter    = adapter;
        this.webServer  = server;
        this.subscribes = {};
        this.thersholdInterval = null;

        // do not send too many state updates
        this.eventsThreshold = {
            count:          0,
            timeActivated:  0,
            active:         false,
            accidents:      0,
            repeatSeconds:  3,   // how many seconds continuously must be number of events > value
            value:          200, // how many events allowed in one check interval
            checkInterval:  1000 // duration of one check interval
        };

        this.noDisconnect = this.getIsNoDisconnect();

        this.init(server, {checkUser, userKey: 'connect.sid'});
    }

    getIsNoDisconnect() {
        throw new Error('"getIsNoDisconnect" must be implemented in IOSocket!');
    }

    getSocket() {
        throw new Error('"getSocket" must be implemented in IOSocket!');
    }

    initAuthentication(options) {
        throw new Error('"initAuthentication" must be implemented in IOSocket!');
    }

    // Extract username from socket
    _getUserFromSocket(socket, callback) {
        throw new Error('"_getUserFromSocket" must be implemented in IOSocket!');
    }

    getClientAddress(socket) {
        throw new Error('"getClientAddress" must be implemented in IOSocket!')
    }

    // update session ID, but not ofter than 60 seconds
    updateSession(socket) {
        throw new Error('"updateSession" must be implemented in IOSocket!')
    }

    getSessionID(socket) {
        throw new Error('"getSessionID" must be implemented in IOSocket!')
    }

    init(server, options) {
        const socketIO = this.getSocket();

        if (this.settings.auth) {
            this._cookieParser = require('cookie-parser');
        }

        if (this.settings.allowAdmin) {
            // detect event bursts
            this.thersholdInterval = setInterval(() => {
                if (!this.eventsThreshold.active) {
                    if (this.eventsThreshold.count > this.eventsThreshold.value) {
                        this.eventsThreshold.accidents++;

                        if (this.eventsThreshold.accidents >= this.eventsThreshold.repeatSeconds) {
                            this._enableEventThreshold();
                        }
                    } else {
                        this.eventsThreshold.accidents = 0;
                    }
                    this.eventsThreshold.count = 0;
                } else if (Date.now() - this.eventsThreshold.timeActivated > 60000) {
                    this._disableEventThreshold();
                }
            }, this.eventsThreshold.checkInterval);
        }

        // it can be used as client too for cloud
        if (!this.settings.apikey) {
            if (!this.webServer.__inited) {
                /*
                                 * WORKAROUND for socket.io issue #3555 (https://github.com/socketio/socket.io/issues/3555)
                                 * needed until socket.io update is release which incorporates PR #3557
                                 *
                                 * Problem: Socket.io always search "upwards" for their client files and not in its own node_modules
                                 *
                                 * Solution: We hook on path.resolve to correctly handle the relevant case
                                 */
                const pathResolve = path.resolve;
                const pathResolveHooked = () => {
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
                    return pathResolve.apply(null,arguments);
                };
                path.resolve = pathResolveHooked; // hook path.resolve

                this.server = socketIO.listen(this.webServer, {
                    pingInterval: 120000,
                    pingTimeout: 30000
                });

                path.resolve = pathResolve; // restore path.resolve once done
                this.webServer.__inited = true;
            }

            // force using only websockets
            this.settings.forceWebSockets && this.server.set('transports', ['websocket']);
        } else {
            this.server = server;
        }

        // socket = socketIO.listen(settings.port, (settings.bind && settings.bind !== "0.0.0.0") ? settings.bind : undefined);
        this.settings.defaultUser = this.settings.defaultUser || 'system.user.admin';
        if (!this.settings.defaultUser.match(/^system\.user\./)) {
            this.settings.defaultUser = 'system.user.' + this.settings.defaultUser;
        }

        if (this.settings.auth && this.server) {
            this.initAuthentication(options);
        }

        // Enable cross domain access
        if (this.settings.crossDomain && this.server.set) {
            this.server.set('origins', '*:*');
        }

        this.settings.ttl = this.settings.ttl || 3600;

        this.server.on('connection', (socket, cb) => this.initSocket(socket, cb));
        this.server.on('error', (e, details) => this.adapter.log.error(`Server error: ${e}${details ? ' - ' + details : ''}`));

        if (this.settings.port) {
            this.adapter.log.info(`${this.settings.secure ? 'Secure ' : ''}socket.io server listening on port ${this.settings.port}`);
        }

        this.infoTimeout = this.infoTimeout || setTimeout(() => {this.infoTimeout = null; this.updateConnectedInfo()}, 1000);

        // if client mode => add event handlers
        if (this.settings.apikey) {
            this.initSocket(this.server);
        }
    }

    _disableEventThreshold(readAll) {
        if (this.eventsThreshold.active) {
            this.eventsThreshold.accidents = 0;
            this.eventsThreshold.count = 0;
            this.eventsThreshold.active = false;
            this.eventsThreshold.timeActivated = 0;
            this.adapter.log.info('Subscribe on all states again');

            setTimeout(() => {
                if (readAll) {
                    this.adapter.getForeignStates('*', ()/*(err, res)*/ => {
                        this.adapter.log.info('received all states');
                        /* for (const id in res) {
                            if (Object.prototype.hasOwnProperty.call(res, id) && JSON.stringify(states[id]) !== JSON.stringify(res[id])) {
                                this.server && this.server.sockets && this.server.sockets.emit('stateChange', id, res[id]);
                                states[id] = res[id];
                            }
                        } */
                    });
                }

                this.server && this.server.sockets && this.server.sockets.emit('eventsThreshold', false);
                this.adapter.unsubscribeForeignStates('system.adapter.*');
                this.adapter.subscribeForeignStates('*');
            }, 50);
        }
    }

    _enableEventThreshold() {
        if (!this.eventsThreshold.active) {
            this.eventsThreshold.active = true;

            setTimeout(() => {
                this.adapter.log.info(`Unsubscribe from all states, except system's, because over ${this.eventsThreshold.repeatSeconds} seconds the number of events is over ${this.eventsThreshold.value} (in last second ${this.eventsThreshold.count})`);
                this.eventsThreshold.timeActivated = Date.now();

                this.server && this.server.sockets && this.server.sockets.emit('eventsThreshold', true);
                this.adapter.unsubscribeForeignStates('*');
                this.adapter.subscribeForeignStates('system.adapter.*');
            }, 100);
        }
    }

    initSocket(socket, cb) {
        if (!socket._acl) {
            if (this.settings.auth) {
                this._getUserFromSocket(socket, (err, user) => {
                    if (err || !user) {
                        socket.emit(IOSocket.COMMAND_RE_AUTHENTICATE);
                        this.adapter.log.error(`socket.io [init] ${err || 'No user found in cookies'}`);
                        if (!this.noDisconnect) {
                            socket.disconnect();
                        }
                    } else {
                        socket._secure = true;
                        this.adapter.log.debug(`socket.io client ${user} connected`);
                        if (!user.startsWith('system.user.')) {
                            user = `system.user.${user}`;
                        }
                        this.adapter.calculatePermissions(user, IOSocket.COMMANDS_PERMISSIONS, acl => {
                            const address = this.getClientAddress(socket);
                            // socket._acl = acl;
                            socket._acl = IOSocket.mergeACLs(address, acl, this.settings.whiteListSettings);
                            this.socketEvents(socket, address, cb);
                        });
                    }
                });
            } else {
                this.adapter.calculatePermissions(this.settings.defaultUser, IOSocket.COMMANDS_PERMISSIONS, acl => {
                    const address = this.getClientAddress(socket);
                    // socket._acl = acl;
                    socket._acl = IOSocket.mergeACLs(address, acl, this.settings.whiteListSettings);
                    this.socketEvents(socket, address, cb);
                });
            }
        } else {
            const address = this.getClientAddress(socket);
            this.socketEvents(socket, address, cb);
        }
    };

    static getWhiteListIpForAddress(address, whiteList) {
        if (!whiteList) {
            return null;
        }

        // check IPv6 or IPv4 direct match
        if (Object.prototype.hasOwnProperty.call(whiteList, address)) {
            return address;
        }

        // check if address is IPv4
        const addressParts = address.split('.');
        if (addressParts.length !== 4) {
            return null;
        }

        // do we have settings for wild carded ips?
        const wildCardIps = Object.keys(whiteList).filter(key => key.includes('*'));

        if (!wildCardIps.length) {
            // no wild carded ips => no ip configured
            return null;
        }

        wildCardIps.forEach(ip => {
            const ipParts = ip.split('.');
            if (ipParts.length === 4) {
                for (let i = 0; i < 4; i++) {
                    if (ipParts[i] === '*' && i === 3) {
                        // match
                        return ip;
                    }

                    if (ipParts[i] !== addressParts[i]) {
                        break;
                    }
                }
            }
        });

        return null;
    }

    static getPermissionsForIp(address, whiteList) {
        return whiteList[IOSocket.getWhiteListIpForAddress(address, whiteList) || 'default'];
    }

    static mergeACLs(address, acl, whiteList) {
        if (whiteList && address) {
            const whiteListAcl = IOSocket.getPermissionsForIp(address, whiteList);
            if (whiteListAcl) {
                ['object', 'state', 'file'].forEach(key => {
                    if (Object.prototype.hasOwnProperty.call(acl, key) && Object.prototype.hasOwnProperty.call(whiteListAcl, key)) {
                        Object.keys(acl[key]).forEach(permission => {
                            if (Object.prototype.hasOwnProperty.call(whiteListAcl[key], permission)) {
                                acl[key][permission] = acl[key][permission] && whiteListAcl[key][permission];
                            }
                        });
                    }
                });

                if (whiteListAcl.user !== 'auth') {
                    acl.user = 'system.user.' + whiteListAcl.user;
                }
            }
        }

        return acl;
    }

    subscribe(socket, type, pattern) {
        //console.log((socket._name || socket.id) + ' subscribe ' + pattern);
        if (socket) {
            socket._subscribe = socket._subscribe || {};
        }

        this.subscribes[type] = this.subscribes[type] || {};

        pattern = pattern.toString();

        let s;
        if (socket) {
            s = socket._subscribe[type] = socket._subscribe[type] || [];
            for (let i = 0; i < s.length; i++) {
                if (s[i].pattern === pattern) {
                    return;
                }
            }
        }

        const p = tools.pattern2RegEx(pattern);
        if (p === null) {
            return this.adapter.log.warn('Empty pattern on subscribe!');
        }
        if (socket) {
            s.push({pattern, regex: new RegExp(p)});
        }

        if (this.subscribes[type][pattern] === undefined) {
            this.subscribes[type][pattern] = 1;
            if (type === 'stateChange') {
                this.adapter.subscribeForeignStates(pattern);
            } else if (type === 'objectChange') {
                if (this.adapter.subscribeForeignObjects) {
                    this.adapter.subscribeForeignObjects(pattern);
                }
            } else if (type === 'log') {
                this.adapter.requireLog && this.adapter.requireLog(true);
            }
        } else {
            this.subscribes[type][pattern]++;
        }
    };

    _showSubscribes(socket, type) {
        if (socket && socket._subscribe) {
            const s = socket._subscribe[type] || [];
            const ids = [];
            for (let i = 0; i < s.length; i++) {
                ids.push(s[i].pattern);
            }
            this.adapter.log.debug('Subscribes: ' + ids.join(', '));
        } else {
            this.adapter.log.debug('Subscribes: no subscribes');
        }
    }

    unsubscribe(socket, type, pattern) {
        //console.log((socket._name || socket.id) + ' unsubscribe ' + pattern);
        this.subscribes[type] = this.subscribes[type] || {};

        pattern = pattern.toString();

        if (socket) {
            if (!socket._subscribe || !socket._subscribe[type]) {
                return;
            }
            for (let i = socket._subscribe[type].length - 1; i >= 0; i--) {
                if (socket._subscribe[type][i].pattern === pattern) {
                    // Remove pattern from global list
                    if (this.subscribes[type][pattern] !== undefined) {
                        this.subscribes[type][pattern]--;
                        if (this.subscribes[type][pattern] <= 0) {
                            if (type === 'stateChange') {
                                //console.log((socket._name || socket.id) + ' unsubscribeForeignStates ' + pattern);
                                this.adapter.unsubscribeForeignStates(pattern);
                            } else if (type === 'objectChange') {
                                //console.log((socket._name || socket.id) + ' unsubscribeForeignObjects ' + pattern);
                                this.adapter.unsubscribeForeignObjects && this.adapter.unsubscribeForeignObjects(pattern);
                            } else if (type === 'log') {
                                //console.log((socket._name || socket.id) + ' requireLog false');
                                this.adapter.requireLog && this.adapter.requireLog(false);
                            }
                            delete this.subscribes[type][pattern];
                        }
                    }

                    delete socket._subscribe[type][i];
                    socket._subscribe[type].splice(i, 1);
                    return;
                }
            }
        } else if (pattern) {
            // Remove pattern from global list
            if (this.subscribes[type][pattern] !== undefined) {
                this.subscribes[type][pattern]--;
                if (this.subscribes[type][pattern] <= 0) {
                    if (type === 'stateChange') {
                        //console.log((socket._name || socket.id) + ' unsubscribeForeignStates ' + pattern);
                        this.adapter.unsubscribeForeignStates(pattern);
                    } else if (type === 'objectChange') {
                        //console.log((socket._name || socket.id) + ' unsubscribeForeignObjects ' + pattern);
                        this.adapter.unsubscribeForeignObjects && this.adapter.unsubscribeForeignObjects(pattern);
                    } else if (type === 'log') {
                        //console.log((socket._name || socket.id) + ' requireLog false');
                        this.adapter.requireLog && this.adapter.requireLog(false);
                    }
                    delete this.subscribes[type][pattern];
                }
            }
        } else {
            for (pattern in this.subscribes[type]) {
                if (!Object.prototype.hasOwnProperty.call(this.subscribes[type], pattern)) {
                    continue;
                }
                if (type === 'stateChange') {
                    //console.log((socket._name || socket.id) + ' unsubscribeForeignStates ' + pattern);
                    this.adapter.unsubscribeForeignStates(pattern);
                } else if (type === 'objectChange') {
                    //console.log((socket._name || socket.id) + ' unsubscribeForeignObjects ' + pattern);
                    this.adapter.unsubscribeForeignObjects && this.adapter.unsubscribeForeignObjects(pattern);
                } else if (type === 'log') {
                    //console.log((socket._name || socket.id) + ' requireLog false');
                    this.adapter.requireLog && this.adapter.requireLog(false);
                }
                delete this.subscribes[type][pattern];
            }
        }
    };

    unsubscribeAll() {
        if (this.server && this.server.sockets) {
            for (const socket in this.server.sockets) {
                if (Object.prototype.hasOwnProperty.call(this.server.sockets, s)) {
                    this._unsubscribeSocket(socket, 'stateChange');
                    this._unsubscribeSocket(socket, 'objectChange');
                    this._unsubscribeSocket(socket, 'log');
                }
            }
        }
    };

    _unsubscribeSocket(socket, type) {
        if (!socket._subscribe || !socket._subscribe[type]) {
            return;
        }

        for (let i = 0; i < socket._subscribe[type].length; i++) {
            const pattern = socket._subscribe[type][i].pattern;
            if (this.subscribes[type][pattern] !== undefined) {
                this.subscribes[type][pattern]--;
                if (this.subscribes[type][pattern] <= 0) {
                    if (type === 'stateChange') {
                        this.adapter.unsubscribeForeignStates(pattern);
                    } else if (type === 'objectChange') {
                        this.adapter.unsubscribeForeignObjects && this.adapter.unsubscribeForeignObjects(pattern);
                    } else if (type === 'log') {
                        this.adapter.requireLog && this.adapter.requireLog(false);
                    }
                    delete this.subscribes[type][pattern];
                }
            }
        }
    }

    _subscribeSocket(socket, type) {
        //console.log((socket._name || socket.id) + ' this._subscribeSocket');
        if (!socket._subscribe || !socket._subscribe[type]) {
            return;
        }

        for (let i = 0; i < socket._subscribe[type].length; i++) {
            const pattern = socket._subscribe[type][i].pattern;
            if (this.subscribes[type][pattern] === undefined) {
                this.subscribes[type][pattern] = 1;
                if (type === 'stateChange') {
                    this.adapter.subscribeForeignStates(pattern);
                } else if (type === 'objectChange') {
                    this.adapter.subscribeForeignObjects && this.adapter.subscribeForeignObjects(pattern);
                } else if (type === 'log') {
                    this.adapter.requireLog && this.adapter.requireLog(true);
                }
            } else {
                this.subscribes[type][pattern]++;
            }
        }
    }

    publish(socket, type, id, obj) {
        if (!socket._subscribe || !socket._subscribe[type]) {
            return;
        }
        const s = socket._subscribe[type];
        for (let i = 0; i < s.length; i++) {
            if (s[i].regex.test(id)) {
                if (!this.noDisconnect) {
                    this.updateSession(socket);
                }
                return socket.emit(type, id, obj);
            }
        }
    }

    _addUser(user, pw, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }

        if (!user.match(/^[-.A-Za-züäößÖÄÜа-яА-Я@+$§0-9=?!&# ]+$/)) {
            if (typeof callback === 'function') {
                callback('Invalid characters in the name. Only following special characters are allowed: -@+$§=?!&# and letters');
            }
            return;
        }

        this.adapter.getForeignObject('system.user.' + user, options, (err, obj) => {
            if (obj) {
                if (typeof callback === 'function') {
                    callback('User yet exists');
                }
            } else {
                this.adapter.setForeignObject('system.user.' + user, {
                    type: 'user',
                    common: {
                        name: user,
                        enabled: true,
                        groups: []
                    }
                }, options, () => {
                    this.adapter.setPassword(user, pw, options, callback);
                });
            }
        });
    }

    _delUser(user, options, callback) {
        this.adapter.getForeignObject('system.user.' + user, options, (err, obj) => {
            if (err || !obj) {
                if (typeof callback === 'function') {
                    callback('User does not exist');
                }
            } else {
                if (obj.common.dontDelete) {
                    if (typeof callback === 'function') {
                        callback('Cannot delete user, while is system user');
                    }
                } else {
                    this.adapter.delForeignObject('system.user.' + user, options, err =>
                        // Remove this user from all groups in web client
                        typeof callback === 'function' && callback(err));
                }
            }
        });
    }

    _addGroup(group, desc, acl, options, callback) {
        let name = group;
        if (typeof acl === 'function') {
            callback = acl;
            acl = null;
        }
        if (typeof desc === 'function') {
            callback = desc;
            desc = null;
        }
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        if (name && name.substring(0, 1) !== name.substring(0, 1).toUpperCase()) {
            name = name.substring(0, 1).toUpperCase() + name.substring(1);
        }
        group = group.substring(0, 1).toLowerCase() + group.substring(1);

        if (!group.match(/^[-.A-Za-züäößÖÄÜа-яА-Я@+$§0-9=?!&#_ ]+$/)) {
            return typeof callback === 'function' && callback('Invalid characters in the group name. Only following special characters are allowed: -@+$§=?!&# and letters');
        }

        this.adapter.getForeignObject('system.group.' + group, options, (err, obj) => {
            if (obj) {
                typeof callback === 'function' && callback('Group yet exists');
            } else {
                obj = {
                    _id:  'system.group.' + group,
                    type: 'group',
                    common: {
                        name,
                        desc,
                        members: [],
                        acl: acl
                    }
                };
                this.adapter.setForeignObject('system.group.' + group, obj, options, err =>
                    typeof callback === 'function' && callback(err, obj));
            }
        });
    }

    _delGroup(group, options, callback) {
        this.adapter.getForeignObject('system.group.' + group, options, (err, obj) => {
            if (err || !obj) {
                typeof callback === 'function' && callback('Group does not exist');
            } else {
                if (obj.common.dontDelete) {
                    typeof callback === 'function' && callback('Cannot delete group, while is system group');
                } else {
                    this.adapter.delForeignObject('system.group.' + group, options, err => {
                        // Remove this group from all users in web client
                        typeof callback === 'function' && callback(err);
                    });
                }
            }
        });
    }

    checkPermissions(socket, command, callback, arg) {
        if (socket._acl.user !== 'system.user.admin') {
            // type: file, object, state, other
            // operation: create, read, write, list, delete, sendto, execute, sendToHost, readLogs
            if (IOSocket.COMMANDS_PERMISSIONS[command]) {
                // If permission required
                if (IOSocket.COMMANDS_PERMISSIONS[command].type) {
                    if (socket._acl[IOSocket.COMMANDS_PERMISSIONS[command].type] &&
                        socket._acl[IOSocket.COMMANDS_PERMISSIONS[command].type][IOSocket.COMMANDS_PERMISSIONS[command].operation]) {
                        return true;
                    } else {
                        this.adapter.log.warn(`No permission for "${socket._acl.user}" to call ${command}. Need "${IOSocket.COMMANDS_PERMISSIONS[command].type}"."${IOSocket.COMMANDS_PERMISSIONS[command].operation}"`);
                    }
                } else {
                    return true;
                }
            } else {
                this.adapter.log.warn('No rule for command: ' + command);
            }

            if (typeof callback === 'function') {
                callback(IOSocket.ERROR_PERMISSION);
            } else {
                if (IOSocket.COMMANDS_PERMISSIONS[command]) {
                    socket.emit(IOSocket.ERROR_PERMISSION, {
                        command,
                        type: IOSocket.COMMANDS_PERMISSIONS[command].type,
                        operation: IOSocket.COMMANDS_PERMISSIONS[command].operation,
                        arg
                    });
                } else {
                    socket.emit(IOSocket.ERROR_PERMISSION, {command, arg});
                }
            }
            return false;
        } else {
            return true;
        }
    }

    static checkObject(obj, options, flag) {
        // read rights of object
        if (!obj || !obj.common || !obj.acl || flag === 'list') {
            return true;
        }

        if (options.user !== 'system.user.admin' && !options.groups.includes('system.group.administrator')) {
            if (obj.acl.owner !== options.user) {
                // Check if the user is in the group
                if (options.groups.includes(obj.acl.ownerGroup)) {
                    // Check group rights
                    if (!(obj.acl.object & (flag << 4))) {
                        return false;
                    }
                } else {
                    // everybody
                    if (!(obj.acl.object & flag)) {
                        return false;
                    }
                }
            } else {
                // Check group rights
                if (!(obj.acl.object & (flag << 8))) {
                    return false;
                }
            }
        }
        return true;
    }

    send(socket, cmd, id, data) {
        if (socket._apiKeyOk) {
            socket.emit(cmd, id, data);
        }
    };

    stopAdapter(reason, callback) {
        reason && this.adapter.log.warn('Adapter stopped. Reason: ' + reason);
        this.adapter.getForeignObject('system.adapter.' + this.adapter.namespace, (err, obj) => {
            err && this.adapter.log.error('[stopAdapter/getForeignObject]: ' + err);
            if (obj) {
                obj.common.enabled = false;
                setTimeout(() => {
                    this.adapter.setForeignObject(obj._id, obj, err => {
                        err && this.adapter.log.error('[stopAdapter/setForeignObject]: ' + err);
                        callback && callback();
                    });
                }, 5000);
            } else {
                callback && callback();
            }
        });
    }

    redirectAdapter(url, callback) {
        if (!url) {
            this.adapter.log.warn('Received redirect command, but no URL');
        } else {
            this.adapter.getForeignObject('system.adapter.' + this.adapter.namespace, (err, obj) => {
                err && this.adapter.log.error('redirectAdapter [getForeignObject]: ' + err);
                if (obj) {
                    obj.native.cloudUrl = url;
                    setTimeout(() => this.adapter.setForeignObject(obj._id, obj, err => {
                        err && this.adapter.log.error('redirectAdapter [setForeignObject]: ' + err);
                        callback && callback();
                    }), 3000);
                } else {
                    callback && callback();
                }
            });
        }
    }

    waitForConnect(delaySeconds) {
        this.emit && this.emit('connectWait', delaySeconds);
    }

    async rename(_adapter, oldName, newName, options) {
        // read if it is a file or folder
        try {
            if (oldName.endsWith('/')) {
                oldName = oldName.substring(0, oldName.length - 1);
            }

            if (newName.endsWith('/')) {
                newName = newName.substring(0, newName.length - 1);
            }

            const files = await this.adapter.readDirAsync(_adapter, oldName, options);
            if (files && files.length) {
                for (let f = 0; f < files.length; f++) {
                    await this.rename(_adapter, `${oldName}/${files[f].file}`, `${newName}/${files[f].file}`);
                }
            }
        } catch (error) {
            if (error.message !== 'Not exists') {
                throw error;
            }
            // else ignore, because it is a file and not a folder
        }

        try {
            await this.adapter.renameAsync(_adapter, oldName, newName, options);
        } catch (error) {
            if (error.message !== 'Not exists') {
                throw error;
            }
            // else ignore, because folder cannot be deleted
        }
    }

    async unlink(_adapter, name, options) {
        // read if it is a file or folder
        try {
            // remove trailing '/'
            if (name.endsWith('/')) {
                name = name.substring(0, name.length - 1);
            }
            const files = await this.adapter.readDirAsync(_adapter, name, options);
            if (files && files.length) {
                for (let f = 0; f < files.length; f++) {
                    await this.unlink(_adapter, name + '/' + files[f].file);
                }
            }
        } catch (error) {
            // ignore, because it is a file and not a folder
            if (error.message !== 'Not exists') {
                throw error;
            }
        }

        try {
            await this.adapter.unlinkAsync(_adapter, name, options);
        } catch (error) {
            if (error.message !== 'Not exists') {
                throw error;
            }
            // else ignore, because folder cannot be deleted
        }
    }

    socketEvents(socket, address, cb) {
        if (socket.conn) {
            this.adapter.log.info(`==> Connected ${socket._acl.user} from ${address}`);
        } else {
            this.adapter.log.info(`Trying to connect as ${socket._acl.user} from ${address}`);
        }

        this.infoTimeout = this.infoTimeout || setTimeout(() => {this.infoTimeout = null; this.updateConnectedInfo()}, 1000);

        socket.on('authenticate', (user, pass, callback) => {
            this.adapter.log.debug(`${new Date().toISOString()} Request authenticate [${socket._acl.user}]`);
            if (typeof user === 'function') {
                callback = user;
                // user = undefined;
            }
            if (socket._acl.user !== null) {
                if (typeof callback === 'function') {
                    callback(true, socket._secure);
                }
            } else {
                this.adapter.log.debug(`${new Date().toISOString()} Request authenticate [${socket._acl.user}]`);
                socket._authPending = callback;
            }
        });

        socket.on('name', (name, cb) => {
            this.adapter.log.debug(`Connection from "${name}"`);
            this.updateSession(socket);
            if (socket._name === undefined) {
                socket._name = name;
                this.infoTimeout = this.infoTimeout || setTimeout(() => {this.infoTimeout = null; this.updateConnectedInfo()}, 1000);
            } else if (socket._name !== name) {
                this.adapter.log.warn(`socket ${this.id} changed socket name from ${socket._name} to ${name}`);
                socket._name = name;
            }

            typeof cb === 'function' && cb();
        });

        /*
         *      objects
         */
        socket.on('getObject', (id, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'getObject', callback, id)) {
                this.adapter.getForeignObject(id, {user: socket._acl.user}, callback);
            }
        });

        socket.on('getObjects', callback => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'getObjects', callback)) {
                this.adapter.getForeignObjects('*', 'state', 'rooms', {user: socket._acl.user}, (err, objs) => {
                    if (typeof callback === 'function') {
                        callback(err, objs);
                    } else {
                        this.adapter.log.warn('[getObjects] Invalid callback');
                    }
                });
            }
        });

        socket.on('subscribeObjects', (pattern, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'subscribeObjects', callback, pattern)) {
                if (pattern && typeof pattern === 'object' && pattern instanceof Array) {
                    for (let p = 0; p < pattern.length; p++) {
                        this.subscribe(socket, 'objectChange', pattern[p]);
                    }
                } else {
                    this.subscribe(socket, 'objectChange', pattern);
                }
                if (typeof callback === 'function') {
                    setImmediate(callback, null);
                }
            }
        });

        socket.on('unsubscribeObjects', (pattern, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'unsubscribeObjects', callback, pattern)) {
                if (pattern && typeof pattern === 'object' && pattern instanceof Array) {
                    for (let p = 0; p < pattern.length; p++) {
                        this.unsubscribe(socket, 'objectChange', pattern[p]);
                    }
                } else {
                    this.unsubscribe(socket, 'objectChange', pattern);
                }
                if (typeof callback === 'function') {
                    setImmediate(callback, null);
                }
            }
        });

        socket.on('getObjectView', (design, search, params, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'getObjectView', callback, search)) {
                this.adapter.getObjectView(design, search, params, {user: socket._acl.user}, callback);
            }
        });

        socket.on('setObject', (id, obj, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'setObject', callback, id)) {
                this.adapter.setForeignObject(id, obj, {user: socket._acl.user}, callback);
            }
        });

        /*
         *      states
         */
        socket.on('getStates', (pattern, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'getStates', callback, pattern)) {
                if (typeof pattern === 'function') {
                    callback = pattern;
                    pattern = null;
                }
                this.adapter.getForeignStates(pattern || '*', {user: socket._acl.user}, callback);
            }
        });

        socket.on('error', err => {
            this.adapter.log.error('Socket error: ' + err);
        });

        socket.on('log', (text, level) => {
            if (level === 'error') {
                this.adapter.log.error(text);
            } else if (level === 'warn') {
                this.adapter.log.warn(text);
            } else if (level === 'info') {
                this.adapter.log.info(text);
            } else {
                this.adapter.log.debug(text);
            }
        });

        // allow admin access
        if (this.settings.allowAdmin) {
            socket.on('getAllObjects', callback => {
                if (this.updateSession(socket) && this.checkPermissions(socket, 'getObjects', callback)) {
                    this.adapter.getObjectList({include_docs: true}, (err, res) => {
                        this.adapter.log.info('received all objects');
                        res = res.rows;
                        const objects = {};

                        if (socket._acl &&
                            socket._acl.user !== 'system.user.admin' &&
                            !socket._acl.groups.includes('system.group.administrator')) {
                            for (let i = 0; i < res.length; i++) {
                                if (IOSocket.checkObject(res[i].doc, socket._acl, 4 /* 'read' */)) {
                                    objects[res[i].doc._id] = res[i].doc;
                                }
                            }
                            if (typeof callback === 'function') {
                                callback(null, objects);
                            } else {
                                this.adapter.log.warn('[getAllObjects] Invalid callback');
                            }
                        } else {
                            for (let j = 0; j < res.length; j++) {
                                objects[res[j].doc._id] = res[j].doc;
                            }
                            if (typeof callback === 'function') {
                                callback(null, objects);
                            } else {
                                this.adapter.log.warn('[getAllObjects] Invalid callback');
                            }
                        }
                    });
                }
            });

            socket.on('delObject', (id, callback) => {
                if (this.updateSession(socket) && this.checkPermissions(socket, 'delObject', callback, id)) {
                    this.adapter.delForeignObject(id, {user: socket._acl.user}, callback);
                }
            });
            socket.on('extendObject', (id, obj, callback) => {
                if (this.updateSession(socket) && this.checkPermissions(socket, 'extendObject', callback, id)) {
                    this.adapter.extendForeignObject(id, obj, {user: socket._acl.user}, callback);
                }
            });
            socket.on('getHostByIp', (ip, callback) => {
                if (this.updateSession(socket) && this.checkPermissions(socket, 'getHostByIp', ip)) {
                    this.adapter.getObjectView('system', 'host', {}, {user: socket._acl.user}, (err, data) => {
                        if (data.rows.length) {
                            for (let i = 0; i < data.rows.length; i++) {
                                if (data.rows[i].value.common.hostname === ip) {
                                    if (typeof callback === 'function') {
                                        callback(ip, data.rows[i].value);
                                    } else {
                                        this.adapter.log.warn('[getHostByIp] Invalid callback');
                                    }
                                    return;
                                }
                                if (data.rows[i].value.native.hardware && data.rows[i].value.native.hardware.networkInterfaces) {
                                    const net = data.rows[i].value.native.hardware.networkInterfaces;
                                    for (const eth in net) {
                                        if (!Object.prototype.hasOwnProperty.call(net, eth)) {
                                            continue;
                                        }
                                        for (let j = 0; j < net[eth].length; j++) {
                                            if (net[eth][j].address === ip) {
                                                if (typeof callback === 'function') {
                                                    callback(ip, data.rows[i].value);
                                                } else {
                                                    this.adapter.log.warn('[getHostByIp] Invalid callback');
                                                }
                                                return;
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        if (typeof callback === 'function') {
                            callback(ip, null);
                        } else {
                            this.adapter.log.warn('[getHostByIp] Invalid callback');
                        }
                    });
                }
            });

            socket.on('getForeignObjects', (pattern, type, callback) => {
                if (this.updateSession(socket) && this.checkPermissions(socket, 'getObjects', callback)) {
                    if (typeof type === 'function') {
                        callback = type;
                        type = undefined;
                    }

                    this.adapter.getForeignObjects(pattern, type, {user: socket._acl.user}, (err, objs) => {
                        if (typeof callback === 'function') {
                            callback(err, objs);
                        } else {
                            this.adapter.log.warn('[getObjects] Invalid callback');
                        }
                    });
                }
            });

            socket.on('getForeignStates', (pattern, callback) => {
                if (this.updateSession(socket) && this.checkPermissions(socket, 'getStates', callback)) {
                    this.adapter.getForeignStates(pattern, {user: socket._acl.user}, (err, objs) => {
                        if (typeof callback === 'function') {
                            callback(err, objs);
                        } else {
                            this.adapter.log.warn('[getObjects] Invalid callback');
                        }
                    });
                }
            });

            socket.on('requireLog', (isEnabled, callback) => {
                if (this.updateSession(socket) && this.checkPermissions(socket, 'setObject', callback)) {
                    if (isEnabled) {
                        this.subscribe(socket, 'log', 'dummy');
                    } else {
                        this.unsubscribe(socket, 'log', 'dummy');
                    }
                    if (this.adapter.log.level === 'debug') {
                        this._showSubscribes(socket, 'log');
                    }

                    if (typeof callback === 'function') {
                        setImmediate(callback, null);
                    }
                }
            });

            socket.on('readLogs', callback => {
                if (this.updateSession(socket) && this.checkPermissions(socket, 'readLogs', callback)) {
                    const result = {list: []};

                    // deliver file list
                    try {
                        const config = this.adapter.systemConfig;
                        // detect file log
                        if (config && config.log && config.log.transport) {
                            for (const transport in config.log.transport) {
                                if (Object.prototype.hasOwnProperty.call(config.log.transport, transport) && config.log.transport[transport].type === 'file') {
                                    let filename = config.log.transport[transport].filename || 'log/';
                                    const parts = filename.replace(/\\/g, '/').split('/');
                                    parts.pop();
                                    filename = parts.join('/');
                                    if (filename[0] === '.') {
                                        filename = path.normalize(__dirname + '/../../../') + filename;
                                    }
                                    if (fs.existsSync(filename)) {
                                        const files = fs.readdirSync(filename);
                                        for (let f = 0; f < files.length; f++) {
                                            try {
                                                if (!fs.lstatSync(filename + '/' + files[f]).isDirectory()) {
                                                    result.list.push(`log/${transport}/${files[f]}`);
                                                }
                                            } catch (e) {
                                                // push unchecked
                                                // result.list.push('log/' + transport + '/' + files[f]);
                                                this.adapter.log.error(`Cannot check file: ${filename}/${files[f]}`);
                                            }
                                        }
                                    }
                                }
                            }
                        } else {
                            result.error = 'no file loggers';
                            result.list = undefined;
                        }
                    } catch (e) {
                        this.adapter.log.error(e);
                        result.error = e;
                        result.list = undefined;
                    }
                    if (typeof callback === 'function') {
                        callback(result.error, result.list);
                    }
                }
            });
        } else {
            // only flot allowed
            socket.on('delObject', (id, callback) => {
                if (id.match(/^flot\./)) {
                    if (this.updateSession(socket) && this.checkPermissions(socket, 'delObject', callback, id)) {
                        this.adapter.delForeignObject(id, {user: socket._acl.user}, callback);
                    }
                } else {
                    if (typeof callback === 'function') {
                        callback(IOSocket.ERROR_PERMISSION);
                    }
                }
            });
        }

        socket.on('getState', (id, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'getState', callback, id)) {
                this.adapter.getForeignState(id, {user: socket._acl.user}, callback);
            }
        });

        socket.on('setState', (id, state, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'setState', callback, id)) {
                if (typeof state !== 'object') {
                    state = {val: state};
                }
                this.adapter.setForeignState(id, state, {user: socket._acl.user}, (err, res) =>
                    typeof callback === 'function' && callback(err, res));
            }
        });

        // allow admin access
        if (this.settings.allowAdmin) {
            socket.on('delState', (id, callback) => {
                if (this.updateSession(socket) && this.checkPermissions(socket, 'delState', callback, id)) {
                    this.adapter.delForeignState(id, {user: socket._acl.user}, callback);
                }
            });
            socket.on('addUser', (user, pass, callback) => {
                if (this.updateSession(socket) && this.checkPermissions(socket, 'addUser', callback, user)) {
                    this._addUser(user, pass, {user: socket._acl.user}, callback);
                }
            });

            socket.on('delUser', (user, callback) => {
                if (this.updateSession(socket) && this.checkPermissions(socket, 'delUser', callback, user)) {
                    this._delUser(user, {user: socket._acl.user}, callback);
                }
            });

            socket.on('addGroup', (group, desc, acl, callback) => {
                if (this.updateSession(socket) && this.checkPermissions(socket, 'addGroup', callback, group)) {
                    this._addGroup(group, desc, acl, {user: socket._acl.user}, callback);
                }
            });

            socket.on('delGroup', (group, callback) => {
                if (this.updateSession(socket) && this.checkPermissions(socket, 'delGroup', callback, group)) {
                    this._delGroup(group, {user: socket._acl.user}, callback);
                }
            });

            socket.on('changePassword', (user, pass, callback) => {
                if (this.updateSession(socket)) {
                    if (user === socket._acl.user || this.checkPermissions(socket, 'changePassword', callback, user)) {
                        this.adapter.setPassword(user, pass, {user: socket._acl.user}, callback);
                    }
                }
            });
            // commands will be executed on host/controller
            // following response commands are expected: cmdStdout, cmdStderr, cmdExit
            socket.on('cmdExec', (host, id, cmd, callback) => {
                if (this.updateSession(socket) && this.checkPermissions(socket, 'cmdExec', callback, cmd)) {
                    this.adapter.log.debug(`cmdExec on ${host}(${id}): ${cmd}`);
                    this.adapter.sendToHost(host, 'cmdExec', {data: cmd, id: id});
                }
            });

            socket.on('eventsThreshold', isActive => {
                if (!isActive) {
                    this._disableEventThreshold(true);
                } else {
                    this._enableEventThreshold();
                }
            });
        }

        socket.on('getVersion', callback => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'getVersion', callback)) {
                if (typeof callback === 'function') {
                    callback(null, this.adapter.version, this.adapter.name);
                } else {
                    this.adapter.log.warn('[getVersion] Invalid callback');
                }
            }
        });

        socket.on('getAdapterName', callback => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'getAdapterName', callback)) {
                if (typeof callback === 'function') {
                    callback(null, this.adapter.name);
                } else {
                    this.adapter.log.warn('[getAdapterName] Invalid callback');
                }
            }
        });

        socket.on('subscribe', (pattern, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'subscribe', callback, pattern)) {
                if (pattern && typeof pattern === 'object' && pattern instanceof Array) {
                    for (let p = 0; p < pattern.length; p++) {
                        this.subscribe(socket, 'stateChange', pattern[p]);
                    }
                } else {
                    this.subscribe(socket, 'stateChange', pattern);
                }
                if (this.adapter.log.level === 'debug') {
                    this._showSubscribes(socket, 'stateChange');
                }
                if (typeof callback === 'function') {
                    setImmediate(callback, null);
                }
            }
        });

        socket.on('unsubscribe', (pattern, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'unsubscribe', callback, pattern)) {
                if (pattern && typeof pattern === 'object' && pattern instanceof Array) {
                    for (let p = 0; p < pattern.length; p++) {
                        this.unsubscribe(socket, 'stateChange', pattern[p]);
                    }
                } else {
                    this.unsubscribe(socket, 'stateChange', pattern);
                }
                if (this.adapter.log.level === 'debug') {
                    this._showSubscribes(socket, 'stateChange');
                }
                if (typeof callback === 'function') {
                    setImmediate(callback, null);
                }
            }
        });

        // new History
        socket.on('getHistory', (id, options, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'getStateHistory', callback, id)) {
                if (typeof options === 'string') {
                    options = {
                        instance: options
                    };
                }
                options = options || {};
                options.user = socket._acl.user;
                this.adapter.getHistory(id, options, (err, data, step, sessionId) => {
                    if (typeof callback === 'function') {
                        callback(err, data, step, sessionId);
                    } else {
                        this.adapter.log.warn('[getHistory] Invalid callback');
                    }
                });
            }
        });

        // HTTP
        socket.on('httpGet', (url, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'httpGet', callback, url)) {
                axios = axios || require('axios');
                this.adapter.log.debug('httpGet: ' + url);
                try {
                    axios(url, {responseType: 'arraybuffer'})
                        .then(result => callback(null, {status: result.status, statusText: result.statusText}, result.data))
                        .catch(error => callback(error));
                } catch (err) {
                    callback(err);
                }
            }
        });

        // commands
        socket.on('sendTo', (adapterInstance, command, message, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'sendTo', callback, command)) {
                this.adapter.sendTo(adapterInstance, command, message, callback);
            }
        });

        // following commands are protected and require the extra permissions
        const protectedCommands = ['cmdExec', 'getLocationOnDisk', 'getDiagData', 'getDevList', 'delLogs', 'writeDirAsZip', 'writeObjectsAsZip', 'readObjectsAsZip', 'checkLogging', 'updateMultihost', 'rebuildAdapter'];

        socket.on('sendToHost', (host, command, message, callback) => {
            // host can answer following commands: cmdExec, getRepository, getInstalled, getInstalledAdapter, getVersion, getDiagData, getLocationOnDisk, getDevList, getLogs, getHostInfo,
            // delLogs, readDirAsZip, writeDirAsZip, readObjectsAsZip, writeObjectsAsZip, checkLogging, updateMultihost
            if (this.updateSession(socket) && this.checkPermissions(socket, protectedCommands.includes(command) ? 'cmdExec' : 'sendToHost', callback, command)) {
                this.adapter.sendToHost(host, command, message, callback);
            }
        });

        socket.on('authEnabled', callback => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'authEnabled', callback)) {
                if (typeof callback === 'function') {
                    callback(this.settings.auth, (socket._acl.user || '').replace(/^system\.user\./, ''));
                } else {
                    this.adapter.log.warn('[authEnabled] Invalid callback');
                }
            }
        });

        // file operations
        socket.on('readFile', (_adapter, fileName, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'readFile', callback, fileName)) {
                this.adapter.readFile(_adapter, fileName, {user: socket._acl.user}, callback);
            }
        });

        socket.on('readFile64', (_adapter, fileName, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'readFile64', callback, fileName)) {
                this.adapter.readFile(_adapter, fileName, {user: socket._acl.user}, (err, buffer, type) => {
                    let data64;
                    if (buffer) {
                        if (type === 'application/json') {
                            data64 = Buffer.from(encodeURIComponent(buffer)).toString('base64');
                        } else {
                            if (typeof buffer === 'string') {
                                data64 = Buffer.from(buffer).toString('base64');
                            } else {
                                data64 = buffer.toString('base64');
                            }
                        }
                    }

                    //Convert buffer to base 64
                    if (typeof callback === 'function') {
                        callback(err, data64 || '', type);
                    } else {
                        this.adapter.log.warn('[readFile64] Invalid callback');
                    }
                });
            }
        });

        socket.on('writeFile64', (_adapter, fileName, data64, options, callback) => {
            if (typeof options === 'function') {
                callback = options;
                options = {user: socket._acl.user};
            }
            options = options || {};
            options.user = socket._acl.user;

            if (this.updateSession(socket) && this.checkPermissions(socket, 'writeFile64', callback, fileName)) {
                if (!data64) {
                    return typeof callback === 'function' && callback('No data provided');
                }
                //Convert base 64 to buffer
                const buffer = Buffer.from(data64, 'base64');
                this.adapter.writeFile(_adapter, fileName, buffer, options, err =>
                    typeof callback === 'function' && callback(err));
            }
        });

        socket.on('writeFile', (_adapter, fileName, data, options, callback) => {
            if (typeof options === 'function') {
                callback = options;
                options = {user: socket._acl.user};
            }
            options = options || {};
            options.user = socket._acl.user;
            if (this.updateSession(socket) && this.checkPermissions(socket, 'writeFile', callback, fileName)) {
                this.adapter.writeFile(_adapter, fileName, data, options, callback);
            }
        });

        socket.on('unlink', (_adapter, name, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'unlink', callback, name)) {
                this.unlink(_adapter, name, {user: socket._acl.user})
                    .then(() => callback && callback())
                    .catch(error => callback && callback(error));
            }
        });

        socket.on('deleteFile', (_adapter, name, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'unlink', callback, name)) {
                this.adapter.unlink(_adapter, name, {user: socket._acl.user}, callback);
            }
        });

        socket.on('deleteFolder', (_adapter, name, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'unlink', callback, name)) {
                this.unlink(_adapter, name, {user: socket._acl.user})
                    .then(() => callback && callback())
                    .catch(error => callback && callback(error));
            }
        });

        socket.on('rename', (_adapter, oldName, newName, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'rename', callback, oldName)) {
                this.rename(_adapter, oldName, newName, {user: socket._acl.user})
                    .then(() => callback && callback())
                    .catch(error => callback && callback(error));
            }
        });

        socket.on('mkdir', (_adapter, dirName, callback) => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'mkdir', callback, dirName)) {
                this.adapter.mkdir(_adapter, dirName, {user: socket._acl.user}, callback);
            }
        });

        socket.on('readDir', (_adapter, dirName, options, callback) => {
            if (typeof options === 'function') {
                callback = options;
                options = {};
            }
            options = options || {};
            options.user = socket._acl.user;

            if (options.filter === undefined) {
                options.filter = true;
            }

            if (this.updateSession(socket) && this.checkPermissions(socket, 'readDir', callback, dirName)) {
                this.adapter.readDir(_adapter, dirName, options, callback);
            }
        });

        socket.on('chmodFile', (_adapter, dirName, options, callback) => {
            if (typeof options === 'function') {
                callback = options;
                options = {};
            }
            options = options || {};
            options.user = socket._acl.user;

            if (options.filter === undefined) {
                options.filter = true;
            }

            if (this.updateSession(socket) && this.checkPermissions(socket, 'chmodFile', callback, dirName)) {
                this.adapter.chmodFile(_adapter, dirName, options, callback);
            }
        });

        // connect/disconnect
        socket.on('disconnect', error => {
            this.adapter.log.info(`<== Disconnect ${socket._acl.user} from ${this.getClientAddress(socket)} ${socket._name || ''}`);
            this._unsubscribeSocket(socket, 'stateChange');
            this._unsubscribeSocket(socket, 'objectChange');
            this._unsubscribeSocket(socket, 'log');
            this.infoTimeout = this.infoTimeout || setTimeout(() => {this.infoTimeout = null; this.updateConnectedInfo()}, 1000);

            if (socket._sessionTimer) {
                clearTimeout(socket._sessionTimer);
                socket._sessionTimer = null;
            }

            // if client mode
            if (!socket.conn) {
                socket._apiKeyOk = false;
                this.emit && this.emit('disconnect', error);
            }
        });

        socket.on('logout', callback => {
            this.adapter.destroySession(socket._sessionID, callback);
        });

        socket.on('listPermissions', callback => {
            if (this.updateSession(socket)) {
                if (typeof callback === 'function') {
                    callback(IOSocket.COMMANDS_PERMISSIONS);
                } else {
                    this.adapter.log.warn('[listPermissions] Invalid callback');
                }
            }
        });

        socket.on('getUserPermissions', callback => {
            if (this.updateSession(socket) && this.checkPermissions(socket, 'getUserPermissions', callback)) {
                if (typeof callback === 'function') {
                    callback(null, socket._acl);
                } else {
                    this.adapter.log.warn('[getUserPermissions] Invalid callback');
                }
            }
        });

        if (typeof this.settings.extensions === 'function') {
            this.settings.extensions(socket);
        }

        // if client mode
        if (!socket.conn) {
            socket._apiKeyOk = false;

            socket.on('cloudDisconnect', err => {
                err && this.adapter.log.warn('User disconnected from cloud: ' + err);
                this._unsubscribeSocket(socket, 'stateChange');
                this._unsubscribeSocket(socket, 'objectChange');
                this._unsubscribeSocket(socket, 'log');
                this.emit('cloudDisconnect');
            });

            socket.on('cloudConnect', () => {
                // do not auto-subscribe. The client must resubscribe all states anew
                // this._subscribeSocket(socket, 'stateChange');
                // this._subscribeSocket(socket, 'objectChange');
                // this._subscribeSocket(socket, 'log');
                this.emit('cloudConnect');
            });

            socket.on('cloudCommand', (cmd, data) => {
                if (cmd === 'stop') {
                    this.stopAdapter(data);
                } else if (cmd === 'redirect') {
                    this.redirectAdapter(data);
                } else if (cmd === 'wait') {
                    this.waitForConnect(data || 30);
                }
            });

            // only active in client mode
            socket.on('connect', () => {
                this.adapter.log.debug('Connected. Check api key...');
                socket._apiKeyOk = false;

                // 2018_01_20 workaround for pro: Remove it after next pro maintenance
                if (this.settings.apikey && this.settings.apikey.startsWith('@pro_')) {
                    socket._apiKeyOk = true;
                    this.emit && this.emit('connect');
                }

                // send api key if exists
                socket.emit('apikey', this.settings.apikey, this.settings.version, this.settings.uuid, (err, instructions) => {
                    // instructions = {
                    //     validTill: '2018-03-14T01:01:01.567Z',
                    //     command: 'wait' | 'stop' | 'redirect'
                    //     data: some data for command (URL for redirect or seconds for wait'

                    if (instructions) {
                        if (typeof instructions !== 'object') {
                            this.adapter.setState('info.remoteTill', new Date(instructions).toISOString(), true);
                        } else {
                            if (instructions.validTill) {
                                this.adapter.setState('info.remoteTill', new Date(instructions.validTill).toISOString(), true);
                            }
                            if (instructions.command === 'stop') {
                                this.stopAdapter(instructions.data);
                            } else if (instructions.command === 'redirect') {
                                this.redirectAdapter(instructions.data);
                            } else if (instructions.command === 'wait') {
                                this.waitForConnect(instructions.data || 30);
                            }
                        }
                    }

                    if (!err) {
                        this.adapter.log.debug('API KEY OK');
                        socket._apiKeyOk = true;

                        this.emit && this.emit('connect');
                    } else {
                        if (err.includes('Please buy remote access to use pro.')) {
                            this.stopAdapter('Please buy remote access to use pro.');
                        }
                        this.adapter.log.error(err);
                        socket.close(); // disconnect
                    }
                });

                if (socket._sessionID) {
                    this.adapter.getSession(socket._sessionID, obj => {
                        if (obj && obj.passport) {
                            socket._acl.user = obj.passport.user;
                        } else {
                            socket._acl.user = '';
                            socket.emit(IOSocket.COMMAND_RE_AUTHENTICATE);
                            if (!this.noDisconnect) {
                                socket.disconnect();
                            }
                        }
                        if (socket._authPending) {
                            socket._authPending(!!socket._acl.user, true);
                            delete socket._authPending;
                        }
                    });
                }

                this._subscribeSocket(socket, 'stateChange');
                this._subscribeSocket(socket, 'objectChange');
                this._subscribeSocket(socket, 'log');
            });

            /*socket.on('reconnect', attempt => {
                this.adapter.log.debug('Connected after attempt ' + attempt);
            });
            socket.on('reconnect_attempt', attempt => {
                this.adapter.log.debug('reconnect_attempt');
            });
            socket.on('connect_error', error => {
                this.adapter.log.debug('connect_error: ' + error);
            });
            socket.on('connect_timeout', error => {
                this.adapter.log.debug('connect_timeout');
            });
            socket.on('reconnect_failed', error => {
                this.adapter.log.debug('reconnect_failed');
            });*/
        } else {
            // if server mode
            const sessionId = this.getSessionID(socket);
            if (sessionId) {
                socket._secure    = true;
                socket._sessionID = sessionId;
                // Get user for session
                this._store && this._store.get(socket._sessionID, (err, obj) => {
                    if (!obj || !obj.passport) {
                        socket._acl.user = '';
                        socket.emit(IOSocket.COMMAND_RE_AUTHENTICATE);
                        if (!this.noDisconnect) {
                            socket.disconnect();
                        }
                    }
                    if (socket._authPending) {
                        socket._authPending(!!socket._acl.user, true);
                        delete socket._authPending;
                    }
                });
            }

            this._subscribeSocket(socket, 'stateChange');
            this._subscribeSocket(socket, 'objectChange');
            this._subscribeSocket(socket, 'log');
        }

        cb && cb();
    }

    updateConnectedInfo() {
        if (this.infoTimeout) {
            clearTimeout(this.infoTimeout);
            this.infoTimeout = null;
        }
        if (this.server && this.server.sockets) {
            const clientsArray = [];
            if (this.server) {
                const clients = this.server.sockets.connected;

                for (const i in clients) {
                    if (Object.prototype.hasOwnProperty.call(clients, i)) {
                        clientsArray.push(clients[i]._name || 'noname');
                    }
                }
            }
            const text = `[${clientsArray.length}]${clientsArray.join(', ')}`;
            this.adapter.setState('info.connected', text, true);
        }
    }

    publishAll(type, id, obj) {
        if (id === undefined) {
            console.log('Problem');
        }

        if (!this.server || ! this.server.sockets) {
            return;
        }

        const clients = this.server.sockets.connected;

        for (const i in clients) {
            if (Object.prototype.hasOwnProperty.call(clients, i)) {
                this.publish(clients[i], type, id, obj);
            }
        }
    };

    sendLog(obj) {
        // TODO Build in some threshold
        if (this.server && this.server.sockets) {
            this.server.sockets.emit('log', obj);
        }
    }

    close() {
        // IO server will be closed
        try {
            this.server && this.server.close && this.server.close();
            this.server = null;
        } catch (e) {
            // ignore
        }
        this.thersholdInterval && clearInterval(this.thersholdInterval);
        this.thersholdInterval = null;
    }
}

module.exports = IOSocket;
