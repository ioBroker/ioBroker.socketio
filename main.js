/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

var socketio =   require('socket.io');
var fs =         require('fs');
var request =    require('request');
var config =     JSON.parse(fs.readFileSync(__dirname + '/../../conf/iobroker.json'));

var webServer =  null;
var objects =    null;
var states =     null;

var adapter = require(__dirname + '/../../lib/adapter.js')({
    name:           'socketio',
    install: function (callback) {
        if (typeof callback === 'function') callback();
    },
    objectChange: function (id, obj) {
        if (objects) {
            objects[id] = obj;
            if (webServer) webServer.io.sockets.emit('objectChange', id, obj);
        }
    },
    stateChange: function (id, state) {
        if (states) {
            states[id] = state;
            if (webServer) webServer.io.sockets.emit('stateChange', id, state);
        }
    },
    unload: function (callback) {
        try {
            adapter.log.info("terminating http" + (webServer.settings.secure ? "s" : "") + " server on port " + webServer.settings.port);
            webServer.io.close();

            callback();
        } catch (e) {
            callback();
        }
    },
    ready: function () {
        main();
    }
});

function main() {
    webServer = initWebServer(adapter.config);
}

//settings: {
//    "port":   8080,
//    "auth":   false,
//    "secure": false,
//    "bind":   "0.0.0.0", // "::"
//    "cache":  false
//}
function initWebServer(settings) {

    var server = {
        app:       null,
        server:    null,
        io:        null,
        settings:  settings
    };

    if (settings.port) {
        var options = null;

        if (settings.secure) {
            try {
                options = {
                    // ToDO read certificates from CouchDB (May be upload in admin configuration page)
                    key:  fs.readFileSync(__dirname + '/cert/privatekey.pem'),
                    cert: fs.readFileSync(__dirname + '/cert/certificate.pem')
                };
            } catch (err) {
                adapter.log.error(err.message);
            }
            if (!options) return null;
        }

        adapter.getPort(settings.port, function (port) {
            if (port != settings.port && !adapter.config.findNextPort) {
                adapter.log.error('port ' + settings.port + ' already in use');
                process.exit(1);
            }
            //server.server.listen(port);

            server.io = socketio.listen(settings.port, (settings.bind && settings.bind != "0.0.0.0") ? settings.bind : undefined);
            if (settings.auth) {
                server.io.use(function (socket, next) {
                    if (!socket.request._query.user || !socket.request._query.pass) {
                        console.log("No password or username!");
                        next(new Error('Authentication error'));
                    } else {
                        adapter.checkPassword(socket.request._query.user, socket.request._query.pass, function (res) {
                            if (res) {
                                console.log("Logged in: " + socket.request._query.user + ', ' + socket.request._query.pass);
                                return next();
                            } else {
                                console.log("Invalid password or user name: " + socket.request._query.user + ', ' + socket.request._query.pass);
                                next(new Error('Invalid password or user name'));
                            }
                        });
                    }
                });
            }

            server.io.on('connection', initSocket);

            adapter.log.info((settings.secure ? 'Secure ' : '') + 'socket.io server listening on port ' + port);
        });
    } else {
        adapter.log.error('port missing');
        process.exit(1);
    }

    return server;
}

function initSocket(socket) {
    if (adapter.config.auth) {
        var user = null;
        socketEvents(socket, user);
    } else {
        socketEvents(socket);
    }
}

function socketEvents(socket, user) {

    // TODO Check if user may create and delete objects and so on

    /*
     *      objects
     */
    socket.on('getObject', function (id, callback) {
        adapter.getForeignObject(id, callback);
    });

    socket.on('getObjects', function (callback) {
        if (!states) {
            adapter.getForeignObjects('*', function (err, obj) {
                states = obj;
                if (callback) callback(null, states);
            });
        } else {
            callback(null, objects);
        }
    });

    socket.on('subscribe', function (pattern) {
        adapter.subscribeForeignStates(pattern);
    });

    socket.on('unsubscribe', function (pattern) {
        adapter.unsubscribeForeignStates(pattern);
    });

    socket.on('getObjectView', function (design, search, params, callback) {
        console.log('getObjectView', design, search, params);
        adapter.objects.getObjectView(design, search, params, callback);
    });

    /*socket.on('setObject', function (id, obj, callback) {
        adapter.setForeignObject(id, obj, callback);
    });

    socket.on('extendObject', function (id, obj, callback) {
        adapter.extendForeignObject(id, obj, callback);
    });

    socket.on('getHostByIp', function (ip, callback) {
        adapter.objects.getObjectView('system', 'host', {}, function (err, data) {
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
        if (!states) {
            adapter.getForeignStates('*', function (err, obj) {
                states = obj;
                if (callback) callback(null, states);
            });
        } else {
            if (callback) callback(null, states);
        }
    });

    socket.on('getState', function (id, callback) {
        if (!states) {
            adapter.getForeignStates('*', function (err, obj) {
                states = obj;
                if (callback) callback(null, states[id]);
            });
        } else {
            callback(null, states[id]);
        }
    });

    socket.on('setState', function (id, state, callback) {
        if (typeof state !== 'object') state = {val: state};
        adapter.setForeignState(id, state, function (err, res) {
            if (typeof callback === 'function') callback(err, res);
        });
    });

    /*
     *      History
     */
    socket.on('getStateHistory', function (id, start, end, callback) {
        adapter.getForeignStateHistory(id, start, end, callback);
    });

    // HTTP
    socket.on('httpGet', function (url, callback) {
        request(url, callback);
    });

    // iobroker commands
    socket.on('sendTo', function (adapterInstance, command, message, callback) {
        adapter.sendTo(adapterInstance, command, message, callback);
    });

    socket.on('authEnabled', function (callback) {
        callback(adapter.config.auth);
    });
}