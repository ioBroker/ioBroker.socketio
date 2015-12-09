/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

var utils          = require(__dirname + '/lib/utils'); // Get common adapter utils
var IOBrokerSocket = require(__dirname + '/lib/iobrokersocket.js');

var webServer =  null;
var subscribes = {};

var adapter = utils.adapter({
    name: 'socketio',
    install: function (callback) {
        if (typeof callback === 'function') callback();
    },
    objectChange: function (id, obj) {
        if (webServer && webServer.io) {
            webServer.io.publishAll('objectChange', id, obj);
        }
    },
    stateChange: function (id, state) {
        if (webServer && webServer.io) {
            webServer.io.publishAll('stateChange', id, state);
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
    if (adapter.config.secure) {
        // Load certificates
        adapter.getForeignObject('system.certificates', function (err, obj) {
            if (err || !obj ||
                !obj.native.certificates ||
                !adapter.config.certPublic ||
                !adapter.config.certPrivate ||
                !obj.native.certificates[adapter.config.certPublic] ||
                !obj.native.certificates[adapter.config.certPrivate]
            ) {
                adapter.log.error('Cannot enable secure web server, because no certificates found: ' + adapter.config.certPublic + ', ' + adapter.config.certPrivate);
            } else {
                adapter.config.certificates = {
                    key:  obj.native.certificates[adapter.config.certPrivate],
                    cert: obj.native.certificates[adapter.config.certPublic]
                };

            }
            webServer = initWebServer(adapter.config);
        });
    } else {
        webServer = initWebServer(adapter.config);
    }
}

//settings: {
//    "port":   8080,
//    "auth":   false,
//    "secure": false,
//    "bind":   "0.0.0.0", // "::"
//}
function initWebServer(settings) {

    var server = {
        app:       null,
        server:    null,
        io:        null,
        settings:  settings
    };

    if (settings.port) {
        var taskCnt = 0;

        if (settings.secure) {
            if (!settings.certificates) {
                return null;
            }
            if (settings.auth) {

            }
        }

        adapter.getPort(settings.port, function (port) {
            if (port != settings.port && !adapter.config.findNextPort) {
                adapter.log.error('port ' + settings.port + ' already in use');
                process.exit(1);
            }
            settings.port = port;
            //server.server.listen(port);
            if (settings.secure) {
                if (!settings.certificates) return;
                server.server = require('https').createServer(settings.certificates, function (req, res) {
                    res.writeHead(501);
                    res.end('Not Implemented');
                }).listen(settings.port, (settings.bind && settings.bind != "0.0.0.0") ? settings.bind : undefined);
            } else {
                server.server = require('http').createServer(function (req, res) {
                    res.writeHead(501);
                    res.end('Not Implemented');
                }).listen(settings.port, (settings.bind && settings.bind != "0.0.0.0") ? settings.bind : undefined);
            }

            settings.crossDomain = true;
			settings.ttl = settings.ttl || 3600;

            server.io = new IOBrokerSocket(server.server, settings, adapter);
        });
    } else {
        adapter.log.error('port missing');
        process.exit(1);
    }

    return server;
}
