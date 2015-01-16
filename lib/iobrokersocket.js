/* jshint -W097 */// jshint strict:false
/*jslint node: true */
/*jshint -W061 */
"use strict";

var socketio = require('socket.io');
var request  = null;

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

        that.server.on('connection', initSocket);

        that.adapter.log.info((settings.secure ? 'Secure ' : '') + 'socket.io server listening on port ' + settings.port);

        if (!that.infoTimeout) that.infoTimeout = setTimeout(updateConnectedInfo, 1000);
    })();

    function initSocket(socket) {
        if (that.adapter.config.auth) {
            var user = null;
            socketEvents(socket, user);
        } else {
            socketEvents(socket);
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
        //console.log(socket.id + ' subscribe ' + pattern);
        socket._subscribe = socket._subscribe || {};
        if (!that.subscribes[type]) that.subscribes[type] = {};

        var s = socket._subscribe[type] = socket._subscribe[type] || [];
        for (var i = 0; i < s.length; i++) {
            if (s[i].pattern == pattern) {
                //console.log(socket.id + ' subscribe ' + pattern + ' found');
                return;
            }
        }

        s.push({pattern: pattern, regex: new RegExp(pattern2RegEx(pattern))});

        if (that.subscribes[type][pattern] === undefined){
            that.subscribes[type][pattern] = 1;
            if (type == 'stateChange') {
                //console.log(socket.id + ' subscribeForeignStates ' + pattern);
                that.adapter.subscribeForeignStates(pattern);
            }
        } else {
            that.subscribes[type][pattern]++;
            //console.log(socket.id + ' subscribeForeignStates ' + pattern + ' ' + that.subscribes[type][pattern]);
        }
    }

    function unsubscribe(socket, type, pattern) {

        //console.log(socket.id + ' unsubscribe ' + pattern);
        if (!that.subscribes[type]) that.subscribes[type] = {};

        if (!socket._subscribe || !socket._subscribe[type]) return;
        for (var i = 0; i < socket._subscribe[type].length; i++) {
            if (socket._subscribe[type][i].pattern == pattern) {

                // Remove pattern from global list
                if (that.subscribes[type][pattern] !== undefined){
                    that.subscribes[type][pattern]--;
                    if (!that.subscribes[type][pattern]) {
                        if (type == 'stateChange') {
                            //console.log(socket.id + ' unsubscribeForeignStates ' + pattern);
                            that.adapter.unsubscribeForeignStates(pattern);
                        }
                        delete that.subscribes[type][pattern];
                    } else {
                        //console.log(socket.id + ' unsubscribeForeignStates ' + pattern + ' ' + that.subscribes[type][pattern]);
                    }
                }

                delete socket._subscribe[type][i];
                return;
            }
        }
    }

    function unsubscribeSocket(socket, type) {
        //console.log(socket.id + ' unsubscribeSocket');
        if (!socket._subscribe || !socket._subscribe[type]) return;

        for (var i = 0; i < socket._subscribe[type].length; i++) {
            var pattern = socket._subscribe[type][i].pattern;
            if (that.subscribes[type][pattern] !== undefined){
                that.subscribes[type][pattern]--;
                if (!that.subscribes[type][pattern]) {
                    if (type == 'stateChange') {
                        //console.log(socket.id + ' unsubscribeForeignStates ' + pattern);
                        that.adapter.unsubscribeForeignStates(pattern);
                    }
                    delete that.subscribes[type][pattern];
                } else {
                    //console.log(socket.id + ' unsubscribeForeignStates ' + pattern + that.subscribes[type][pattern]);
                }
            }
        }
    }

    function subscribeSocket(socket, type) {
        //console.log(socket.id + ' subscribeSocket');
        if (!socket._subscribe || !socket._subscribe[type]) return;

        for (var i = 0; i < socket._subscribe[type].length; i++) {
            var pattern = socket._subscribe[type][i].pattern;
            if (that.subscribes[type][pattern] === undefined){
                that.subscribes[type][pattern] = 1;
                if (type == 'stateChange') {
                    //console.log(socket.id + ' subscribeForeignStates' + pattern);
                    that.adapter.subscribeForeignStates(pattern);
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
                socket.emit(type, id, obj);
                return;
            }
        }
    }

    function socketEvents(socket, user) {
        // TODO Check if user may create and delete objects and so on
        subscribeSocket(socket, 'stateChange');

        if (!that.infoTimeout) that.infoTimeout = setTimeout(updateConnectedInfo, 1000);


        socket.on('name', function (name) {
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
            that.adapter.getForeignObject(id, callback);
        });

        socket.on('getObjects', function (callback) {
            that.adapter.getForeignObjects('*', callback);
        });

        socket.on('subscribe', function (pattern) {
            subscribe(this, 'stateChange', pattern)
        });

        socket.on('unsubscribe', function (pattern) {
            unsubscribe(this, 'stateChange', pattern)
        });

        socket.on('getObjectView', function (design, search, params, callback) {
            that.adapter.objects.getObjectView(design, search, params, callback);
        });
        // TODO check user name
        socket.on('setObject', function (id, obj, callback) {
            that.adapter.setForeignObject(id, obj, callback);
        });
        /*
         socket.on('extendObject', function (id, obj, callback) {
         that.adapter.extendForeignObject(id, obj, callback);
         });

         socket.on('getHostByIp', function (ip, callback) {
         that.adapter.objects.getObjectView('system', 'host', {}, function (err, data) {
         if (data.rows.length) {
         for (var i = 0; i < data.rows.length; i++) {
         if (data.rows[i].value.native.hardware && data.rows[i].value.native.hardware.networkInterfaces) {
         var net = data.rows[i].value.native.hardware.networkInterfaces;
         for (var eth in net) {
         for (var j = 0; j < net[eth].length; j++) {
         if (net[eth][j].address == ip) {
         if (callback) callback(ip, data.rows[i].value);
         return;
         }
         }
         }
         }
         }
         }

         if (callback) callback(ip, null);
         });
         });*/

        /*
         *      states
         */
        socket.on('getStates', function (callback) {
            that.adapter.getForeignStates('*', callback);
        });

        socket.on('getState', function (id, callback) {
            that.adapter.getForeignState(id, callback);
        });
        // Todo check user name
        socket.on('setState', function (id, state, callback) {
            if (typeof state !== 'object') state = {val: state};
            that.adapter.setForeignState(id, state, function (err, res) {
                if (typeof callback === 'function') callback(err, res);
            });
        });

        socket.on('getVersion', function (callback) {
            if (typeof callback === 'function') callback(that.adapter.version);
        });

        /*
         *      History
         */
        socket.on('getStateHistory', function (id, start, end, callback) {
            that.adapter.getForeignStateHistory(id, start, end, callback);
        });

        // HTTP
        socket.on('httpGet', function (url, callback) {
            if (!request) request = require('request');

            request(url, callback);
        });

        // iobroker commands
        // Todo check user name
        socket.on('sendTo', function (adapterInstance, command, message, callback) {
            that.adapter.sendTo(adapterInstance, command, message, callback);
        });

        socket.on('authEnabled', function (callback) {
            callback(that.adapter.config.auth);
        });

        socket.on('readFile', function (_adapter, fileName, callback) {
            that.adapter.readFile(_adapter, fileName, callback);
        });

        socket.on('readFile64', function (_adapter, fileName, callback) {
            that.adapter.readFile(_adapter, fileName, function (err, buffer) {
                var data64;
                if (buffer) {
                    data64 = buffer.toString('base64');
                }
                //Convert buffer to base 64
                if (callback) {
                    callback(err, data64);
                }
            });
        });

        socket.on('writeFile64', function (_adapter, fileName, data64, callback) {
            //Convert base 64 to buffer
            var buffer = new Buffer(data64, 'base64');
            that.adapter.writeFile(_adapter, fileName, buffer, function (err) {
                if (callback) {
                    callback(err);
                }
            });
        });

        socket.on('readDir', function (_adapter, dirName, callback) {
            that.adapter.readDir(_adapter, dirName, callback);
        });

        socket.on('disconnect', function () {
            //console.log('disonnect');
            unsubscribeSocket(this, 'stateChange');
            if (!that.infoTimeout) that.infoTimeout = setTimeout(updateConnectedInfo, 1000);
        });

        socket.on('reconnect', function () {
            //console.log('reconnect');
            subscribeSocket(this, 'stateChange');
        });

        // TODO Check authorisation
        socket.on('writeFile', function (_adapter, fileName, data, callback) {
            that.adapter.writeFile(_adapter, fileName, data, callback);
        });
        socket.on('unlink', function (_adapter, name, callback) {
            that.adapter.unlink(_adapter, name, callback);
        });
        socket.on('rename', function (_adapter, oldName, newName, callback) {
            that.adapter.rename(_adapter, oldName, newName, callback);
        });
        socket.on('mkdir', function (_adapter, dirname, callback) {
            that.adapter.mkdir(_adapter, dirname, callback);
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