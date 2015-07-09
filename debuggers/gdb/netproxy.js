/**
 * GDB Debugger plugin for Cloud9
 *
 * @author Dan Armendariz <danallan AT cs DOT harvard DOT edu>
 * @author Rob Bowden <rob AT cs DOT harvard DOT edu>
 */

var net = require('net');
var path = require('path');
var fs = require('fs');
var spawn = require('child_process').spawn;

var executable = "{BIN}";
var dirname = "{PATH}";
var gdb_port = parseInt("{PORT}", 10);
var proxy_port = gdb_port + 1;

var MAX_STACK_DEPTH = parseInt("{MAX_DEPTH}", 10);
var STACK_RANGE = "0 " + MAX_STACK_DEPTH;

var MAX_RETRY = 300;

var client = null, // Client class instance with connection to browser
    gdb = null;    // GDB class instance with spawned gdb process

var DEBUG = true;

var old_console = console.log;
var log_file = null;
var log = function() {};

console.warn = console.log = function() {
    if (DEBUG) {
        var args = Array.prototype.slice.call(arguments);
        log_file.write(args.join(" ") + "\n");
    }
    return console.error.apply(console, arguments);
};
function send() {
    old_console.apply(console, arguments);
}

if (DEBUG) {
    log_file = fs.createWriteStream("./.gdb_proxy.log");
    log = function(str) {
        console.log(str);
    };
}

// problem!
if (executable === "!") {
    console.log("The debugger provided bad data. Please try again.");
    process.exit(0);
}

////////////////////////////////////////////////////////////////////////////////
// Client class to buffer and parse full JSON objects from plugin

function Client(c) {
    this.connection = c;
    this.buffer = [];

    this.reconnect = function(c) {
        // replace old connection
        this.cleanup();
        this.connection = c;
    };

    this.connect = function(callback) {
        if (!gdb) {
            callback(new Error("GDB not yet initialized"));
        }

        var parser = this._parse();

        this.connection.on("data", function(data) {
            log("PLUGIN: " + data.toString());

            // parse commands and begin processing queue
            var commands = parser(data);

            if (commands.length > 0) {
                gdb.command_queue = gdb.command_queue.concat(commands);
                gdb.handleCommands();
            }
        });

        this.connection.on("error", function(e) {
            log(e);
        });

        this.connection.on("end", function() {
            this.connection = null;
        });

        callback();
    };

    // flush response buffer
    this.flush = function() {
        if (!this.connection) return;
        if (this.buffer.length == 0) return;

        this.buffer.forEach(function(msg) {
            this.connection.write(msg);
        });
        this.buffer = [];
    };

    this.cleanup = function() {
        if (this.connection)
            this.connection.end();
    };

    this._parse = function() {
        var data_buffer = "";
        var data_length = false;
        var json_objects = [];
        function parser(data) {
            data = data_buffer + data.toString();

            function abort() {
                var ret = json_objects;
                json_objects = [];
                return ret;
            }

            if (data_length === false) {
                var idx = data.indexOf("\r\n\r\n");
                if (idx === -1) {
                    data_buffer = data;
                    return abort();
                }

                data_length = parseInt(data.substr(15, idx), 10);
                data = data.slice(idx+4);
            }

            // haven't gotten the full JSON object yet
            if (data.length < data_length) {
                return abort();
            }

            data_buffer = data.slice(data_length);
            data = data.substr(0, data_length);

            try {
                data = JSON.parse(data);
            }
            catch (ex) {
                console.log("There was an error parsing data from the plugin.");
                log("JSON (Parse error): " + data);
                return abort();
            }

            json_objects.push(data);

            data_length = false;
            return parser("");
        }
        return parser;
    };

    this.send = function(args) {
        args = JSON.stringify(args);
        var msg = ["Content-Length:", args.length, "\r\n\r\n", args].join("");
        log("SENDING: " + msg);
        if (this.connection)
            this.connection.write(msg);
        else
            this.buffer.push(msg);
    };
}

// End of Client class
////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////
// GDB class; connecting, parsing, issuing commands

function GDB() {
    this.sequence_id = 0;
    this.callbacks = {};
    this.abortStepIn = false;
    this.state = {};
    this.varstack = [];
    this.running = false;
    this.clientReconnect = false;
    this.memoized_files = [];
    this.command_queue = [];

    // spawn gdb proc
    this.proc = spawn('gdb', ['-q', '--interpreter=mi2'], {
        detached: true,
        cwd: dirname
    });

    var self = this;

    // handle gdb output
    var stdout_buff = buffers();
    this.proc.stdout.on("data", function(stdout_data) {
        stdout_buff(stdout_data, self._handleLine.bind(self));
    });

    // handle gdb stderr
    var stderr_buff = buffers();
    this.proc.stderr.on("data", function(stderr_data) {
        stderr_buff(stderr_data, function(line) {
            log("GDB STDERR: " + line);
        });
    });

    this.proc.on("end", function() {
        server.close();
    });

    this.proc.on("close", function(code, signal) {
        self.proc.stdin.end();
        log("GDB terminated with code " + code + " and signal " + signal);
        process.exit();
    });

    /////
    // Private methods

    // Create a buffer function that sends full lines to a callback
    function buffers() {
        var last_buffer = "";

        return function(data, callback) {
            var full_output = last_buffer + data;
            var lines = full_output.split("\n");

            // populate the stream's last buffer if the last line is incomplete
            last_buffer = (full_output.slice(-1) == "\n") ? "" : lines.pop;

            for (var i = 0; i < lines.length; i++) {
                if (lines[i].length === 0) continue;
                callback(lines[i]);
            }
        };
    }


    ////
    // Public Methods

    // issue a command to GDB
    this.issue = function(cmd, args, callback) {
        var seq = "";
        if (!args) args = "";

        if (typeof callback === "function") {
            seq = ++this.sequence_id;
            this.callbacks[seq] = callback;
        }

        var msg = [seq, cmd, " ", args, "\n"].join("");
        log(msg);
        this.proc.stdin.write(msg);
    };

    this.post = function(client_seq, command, args) {
        this.issue(command, args, function(output) {
            output._id = client_seq;
            client.send(output);
        });
    };

    this.connect = function(callback) {
        // ask GDB to retry connections to server with a given timeout
        this.issue("set tcp connect-timeout", MAX_RETRY, function() {
            // now connect
            this.issue("-target-select", "remote localhost:"+gdb_port, function(reply) {
                if (reply.state != "connected")
                    return callback(reply, "Cannot connect to gdbserver");

                // connected! set evaluation of conditional breakpoints on server
                this.issue("set breakpoint", "condition-evaluation target", function(reply) {
                    if (reply.state != "done")
                        return callback(reply, "Settings error");

                    // finally, load symbol file
                    this.issue("-file-exec-and-symbols", executable, callback);
                }.bind(this));
            }.bind(this));
        }.bind(this));
    };

    // Suspend program operation by sending sigint and prepare for state update
    this.suspend = function() {
        this.proc.kill('SIGINT');
    };

    this.cleanup = function() {
        if (this.proc) {
            this.proc.kill("SIGHUP");
            this.proc = null;
        }
    };


    //////
    // Parsing via:
    // https://github.com/besnardjb/ngdbmi/blob/master/ngdbmi.js#L1025

    String.prototype.setCharAt = function(idx, chr) {
        if (idx > this.length - 1) {
            return this.toString();
        }
        else {
            return this.substr(0, idx) + chr + this.substr(idx + 1);
        }
    };

    this._removeArrayLabels = function(args) {
        /* We now have to handle labels inside arrays */

        var t_in_array = [];
        var in_array = 0;
        for (var i = 0; i < args.length; i++) {
            /* This is a small state handling
             * in order to see if we are in an array
             * and therefore if we have to remove labels */
            if (args[i] == "[")
                t_in_array.push(1);

            if (args[i] == "{")
                t_in_array.push(0);

            if (args[i] == "]" || args[i] == "}")
                t_in_array.pop();

            /* in_array == 1 if we are in an array =) */
            in_array = t_in_array[t_in_array.length - 1];

            /* If we encounter ',"' inside an array delete until '":' or '"=' */
            if (in_array
                && (args[i] == "," || args[i] == "[")
                && args[i+1] == "\"") {
                var k = i;

                /* Walk the label */
                while ((k < args.length)
                       && (args[k] != ":")
                       && (args[k] != "=")
                       && (args[k] != "]")) {
                    k++;
                }

                /* if we end on a label end (= or :) then clear it up */
                if (args[k] == ":" || args[k] == "=") {
                    for (var l = (i+1); l <= k; l++) {
                        args = args.setCharAt(l,' ');
                    }
                }
            }
        }
        return args;
    };

    this._parseStateArgs = function(args) {
        /* This is crazy but GDB almost provides a JSON output */
        args = args.replace(/=(?=["|{|\[])/g, '!:');
        args = args.replace(/([a-zA-Z0-9-_]*)!:/g, "\"$1\":");

        /* Remove array labels */
        args = this._removeArrayLabels(args);

        /* And wrap in an object */
        args = "{" + args + "}";

        var ret = {};

        try {
            ret = JSON.parse(args);
        }
        catch(e) {
            /* We lamentably failed =( */
            log("JSON ERROR: " + e + "\nJSON: " + args);
        }

        return ret;
    };

    this._getState = function(line) {
        var m = line.match("^([a-z-]*),");

        if (m && m.length == 2)
            return m[1].trim();

        /* Couldn't we merge this with the previous one ? */
        m = line.match("^([a-z-]*)$");

        if (m && m.length == 2)
            return m[1].trim();

        return undefined;
    };

    this._parseState = function(line) {
        line = line.trim();

        var gdb_state = {};

        /* Handle state */
        var state = this._getState(line);

        if (state)
            gdb_state.state = state;

        /* Handle args if present */
        var m = line.match("^[a-z-]*,(.*)");
        if (m && m.length == 2)
            gdb_state.status = this._parseStateArgs(m[1]);

        return gdb_state;
    };

    ////
    // GDB Output handling
    ////

    // Stack State Step 0; initiate request
    this._updateState = function(segfault, thread) {
        // don't send state updates on reconnect, wait for plugin to request
        if (this.clientReconnect) return;

        this.state.segfault = (segfault === true);
        if (thread) {
            this.state.thread = thread;
            this._updateStack();
        }
        else {
            this._updateThreadId();
        }
    };

    // Stack State Step 1; find the thread ID
    this._updateThreadId = function() {
        this.issue("-thread-info", null, function(state) {
            this.state.thread = state.status["current-thread-id"];
            this._updateStack();
        }.bind(this));
    };

    // Stack State Step 2; process stack frames and request arguments
    this._updateStack = function() {
        this.issue("-stack-list-frames", STACK_RANGE, function(state) {
            this.state.frames = state.status.stack;

            // provide relative path of script to IDE
            for (var i = 0, j = this.state.frames.length; i < j; i++) {
                var file = this.state.frames[i].fullname;

                // remember if we can view the source for this frame
                if (!(file in this.memoized_files)) {
                    this.memoized_files[file] = {
                        exists: fs.existsSync(file),
                        relative: path.relative(dirname, file)
                    };
                }

                // we must abort step if we cannot show source for this function
                if (!this.memoized_files[file].exists) {
                    this.abortStepIn = this.state.frames[i+1].line;
                    this.state = {};
                    this.issue("-exec-finish");
                    return;
                }

                // store relative path for IDE
                this.state.frames[i].relative = this.memoized_files[file].relative;
            }
            this._updateStackArgs();
        }.bind(this));
    };

    // Stack State Step 3; append stack args to frames; request top frame locals
    this._updateStackArgs = function() {
        this.issue("-stack-list-arguments", "--simple-values " + STACK_RANGE,
        function(state) {
            var args = state.status['stack-args'];
            for (var i = 0; i < args.length; i++) {
                this.state.frames[i].args = args[i].args;
            }
            this._updateLocals();
        }.bind(this));
    };

    // Stack State Step 4: fetch each frame's locals & send all to proxy
    this._updateLocals = function() {
        function requestLocals(frame) {
            var args = [
                "--thread",
                this.state.thread,
                "--frame",
                frame,
                "--simple-values"
            ].join(" ");
            this.issue("-stack-list-locals", args, frameLocals.bind(this, frame));
        }
        function frameLocals(i, state) {
            this.state.frames[i].locals = state.status.locals;
            if (--i >= 0) {
                requestLocals.call(this, i);
            }
            else {
                // final step: fetch complex vars
                this._recurseVars();
            }
        }
        // work from bottom of stack; upon completion, active frame should be 0
        requestLocals.call(this, this.state.frames.length - 1);
    };

    // Stack State Step 5 (final): fetch information for all non-trivial vars
    this._recurseVars = function() {

        function __iterVars(vars) {
            for (var i = 0; i < vars.length; i++) {
                // if (vars[i].hasOwnProperty("value"))
                //     continue;
                this.varstack.push(vars[i]);
            }
            console.log(this.varstack);
        }

        function __createVars() {
            if (this.varstack.length == 0) {
                // DONE: set stack frame to topmost; send & flush compiled data
                this.issue("-stack-select-frame", "0");
                client.send(this.state);
                this.state = {};
                this.varstack = [];
                return;
            }

            var item = this.varstack.pop();

            if (item.objname)
                return __listChildren.call(this, item);

            // TODO: change * to frame-addr
            var args = ["-", "*", item.name].join(" ");
            this.issue("-var-create", args, function(item, state) {
                item.objname = state.status.name;
                if (state.status.numchild > 0)
                    __listChildren.call(this, item);
                else
                    __createVars.call(this);
            }.bind(this, item));
        }

        // created the variable, now request its children
        function __listChildren(item) {
            var args = ["--simple-values", item.objname].join(" ");
            this.issue("-var-list-children", args, function(item, state) {
                item.children = state.status.children;
                __iterVars.call(this, item.children);
                __createVars.call(this);
                //__deleteVarObj(item).call(this);
            }.bind(this, item));
        }

        // fetched the variable's children; parse, delete, then do next item
        function __deleteVarObj(item) {
            var args = ["-c", item.objname].join(" ");
            this.issue("-var-delete", args, __createVars.bind(this));
        }

        // iterate over all locals and args and push complex vars onto stack
        for (var i = 0; i < this.state.frames.length; i++) {
            var frame = this.state.frames[i];
            __iterVars.call(this, frame.args);
            __iterVars.call(this, frame.locals);
        }
        __createVars.call(this);
    };

    // Received a result set from GDB; initiate callback on that request
    this._handleRecordsResult = function(state) {
        if (typeof state._seq === "undefined")
            return;

        // command is awaiting result, issue callback and remove from queue
        if (this.callbacks[state._seq]) {
            this.callbacks[state._seq](state);
            delete this.callbacks[state._seq];
        }
        this.handleCommands();
    };

    // Handle program status update
    this._handleRecordsAsync = function(state) {
        if (typeof state.status === "undefined")
            return;

        if (state.state === "stopped")
            this.running = false;

        var cause = state.status.reason;
        var thread = state.status['thread-id'];

        if (cause == "signal-received")
            this._updateState((state.status['signal-name']=="SIGSEGV"), thread);
        else if (cause === "breakpoint-hit" || cause === "end-stepping-range"
                 || cause === "function-finished")
            this._updateState(false, thread);
        else if (cause === "exited-normally")
            process.exit();
        else if (this.abortStepIn > 0 && state.state === "stopped") {
            // sometimes gdb does not auto-advance. if this stop matches the
            // prior step-in, let's advance
            if (state.status.frame.line == this.abortStepIn) {
                this.issue("-exec-next");
            }
            else {
                this.abortStepIn = false;
                this._updateState(false, thread);
            }
        }
    };

    // handle a line of stdout from gdb
    this._handleLine = function(line) {
        if (line.trim() === "(gdb)")
            return;

        // status line: ^status or id^status
        var line_split = line.match(/^([0-9]*)\^(.*)$/);

        var state = null;
        var token = "^";

        // line split will be true if it's a status line
        if (line_split) {
            state = this._parseState(line_split[2]);

            // line_id is present if the initiating command had a _seq
            if (line_split[1])
                state._seq = line_split[1];
        }
        else {
            token = line[0];
            state = this._parseState(line.slice(1));
        }

        log("GDB: " + line);

        // first character of output determines line meaning
        switch (token) {
            case '^': this._handleRecordsResult(state);
                      break;
            case '*': this._handleRecordsAsync(state);
                      break;
            case '+': break; // Ongoing status information about slow operation
            case '=': break; // Notify async output
            case '&': break; // Log stream; gdb internal debug messages
            case '~': break; // Console output stream
            case '@': break; // Remote target output stream
            default:
        }
    };

    /////
    // Incoming command handling
    /////

    this.handleCommands = function() {
        // command queue is empty
        if (this.command_queue.length < 1)
            return;

        // get the next command in the queue
        var command = this.command_queue.shift();

        if (typeof command.command === "undefined") {
            console.log("ERROR: Received an empty request, ignoring.");
        }

        if (typeof command._id !== "number")
            command._id = "";

        var id = command._id;

        // fix some condition syntax
        if (command.condition)
            command.condition = command.condition.replace(/=(["|{|\[])/g, "= $1");

        switch (command.command) {
            case 'run':
            case 'continue':
            case 'step':
            case 'next':
            case 'finish':
                this.clientReconnect = false;
                this.running = true;
                this.post(id, "-exec-" + command.command);
                break;

            case "setvar":
                this.post(id, "-var-assign", command.name + " " + command.val);
                break;

            case "bp-change":
                if (command.enabled === false)
                    this.post(id, "-break-disable", command.id);
                else if (command.condition)
                    this.post(id, "-break-condition", command.id + " " + command.condition);
                else
                    this.post(id, "-break-enable", command.id);
                break;

            case "bp-clear":
                // include filename for multiple files
                this.post(id, "-break-delete", command.id);
                break;

            case "bp-set":
                var args = [];

                // create a disabled breakpoint if requested
                if (command.enabled === false)
                    args.push("-d");

                if (command.condition) {
                    command.condition = command.condition.replace(/"/g, '\\"');
                    args.push("-c");
                    args.push('"' + command.condition + '"');
                }

                args.push(command.text + ":" + (command.line + 1));

                this.post(id, "-break-insert", args.join(" "));
                break;

            case "bp-list":
                this.post(id, "-break-list");
                break;

            case "eval":
                // replace quotes with escaped quotes
                var exp = '"' + command.exp.replace(/"/g, '\\"') + '"';
                this.post(id, "-data-evaluate-expression", exp);
                break;

            case "reconnect":
                if (this.running) {
                    this.clientReconnect = true;
                    this.suspend();
                    client.send({ _id: id, state: "running" });
                }
                else
                    client.send({ _id: id, state: "stopped" });
                break;

            case "suspend":
                this.suspend();
                client.send({ _id: id, state: "stopped" });
                break;

            case "status":
                if (this.running) {
                    client.send({ _id: id, state: "running" });
                }
                else {
                    client.send({ _id: id, state: "stopped" });
                    this._updateState();
                }
                break;

            case "detach":
                this.issue("monitor", "exit", function() {
                    log("shutdown requested");
                    process.exit();
                });
                break;

            default:
                log("PROXY: received unknown request: " + command.command);
        }
    };
}

// End GDB class
////////////////////////////////////////////////////////////////////////////////
// Proxy initialization

var server = net.createServer(function(c) {
    if (client)
        client.reconnect(c);
    else
        client = new Client(c);

    client.connect(function(err) {
        if (err) {
            log("PROXY: Could not connect to client; " + err);
        }
        else {
            log("PROXY: server connected");
            client.send("connect");

            // flush buffer of pending requests
            client.flush();
        }
    });

});

gdb = new GDB();

gdb.connect(function(reply, err) {
    if (err) {
        log(err);
        process.exit();
    }
    start();
});

// handle process events
// pass along SIGINT to suspend gdb, only if program is running
process.on('SIGINT', function() {
    console.log("\b\bSIGINT: ");
    if (gdb.running) {
        console.log("SUSPENDING\n");
        gdb.suspend();
    }
    else {
        console.log("CANNOT SUSPEND (program not running)\n");
    }
});

process.on("SIGHUP", function() {
    log("Received SIGHUP");
    process.exit();
});

process.on("exit", function() {
    log("quitting!");
    if (gdb) gdb.cleanup();
    if (client) client.cleanup();
    if (DEBUG) log_file.end();
});

process.on("uncaughtException", function(e) {
    log("uncaught exception (" + e + ")");
    process.exit();
});

// handle server events
server.on("error", function(err) {
    if (err.errno == "EADDRINUSE") {
        console.log("It looks like the debugger is already in use!");
        console.log("Try stopping the existing instance first.");
    }
    else {
        console.log(err);
    }
    process.exit(0);
});

// Start listening for browser clients
var host = "127.0.0.1";
server.listen(proxy_port, host, function() {
    start();
});

var I=0;
function start() {
    if (++I == 2)
        send("ß");
}
