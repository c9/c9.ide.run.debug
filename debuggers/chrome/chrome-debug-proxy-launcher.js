define(function(require, exports, module) {
    var EventEmitter = require("ace/lib/event_emitter").EventEmitter;
    
    function extendVFS(vfs, options, register) {
        var extPath = "{EXTPATH}";
        var detached = true;
        var force = false;
        var nodeRequire = require;
        var p = nodeRequire("child_process").spawn(process.execPath, [extPath, force], {
            stdio: detached ? "ignore" : undefined,
            detached: detached
        });
        if (detached) {
            p.unref();
        } else {
            p.stdout.pipe(process.stderr);
            p.stderr.pipe(process.stderr);
        }
        register(null, {});
    }
    
    exports.connect = function(imports, options, callback) {
        var vfs = imports.vfs;
        var c9 = imports.c9;
        var exe = c9.sourceDir + "/plugins/c9.ide.run.debug/debuggers/chrome/chrome-debug-proxy.js";
        
        var socketPath = c9.home + "/.c9/chrome.sock";
        if (c9.platform == "win32")
            socketPath = "\\\\.\\pipe\\" + socketPath.replace(/\//g, "\\");
        
        vfs.extend("chromeDebugProxyLauncher", {
            code: "module.exports = " + extendVFS.toString().replace("{EXTPATH}", exe),
            redefine: true
        }, function(err, remote) {
            if (err) console.log(err);
            tryConnect(30);
        });
        
        function tryConnect(retries) {
            connectPort(function next(err, socket) {
                if (err && retries > 0) {
                    return setTimeout(function() {
                        tryConnect(retries - 1);
                    }, 100);
                }
                callback(err, socket);
            });
        }
        
        function connectPort(callback) {
            vfs.connect(socketPath, { encoding: "utf8" }, function(err, meta) {
                if (err) return callback(err);
                
                stream = meta.stream;
                var buff = [];
                stream.on("data", function(data) {
                    var idx;
                    while (true) {
                        idx = data.indexOf("\0");
                        if (idx === -1)
                            return data && buff.push(data);
                        buff.push(data.substring(0, idx));
                        var clientMsg = buff.join("");
                        data = data.substring(idx + 1);
                        buff = [];
                        var m;
                        try {
                            m = JSON.parse(clientMsg);
                        } catch (e) {
                            continue;
                        }
                        socket.emit("message", m);
                    }
                });
                // Don't call end because session will remain in between disconnects
                stream.on("end", function(err) {
                    console.log("end", err);
                    socket.emit("end", err);
                });
                stream.on("error", function(err) {
                    socket.emit("error", err);
                });
                
                socket.send({ $: "connect", port: options.port, host: options.host });
                socket.on("message", function me(m) {
                    if (m && m.$ == "connected") {
                        socket.mode = m.mode;
                        socket.off("message", me);
                        callback && callback(null, socket);
                    }
                });
            });
        }
        
        var stream;
        var socket = options.socket;
        socket.emit = socket.getEmitter();
        socket.send = function(s) {
            stream && stream.write(JSON.stringify(s) + "\0");
        };
        socket.close = function() {
            stream && stream.end();
        };
        c9.on("disconnect", function() {
            stream && stream.end();
        }, socket);
        c9.on("connect", function() {
            stream && stream.end();
            connectPort();
        }, socket);
        
        socket.on("unload", function() {
            stream.end();
        });
    };
});