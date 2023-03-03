## Changelog
### 6.1.7 (2022-06-20)
* (bluefox) Allowed to overload the system language

### 6.1.6 (2022-06-20)
* (bluefox) Allowed to run socket.io behind proxy

### 6.1.5 (2022-06-09)
* (bluefox) Do not show requireLog message

### 6.1.4 (2022-05-27)
* (Apollon77) Fixed crash cases reported by Sentry

### 6.1.3 (2022-05-20)
* (bluefox) Corrected "force web-sockets" mode

### 6.1.1 (2022-05-20)
* (bluefox) Reverted socket.io to V2

### 6.0.2 (2022-05-20)
* (bluefox) Added compatibility with socket.io@2.x

### 6.0.1 (2022-05-19)
* (bluefox) Update to socket.io@4.x

### 5.0.2 (2022-05-19)
* (bluefox) Hide warn messages

### 5.0.1 (2022-05-16)
* (bluefox) Used common sockets (could be buggy)

### 4.2.0 (2022-03-27)
* (bluefox) Added `log` socket command

### 4.1.5 (2022-03-20)
* (Apollon77) make sure patterns are handled as strings on subscribe/unsubscribe
* (Apollon77) when getHistory is called with instance as string correct the data into an object

### 4.1.4 (2022-02-16)
* (bluefox) Added `unlink` and `rename` to web functions

### 4.1.2 (2022-02-13)
* (bluefox) Corrected the connection indication

### 4.1.0 (2022-01-31)
* (bluefox) Update socket.io library to 2.4.1
* (bluefox) Used json config for settings

### 3.1.5 (2021-10-22)
* (foxriver76) make error logging on failed authentication more specific
* (foxriver76) "request" was replaced by "axios"

### 3.1.4 (2021-01-13)
* (Apollon77) Define instanceObject "connected" to prevent warning with js-controller 3.2

### 3.1.3 (2021-01-12)
* (Apollon77) fix socketio dependency

### 3.1.2 (2021-01-09)
* (bluefox) Support of new Let's Encrypt (only with js-controller 3.2.x)

### 3.0.13 (2020-08-21)
* (bluefox) Added getAdapterName method

### 3.0.12 (2020-07-27)
* (Apollon77) socket.io pingTimeout and pinInterval increased to prevent too fast reconnections and bigger visualizations

### 3.0.11 (2020-07-23)
* (Apollon77) make sure web adapter gets restarted on socketio adapter upgrade

### 3.0.10 (2020-07-16)
* (Apollon77) Error caught when trying to write an empty base64 value into a file (Sentry )

### 3.0.9 (2020-06-11)
* (Apollon77) optimize error handling on webserver initialization again

### 3.0.8 (2020-06-10)
* (Apollon77) Make sure adapter does not crash if getHttp is called with an invalid URL (Sentry IOBROKER-WEB-R)

### 3.0.7 (2020-05-04)
* (Apollon77) webserver initialization optimized again to prevent errors with invalid certificates

### 3.0.6 (2020-04-30)
* (bluefox) errors on webserver initialization are handled properly

### 3.0.5 (2020-04-23)
* (bluefox) Caught the web server errors

### 3.0.4 (2020-04-23)
* fix crash reason when server closes (Sentry IOBROKER-SOCKETIO-2/3/4/5)

### 3.0.3 (2020-04-16)
* (Apollon77) Remove usage of deprecated object methods; prevent js-controller 3.0 warnings
* (Apollon77) Add Sentry error reporting

### 3.0.2 (2020-03-07)
* (bluefox) Unload of adapter was corrected

### 3.0.1 (2020-02-23)
* (Apollon77) Workaround for socket.io bug #3555 added to make sure always the correct client files are delivered

### 3.0.0 (2020-01-15)
* (Apollon77) upgrade all dependencies, especially socketio to current version! This might break ipad 1/2 devices

### 2.1.2 (2019-09-28)
* (Apollon77) optimize shutdown for compact mode

### 2.1.1 (2018-06-09)
* (bluefox) Used socket.io Version 1.7.2
* (bluefox) Fix authentication problem

### 2.1.0 (2018-05-04)
* (bluefox) Used socket.io Version 1.7.4

### 2.0.1 (2018-02-28)
* (bluefox) Dropped support of old browsers. Please do not update if you have iPad 1 and so on.

### 1.9.0 (2018-01-14)
* (bluefox) Ready for admin3

### 1.8.7 (2017-11-29)
* (bluefox) Tune cloud work

### 1.8.5 (2017-10-22)
* (bluefox) Escape [] in subscriptions

### 1.8.4 (2017-10-16)
* (bluefox) Check callback validity

### 1.8.3 (2017-10-09)
* (bluefox) Allow authentication via URL

### 1.8.2 (2017-09-20)
* (bluefox) Fix cmdExec command

### 1.8.1 (2017-09-13)
* (bluefox) Fix user access rights for sendToHost

### 1.8.0 (2017-08-06)
* (bluefox) Support the access to admin via iobroker.pro

### 1.7.5 (2017-05-24)
* (bluefox) fix error if subscribe is empty

### 1.7.4 (2017-01-04)
* (bluefox) fix error with authentication

### 1.7.3 (2016-11-13)
* (bluefox) support of socket extensions

### 1.7.2 (2016-11-06)
* (bluefox) Fix unsubscribe of states

### 1.7.1 (2016-10-11)
* (bluefox) Fix authentication for app

### 1.7.0 (2016-08-30)
* (bluefox) compatible only with new admin

### 1.6.1 (2016-08-29)
* (bluefox) fix error by checking user name

### 1.6.0 (2016-08-27)
* (bluefox) support of letsencrypt certificates

### 1.5.4 (2016-08-26)
* (bluefox) fix error in socket.js

### 1.5.3 (2016-08-14)
* (bluefox) support of force only web sockets transport

### 1.5.2 (2016-07-06)
* (bluefox) support of chained certificates

### 1.5.1 (2016-06-28)
* (bluefox) add sendToHost command

### 1.5.0 (2016-06-17)
* (bluefox) preparations for cloud

### 1.4.1 (2016-05-13)
* (bluefox) change getHistory function

### 1.4.0 (2016-04-24)
* (bluefox) encode json files

### 1.3.0 (2016-03-17)
* (bluefox) rename files

### 1.2.3 (2015-12-24)
* (bluefox) support of authentication over URL

### 1.2.2 (2015-12-09)
* (bluefox) remove unused parameter "cache"

### 1.2.0 (2015-11-15)
* (bluefox) add version compatibility check

### 1.1.0 (2015-11-14)
* (Smiling_Jack) add getHistory

### 1.0.0 (2015-09-30)
* (bluefox) stop adapter before update

### 0.4.5 (2015-08-11)
* (bluefox) update packets

### 0.4.4 (2015-07-07)
* (bluefox) extend writeFile with mode

### 0.4.3 (2015-07-06)
* (bluefox) add chmodFile

### 0.4.1 (2015-06-13)
* (bluefox) add default ttl
* (bluefox) enable run from "web" and add permissions check

### 0.4.0 (2015-06-13)
* (bluefox) add permissions support

### 0.3.1 (2015-05-19)
* (bluefox) support of subscribe on objectChanged

### 0.3.0 (2015-04-23)
* (bluefox) enable security

### 0.2.3 (2015-03-07)
* (bluefox) extend getStates to support list of objects

### 0.2.2 (2015-02-14)
* (bluefox) fix error with objectChanged event

### 0.2.0 (2015-01-16)
* (bluefox) make socket usable as module

### 0.1.6 (2015-01-08)
* (bluefox) support of subscribe for different sockets. Support of socket names. Diagnostic info in socket.0.connected

### 0.1.5 (2015-01-07)
* (bluefox) fix error with update of states and objects

### 0.1.4 (2015-01-06)
* (bluefox) support of file manager in vis

### 0.1.3 (2015-01-02)
* (bluefox) enable adapter by default

### 0.1.2 (2015-01-02)
* (bluefox) add "request" module to package.json

### 0.1.1 (2015-01-02)
* (bluefox) enable npm install

### 0.1.0 (2014-12-28)
* (bluefox) support of read/write files

### 0.0.5 (2014-12-19)
* (bluefox) support of setObjects command

### 0.0.4 (2014-12-10)
* (bluefox) support of https sockets

### 0.0.3 (2014-12-05)
* (bluefox) support of https sockets

### 0.0.2 (2014-11-24)
* (bluefox) fix error by start

### 0.0.1 (2014-10-10)
* (bluefox) authentication works