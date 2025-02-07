const { existsSync, writeFileSync, readFileSync } = require('fs');

let socket = require.resolve('socket.io-client').replace(/\\/g, '/');
// node_modules/socket.io-client/build/cjs/index.js
const parts = socket.split('/');
parts.pop();
parts.pop();
if (existsSync(`${parts.join('/')}/dist/socket.io.js`)) {
    // v2
    writeFileSync(`${__dirname}/dist/lib/socket.io.js`, readFileSync(`${parts.join('/')}/dist/socket.io.js`));
} else {
    // v4
    parts.pop();
    writeFileSync(`${__dirname}/dist/lib/socket.io.js`, readFileSync(`${parts.join('/')}/dist/socket.io.min.js`));
}
