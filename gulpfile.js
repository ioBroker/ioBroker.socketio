'use strict';

const gulp      = require('gulp');
const fs        = require('fs');

gulp.task('copySocketIo', done => {
    let socket = require.resolve('socket.io-client').replace(/\\/g, '/');
    // node_modules/socket.io-client/build/cjs/index.js
    const parts = socket.split('/');
    parts.pop();
    parts.pop();
    if (fs.existsSync(parts.join('/') + '/dist/socket.io.js')) {
        // v2
        fs.writeFileSync(__dirname + '/lib/socket.io.js', fs.readFileSync(parts.join('/') + '/dist/socket.io.js'));
    } else {
        // v4
        parts.pop();
        fs.writeFileSync(__dirname + '/lib/socket.io.js', fs.readFileSync(parts.join('/') + '/dist/socket.io.min.js'));
    }
    done();
});

gulp.task('default', gulp.series('copySocketIo'));
