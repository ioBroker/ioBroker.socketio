# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ioBroker.socketio is an ioBroker adapter that provides WebSocket communication between web applications and the ioBroker system. Despite the name, since v4.0 it uses **pure WebSockets** (Socket.IO is only simulated for backward compatibility). The recommended alternative for new projects is `iobroker.ws`.

This adapter is also used as a library by other adapters (e.g., `iobroker.web`) via the exported `SocketIO` and socket classes in `dist/lib/`.

## Build & Development Commands

```bash
npm run build          # Compile TypeScript (tsconfig.build.json) + copy socket.io.js client + types.d.ts to dist/
npm run lint           # ESLint with flat config (eslint.config.mjs)
npm test               # Run all Mocha tests (mocha --exit)
mocha --exit --grep "pattern"   # Run a single test by name
```

**Build details:** `tsc -p tsconfig.build.json` compiles `src/` to `dist/`, then `node tasks` copies `socket.io-client/dist/socket.io.js` into `dist/lib/` and copies `src/types.d.ts` to `dist/types.d.ts`.

## Architecture

### Source Layout (src/)

- **`main.ts`** — `SocketIoAdapter` class extending `Adapter` from `@iobroker/adapter-core`. Entry point. Sets up Express server with authentication middleware, session management, SSL/TLS, OAuth2, and attaches Socket.IO. Publishes ioBroker state/object/file changes to connected WebSocket clients.
- **`lib/socketIO.ts`** — Extends `SocketCommon` from `@iobroker/socket-classes`. Implements the Socket.IO server: connection handling, authentication, ACL-based permissions, session management, client whitelisting.
- **`lib/socket.ts`** — Thin wrapper that initializes `SocketIO` with transport settings (pingInterval, maxHttpBufferSize, transports). This is the public API consumed by other adapters importing this package as a library.
- **`types.d.ts`** — Config interface (`SocketIoAdapterConfig`) and type re-exports (`SocketIO`, `IOSocketClass`, `WebSocketClient`).

### Key Patterns

- **Dual instantiation:** The adapter runs either in compact mode (exported class used by js-controller) or standalone mode (self-instantiating at module level).
- **Authentication flow:** The `detectUser` Express middleware extracts the user from query params, Bearer token, cookies, Basic auth, or session. Unauthenticated requests redirect to the login page served from `public/`.
- **Event forwarding:** ioBroker events (`stateChange`, `objectChange`, `fileChange`, `message`) are forwarded to all connected WebSocket clients via `publishAll`/`publishFileAll`/`publishInstanceMessageAll`.

### TypeScript Configuration

- `tsconfig.json` — Type-checking only (`noEmit: true`), checks both TS and JS (`allowJs`, `checkJs`), strict mode, target ES2022.
- `tsconfig.build.json` — Extends root config, enables emit, disables JS checking. Compiles `src/` to `dist/`.

### Tests

Tests use **Mocha + Chai** with `@iobroker/legacy-testing` to spin up a full js-controller instance. The test suite (`test/testAdapter.js`) verifies the adapter starts and reaches "alive" state. Package validation tests use `@iobroker/testing`.

### Default Configuration (io-package.json native)

Port 8084, no auth, no SSL, bind 0.0.0.0, session TTL 3600s, forceWebSockets false, compatibilityV2 true.

### Key Dependencies

- `@iobroker/socket-classes` — Base class for socket server logic (ACL, subscriptions, commands)
- `@iobroker/webserver` — HTTP/HTTPS server creation with OAuth2 support
- `socket.io@^2.5.1` — WebSocket library (v2 branch, not v4)
- `express@^5` — HTTP framework
