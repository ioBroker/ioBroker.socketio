import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'node:https';

import { Adapter, type AdapterOptions, commonTools, EXIT_CODES } from '@iobroker/adapter-core'; // Get common adapter utils
import { SocketIO } from './lib/socketIO';
import socketio from 'socket.io';
import { WebServer } from '@iobroker/webserver';
import * as session from 'express-session';
import type { IncomingMessage, OutgoingMessage } from 'node:http';
import { readFileSync } from 'node:fs';
import type { SocketIoAdapterConfig } from './types';
import { randomBytes } from 'node:crypto';
import type { Store } from '@iobroker/socket-classes';

type Server = HttpServer | HttpsServer;

export class SocketIoAdapter extends Adapter {
    private wsConfig: SocketIoAdapterConfig;
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
    private bruteForce: { [ip: string]: { errors: number; time: number } } = {};
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
        this.wsConfig = this.config as SocketIoAdapterConfig;
        this.on('log', (obj: ioBroker.LogMessage): void => this.server?.io?.sendLog(obj));
    }

    onUnload(callback: () => void): void {
        try {
            void this.setState('info.connected', '', true);
            void this.setState('info.connection', false, true);
            this.log.info(`terminating http${this.wsConfig.secure ? 's' : ''} server on port ${this.wsConfig.port}`);
            this.server.io?.close();
            this.server.server?.close();

            callback();
        } catch {
            callback();
        }
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

    //this.wsConfig: {
    //    "port":   8080,
    //    "auth":   false,
    //    "secure": false,
    //    "bind":   "0.0.0.0", // "::"
    //}
    initWebServer(): void {
        this.wsConfig.port = parseInt(this.wsConfig.port as string, 10) || 0;

        if (this.wsConfig.port) {
            if (this.wsConfig.secure && !this.certificates) {
                return;
            }

            this.wsConfig.ttl = parseInt(this.wsConfig.ttl as string, 10) || 3600;
            this.wsConfig.forceWebSockets = this.wsConfig.forceWebSockets || false;

            if (this.wsConfig.auth) {
                const AdapterStore = commonTools.session(session, this.wsConfig.ttl);
                // Authentication checked by server itself
                this.store = new AdapterStore({ adapter: this });
                this.wsConfig.forceWebSockets = this.wsConfig.forceWebSockets || false;
            }

            this.getPort(
                this.wsConfig.port,
                !this.wsConfig.bind || this.wsConfig.bind === '0.0.0.0' ? undefined : this.wsConfig.bind || undefined,
                async port => {
                    if (parseInt(port as unknown as string, 10) !== this.wsConfig.port) {
                        this.log.error(`port ${this.wsConfig.port} already in use`);
                        return this.terminate
                            ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                            : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                    }

                    this.wsConfig.port = port;

                    try {
                        const webServer = new WebServer({
                            adapter: this,
                            secure: this.wsConfig.secure,
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
                            this.log.error(`Cannot start server on ${this.wsConfig.bind || '0.0.0.0'}:${port}: ${e}`);
                        }
                        if (!serverListening) {
                            this.terminate
                                ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                                : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                        }
                    });

                    // Start the web server
                    this.server.server.listen(
                        this.wsConfig.port,
                        !this.wsConfig.bind || this.wsConfig.bind === '0.0.0.0'
                            ? undefined
                            : this.wsConfig.bind || undefined,
                        () => {
                            void this.setState('info.connection', true, true);
                            serverListening = true;
                        },
                    );

                    const settings: {
                        language?: ioBroker.Languages;
                        defaultUser?: string;
                        ttl?: number;
                        secure?: boolean;
                        auth?: boolean;
                        crossDomain?: boolean;
                        port?: number;
                        compatibilityV2?: boolean;
                        forceWebSockets?: boolean;
                    } = {
                        ttl: this.wsConfig.ttl as number,
                        port: this.wsConfig.port,
                        secure: this.wsConfig.secure,
                        auth: this.wsConfig.auth,
                        crossDomain: true,
                        defaultUser: this.wsConfig.defaultUser,
                        language: this.wsConfig.language,
                        compatibilityV2: this.wsConfig.compatibilityV2,
                        forceWebSockets: this.wsConfig.forceWebSockets,
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
        this.wsConfig = this.config as SocketIoAdapterConfig;

        if (this.wsConfig.auth) {
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

        if (this.wsConfig.secure) {
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
