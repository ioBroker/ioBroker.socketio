import { randomBytes } from 'node:crypto';
import type { IncomingMessage, OutgoingMessage, Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';

import * as session from 'express-session';
import socketio from 'socket.io';

import { Adapter, type AdapterOptions, commonTools, EXIT_CODES } from '@iobroker/adapter-core'; // Get common adapter utils
import { WebServer } from '@iobroker/webserver';
import type { SocketSettings, Store } from '@iobroker/socket-classes';

import type { SocketIoAdapterConfig } from './types';
import { SocketIO } from './lib/socketIO';

type Server = HttpServer | HttpsServer;

export class SocketIoAdapter extends Adapter {
    declare public config: SocketIoAdapterConfig;
    private server: {
        server: null | Server;
        io: null | SocketIO;
        app: ((req: IncomingMessage, res: OutgoingMessage) => void) | null;
    } = {
        server: null,
        io: null,
        app: null,
    };
    private readonly socketIoFile: string;
    private store: Store | null = null;
    private secret = 'Zgfr56gFe87jJOM';
    private certificates: ioBroker.Certificates | undefined;

    public constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: 'socketio',
            unload: callback => this.onUnload(callback),
            message: obj => this.onMessage(obj),
            stateChange: (id, state) => {
                this.server?.io?.publishAll('stateChange', id, state);
            },
            ready: () => this.main(),
            objectChange: (id: string, obj: ioBroker.Object | null | undefined): void => {
                this.server?.io?.publishAll('objectChange', id, obj);
            },
            fileChange: (id: string, fileName: string, size: number | null): void => {
                this.server?.io?.publishFileAll(id, fileName, size);
            },
        });

        this.socketIoFile = readFileSync(`${__dirname}/lib/socket.io.js`).toString('utf-8');
        this.on('log', (obj: ioBroker.LogMessage): void => this.server?.io?.sendLog(obj));
    }

    onUnload(callback: () => void): void {
        try {
            void this.setState('info.connected', '', true);
            void this.setState('info.connection', false, true);
            this.log.info(`terminating http${this.config.secure ? 's' : ''} server on port ${this.config.port}`);
            this.server.io?.close();
            this.server.server?.close();
        } catch {
            // ignore
        }
        callback();
    }

    onMessage(obj: ioBroker.Message): void {
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

    //this.config: {
    //    "port":   8080,
    //    "auth":   false,
    //    "secure": false,
    //    "bind":   "0.0.0.0", // "::"
    //}
    initWebServer(): void {
        this.config.port = parseInt(this.config.port as string, 10) || 0;

        if (this.config.port) {
            if (this.config.secure && !this.certificates) {
                // Error: authentication is enabled but no certificates found
                return;
            }

            this.config.ttl = parseInt(this.config.ttl as string, 10) || 3600;
            this.config.forceWebSockets = this.config.forceWebSockets || false;

            if (this.config.auth) {
                const AdapterStore = commonTools.session(session, this.config.ttl);
                // Authentication checked by server itself
                this.store = new AdapterStore({ adapter: this });
                this.config.forceWebSockets = this.config.forceWebSockets || false;
            }

            this.getPort(
                this.config.port,
                !this.config.bind || this.config.bind === '0.0.0.0' ? undefined : this.config.bind || undefined,
                async port => {
                    if (parseInt(port as unknown as string, 10) !== this.config.port) {
                        this.log.error(`port ${this.config.port} already in use`);
                        return this.terminate
                            ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                            : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                    }

                    this.config.port = port;
                    this.server.app = (req: IncomingMessage, res: OutgoingMessage): void => {
                        if (req.url?.includes('socket.io.js')) {
                            // @ts-expect-error
                            res.writeHead(200, { 'Content-Type': 'text/plain' });
                            res.end(this.socketIoFile);
                        } else {
                            // @ts-expect-error
                            res.writeHead(404);
                            res.end('Not found');
                        }
                    };

                    try {
                        const webServer = new WebServer({
                            adapter: this,
                            secure: this.config.secure,
                        });
                        // initialize and you can use your server as known
                        this.server.server = await webServer.init();
                    } catch (err) {
                        this.log.error(`Cannot create webserver: ${err}`);
                        this.terminate
                            ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                            : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                        return;
                    }
                    if (!this.server.server) {
                        this.log.error(`Cannot create webserver`);
                        this.terminate
                            ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                            : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                        return;
                    }

                    let serverListening = false;
                    this.server.server.on('error', e => {
                        if (e.toString().includes('EACCES') && port <= 1024) {
                            this.log.error(
                                `node.js process has no rights to start server on the port ${port}.\n` +
                                    'Do you know that on linux you need special permissions for ports under 1024?\n' +
                                    'You can call in shell following scrip to allow it for node.js: "iobroker fix"',
                            );
                        } else {
                            this.log.error(`Cannot start server on ${this.config.bind || '0.0.0.0'}:${port}: ${e}`);
                        }
                        if (!serverListening) {
                            this.terminate
                                ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                                : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                        }
                    });

                    // Start the web server
                    this.server.server.listen(
                        this.config.port,
                        !this.config.bind || this.config.bind === '0.0.0.0' ? undefined : this.config.bind || undefined,
                        () => {
                            void this.setState('info.connection', true, true);
                            serverListening = true;
                        },
                    );

                    const settings: SocketSettings = {
                        ttl: this.config.ttl as number,
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

                    this.server.io = new SocketIO(settings, this);
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

                    this.server.io.start(
                        this.server.server,
                        // @ts-expect-error fix later
                        socketio,
                        { store: this.store, secret: this.secret },
                        socketOptions,
                    );
                },
            );
        } else {
            this.log.error('port missing');
            this.terminate
                ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
        }
    }

    async main(): Promise<void> {
        if (this.config.auth) {
            // Generate secret for session manager
            const systemConfig = await this.getForeignObjectAsync('system.config');
            if (systemConfig) {
                if (!systemConfig.native?.secret) {
                    systemConfig.native = systemConfig.native || {};
                    await new Promise<void>(resolve =>
                        randomBytes(24, (_err: Error | null, buf: Buffer): void => {
                            this.secret = buf.toString('hex');
                            void this.extendForeignObject('system.config', { native: { secret: this.secret } });
                            resolve();
                        }),
                    );
                } else {
                    this.secret = systemConfig.native.secret;
                }
            } else {
                this.log.error('Cannot find object system.config');
            }
        }

        if (this.config.secure) {
            // Load certificates
            await new Promise<void>(resolve =>
                this.getCertificates(
                    undefined,
                    undefined,
                    undefined,
                    (_err: Error | null | undefined, certificates: ioBroker.Certificates | undefined): void => {
                        this.certificates = certificates;
                        resolve();
                    },
                ),
            );
        }

        this.initWebServer();
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<AdapterOptions> | undefined) => new SocketIoAdapter(options);
} else {
    // otherwise start the instance directly
    (() => new SocketIoAdapter())();
}
