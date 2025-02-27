"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketIoAdapter = void 0;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const express_1 = __importDefault(require("express"));
const session = __importStar(require("express-session"));
const socket_io_1 = __importDefault(require("socket.io"));
const bodyParser = __importStar(require("body-parser"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const adapter_core_1 = require("@iobroker/adapter-core"); // Get common adapter utils
const webserver_1 = require("@iobroker/webserver");
const socketIO_1 = require("./lib/socketIO");
class SocketIoAdapter extends adapter_core_1.Adapter {
    server = {
        server: null,
        io: null,
        app: null,
    };
    socketIoFile;
    store = null;
    secret = 'Zgfr56gFe87jJOM';
    certificates;
    constructor(options = {}) {
        super({
            ...options,
            name: 'socketio',
            unload: callback => this.onUnload(callback),
            message: obj => this.onMessage(obj),
            stateChange: (id, state) => {
                this.server?.io?.publishAll('stateChange', id, state);
            },
            ready: () => this.main(),
            objectChange: (id, obj) => {
                this.server?.io?.publishAll('objectChange', id, obj);
            },
            fileChange: (id, fileName, size) => {
                this.server?.io?.publishFileAll(id, fileName, size);
            },
        });
        this.socketIoFile = (0, node_fs_1.readFileSync)(`${__dirname}/lib/socket.io.js`).toString('utf-8');
        this.on('log', (obj) => this.server?.io?.sendLog(obj));
    }
    onUnload(callback) {
        try {
            void this.setState('info.connected', '', true);
            void this.setState('info.connection', false, true);
            this.log.info(`terminating http${this.config.secure ? 's' : ''} server on port ${this.config.port}`);
            this.server.io?.close();
            this.server.server?.close();
        }
        catch {
            // ignore
        }
        callback();
    }
    onMessage(obj) {
        if (obj?.command !== 'im') {
            // if not instance message
            return;
        }
        // to make messages shorter, we code the answer as:
        // m - message type
        // s - socket ID
        // d - data
        this.server?.io?.publishInstanceMessageAll(obj.from, obj.message.m, obj.message.s, obj.message.d);
    }
    detectUser = (req, res, next) => {
        if (this.config.auth) {
            // Try to extract user name from query or access token
            if (req.query?.user && req.query.pass) {
                // Check user and password
                void this.checkPassword(req.query.user, req.query.pass, (res, user) => {
                    if (res) {
                        // Store it
                        req.user = user.startsWith(`system.adapter.`) ? user : `system.adapter.${user}`;
                    }
                    next();
                });
                return;
            }
            else if (req.query?.token || req.headers.authorization?.startsWith('Bearer ')) {
                const accessToken = req.query?.token || req.headers.authorization?.split(' ')[1];
                void this.getSession(`a:${accessToken}`, obj => {
                    if (obj?.user) {
                        req.user = obj.user.startsWith(`system.adapter.`) ? obj.user : `system.adapter.${obj.user}`;
                    }
                    next();
                });
                return;
            }
            else if (req.headers.cookie) {
                const parts = req.headers.cookie.split(' ');
                for (let i = 0; i < parts.length; i++) {
                    const pair = parts[i].split('=');
                    if (pair[0] === 'access_token') {
                        void this.getSession(`a:${pair[1]}`, obj => {
                            if (obj?.user) {
                                req.user = obj.user.startsWith(`system.adapter.`)
                                    ? obj.user
                                    : `system.adapter.${obj.user}`;
                            }
                            next();
                        });
                        return;
                    }
                }
            }
            else if (req.headers.authorization?.startsWith('Basic ')) {
                const parts = Buffer.from(req.headers.authorization.split(' ')[1], 'base64')
                    .toString('utf8')
                    .split(':');
                const user = parts.shift();
                const pass = parts.join(':');
                if (user && pass) {
                    void this.checkPassword(user, pass, (res, user) => {
                        if (res) {
                            // Store it
                            req.user = user.startsWith(`system.adapter.`) ? user : `system.adapter.${user}`;
                        }
                        next();
                    });
                    return;
                }
            }
        }
        else {
            req.user = this.config.defaultUser || 'system.user.admin';
        }
        next();
    };
    serveStaticFile = (req, res, next) => {
        const url = req.url.split('?')[0];
        if (this.config.auth && (!url || url === '/' || url === '/index.html')) {
            if (!req.user || url.includes('..')) {
                res.setHeader('Content-Type', 'text/html');
                res.send((0, node_fs_1.readFileSync)(`${__dirname}/../public/index.html`));
                return;
            }
            if ((0, node_fs_1.existsSync)(`${__dirname}/../example/index.html`)) {
                res.setHeader('Content-Type', 'text/html');
                res.send((0, node_fs_1.readFileSync)(`${__dirname}/../example/index.html`));
                return;
            }
        }
        else if (!url.includes('..')) {
            if ((0, node_fs_1.existsSync)(`${__dirname}/../example${url === '/' ? '/index.html' : url}`)) {
                res.setHeader('Content-Type', url === '/' || url.endsWith('.html') ? 'text/html' : 'text/javascript');
                res.send((0, node_fs_1.readFileSync)(`${__dirname}/../example${url === '/' ? '/index.html' : url}`));
                return;
            }
        }
        // Special case for "example" file
        if (url === '/name') {
            // User can ask server if authentication enabled
            res.setHeader('Content-Type', 'plain/text');
            res.send(this.namespace);
        }
        else if (url === '/auth') {
            // User can ask server if authentication enabled
            res.setHeader('Content-Type', 'application/json');
            res.json({ auth: this.config.auth });
        }
        else if (this.config.auth && (!url || url === '/' || url === '/login.html' || url === '/login')) {
            res.setHeader('Content-Type', 'text/html');
            res.send((0, node_fs_1.readFileSync)(`${__dirname}/../public/index.html`));
        }
        else if (url === '/manifest.json') {
            res.setHeader('Content-Type', 'application/json');
            res.send((0, node_fs_1.readFileSync)(`${__dirname}/../public/manifest.json`));
        }
        else if (url === '/favicon.ico') {
            res.setHeader('Content-Type', 'image/x-icon');
            res.send((0, node_fs_1.readFileSync)(`${__dirname}/../public/favicon.ico`));
        }
        else if (url?.includes('socket.io.js')) {
            res.setHeader('Content-Type', 'application/javascript');
            res.send(this.socketIoFile);
        }
        else {
            next();
        }
    };
    initWebServer() {
        this.config.port = parseInt(this.config.port, 10) || 0;
        if (this.config.port) {
            if (this.config.secure && !this.certificates) {
                // Error: authentication is enabled but no certificates found
                return;
            }
            this.config.ttl = parseInt(this.config.ttl, 10) || 3600;
            this.config.forceWebSockets = this.config.forceWebSockets || false;
            if (this.config.auth) {
                const AdapterStore = adapter_core_1.commonTools.session(session, this.config.ttl);
                // Authentication checked by server itself
                this.store = new AdapterStore({ adapter: this });
                this.config.forceWebSockets = this.config.forceWebSockets || false;
            }
            this.getPort(this.config.port, !this.config.bind || this.config.bind === '0.0.0.0' ? undefined : this.config.bind || undefined, async (port) => {
                if (parseInt(port, 10) !== this.config.port) {
                    this.log.error(`port ${this.config.port} already in use`);
                    return this.terminate
                        ? this.terminate(adapter_core_1.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                        : process.exit(adapter_core_1.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                }
                this.config.port = port;
                this.server.app = (0, express_1.default)();
                // Detect user
                this.server.app.use(this.detectUser);
                // Deliver example and socket.io.js file
                this.server.app.use(this.serveStaticFile);
                try {
                    const webServer = new webserver_1.WebServer({
                        adapter: this,
                        secure: this.config.secure,
                        app: this.server.app,
                    });
                    // initialize and you can use your server as known
                    this.server.server = await webServer.init();
                    if (this.config.auth) {
                        // Install OAuth2 handler
                        this.server.app.use((0, cookie_parser_1.default)());
                        this.server.app.use(bodyParser.urlencoded({ extended: true }));
                        this.server.app.use(bodyParser.json());
                        // Activate OAuth2 server
                        (0, webserver_1.createOAuth2Server)(this, {
                            app: this.server.app,
                            secure: this.config.secure,
                            accessLifetime: parseInt(this.config.ttl, 10) || 3600,
                            refreshLifetime: 60 * 60 * 24 * 7, // 1 week (Maybe adjustable?)
                            loginPage: '/login',
                        });
                    }
                }
                catch (err) {
                    this.log.error(`Cannot create webserver: ${err}`);
                    this.terminate
                        ? this.terminate(adapter_core_1.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                        : process.exit(adapter_core_1.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                    return;
                }
                if (!this.server.server) {
                    this.log.error(`Cannot create webserver`);
                    this.terminate
                        ? this.terminate(adapter_core_1.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                        : process.exit(adapter_core_1.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                    return;
                }
                this.server.app.use((_req, res) => {
                    res.status(404);
                    res.send('Not found');
                });
                let serverListening = false;
                this.server.server.on('error', e => {
                    if (e.toString().includes('EACCES') && port <= 1024) {
                        this.log.error(`node.js process has no rights to start server on the port ${port}.\n` +
                            'Do you know that on linux you need special permissions for ports under 1024?\n' +
                            'You can call in shell following scrip to allow it for node.js: "iobroker fix"');
                    }
                    else {
                        this.log.error(`Cannot start server on ${this.config.bind || '0.0.0.0'}:${port}: ${e}`);
                    }
                    if (!serverListening) {
                        this.terminate
                            ? this.terminate(adapter_core_1.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                            : process.exit(adapter_core_1.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                    }
                });
                // Start the web server
                this.server.server.listen(this.config.port, !this.config.bind || this.config.bind === '0.0.0.0' ? undefined : this.config.bind || undefined, () => {
                    void this.setState('info.connection', true, true);
                    serverListening = true;
                });
                const settings = {
                    ttl: this.config.ttl,
                    port: this.config.port,
                    secure: this.config.secure,
                    auth: this.config.auth,
                    defaultUser: this.config.defaultUser,
                    language: this.config.language,
                    secret: this.secret,
                    crossDomain: true,
                    compatibilityV2: this.config.compatibilityV2,
                    forceWebSockets: this.config.forceWebSockets,
                };
                this.server.io = new socketIO_1.SocketIO(settings, this);
                const socketOptions = {
                    pingInterval: 120000,
                    pingTimeout: 30000,
                    cors: {
                        // for socket.4.x
                        origin: `*`,
                        allowedHeaders: ['*'],
                        credentials: true,
                    },
                };
                this.server.io.start(this.server.server, 
                // @ts-expect-error fix later
                socket_io_1.default, { store: this.store, secret: this.secret }, socketOptions);
            });
        }
        else {
            this.log.error('port missing');
            this.terminate
                ? this.terminate(adapter_core_1.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                : process.exit(adapter_core_1.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
        }
    }
    async main() {
        if (this.config.auth) {
            // Generate secret for session manager
            const systemConfig = await this.getForeignObjectAsync('system.config');
            if (systemConfig) {
                if (!systemConfig.native?.secret) {
                    systemConfig.native = systemConfig.native || {};
                    await new Promise(resolve => (0, node_crypto_1.randomBytes)(24, (_err, buf) => {
                        this.secret = buf.toString('hex');
                        void this.extendForeignObject('system.config', { native: { secret: this.secret } });
                        resolve();
                    }));
                }
                else {
                    this.secret = systemConfig.native.secret;
                }
            }
            else {
                this.log.error('Cannot find object system.config');
            }
        }
        if (this.config.secure) {
            // Load certificates
            await new Promise(resolve => this.getCertificates(undefined, undefined, undefined, (_err, certificates) => {
                this.certificates = certificates;
                resolve();
            }));
        }
        this.initWebServer();
    }
}
exports.SocketIoAdapter = SocketIoAdapter;
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new SocketIoAdapter(options);
}
else {
    // otherwise start the instance directly
    (() => new SocketIoAdapter())();
}
//# sourceMappingURL=main.js.map