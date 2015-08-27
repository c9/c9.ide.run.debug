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
var exec = require('child_process').exec;

var executable = "{BIN}";
var dirname = "{PATH}";
var gdb_port = parseInt("{PORT}", 10);
var proxy_port = gdb_port + 1;

var MAX_STACK_DEPTH = parseInt("{MAX_DEPTH}", 10);
var STACK_RANGE = "0 " + MAX_STACK_DEPTH;

var MAX_RETRY = 300;

var client = null, // Client class instance with connection to browser
    gdb = null;    // GDB class instance with spawned gdb process

var DEBUG = false;

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

        this.connection.on("error", log);

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
    this.state = {};
    this.framecache = {};
    this.varcache = {};
    this.running = false;
    this.clientReconnect = false;
    this.memoized_files = [];
    this.command_queue = [];
    this.proc = null;

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

    // spawn the GDB client process
    this.spawn = function() {
        this.proc = spawn('gdb', ['-q', '--interpreter=mi2', executable], {
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
            log("gdb proc ended");
            server.close();
        });

        this.proc.on("close", function(code, signal) {
            self.proc.stdin.end();
            log("GDB terminated with code " + code + " and signal " + signal);
            client.send({ err:"killed", code:code, signal:signal });
            process.exit();
        });
    };

    this.connect = function(callback) {
        // ask GDB to retry connections to server with a given timeout
        this.issue("set tcp connect-timeout", MAX_RETRY, function() {
            // now connect
            this.issue("-target-select", "remote localhost:"+gdb_port, function(reply) {
                if (reply.state != "connected")
                    return callback(reply, "Cannot connect to gdbserver");

                // connected! set eval of conditional breakpoints on server
                this.issue("set breakpoint", "condition-evaluation host", callback);

            }.bind(this));
        }.bind(this));
    };

    // spawn GDB client only after gdbserver is ready
    this.waitConnect = function(callback) {
        function wait(retries, callback) {
            if (retries < 0)
                return callback(null, "Waited for gdbserver beyond timeout");

            // determine if gdbserver has opened the port yet
            exec("lsof -i :"+gdb_port+" -sTCP:LISTEN|grep -q gdbserver", function(err) {
                // if we get an error code back, gdbserver is not yet running
                if (err !== null)
                    return setTimeout(wait.bind(this, --retries, callback), 1000);

                // success! load gdb and connect to server
                this.spawn();
                this.connect(callback);
            }.bind(this));
        }
        wait.call(this, MAX_RETRY, callback);
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

    // stack frame cache getter function
    this._cachedFrame = function(frame, frameNum, create) {
        // the uniqueness of a frame is determined by the function and its depth
        var depth = this.state.frames.length - 1 - frameNum;
        var key = frame.file + frame.line + frame.func + depth;
        if (!this.framecache.hasOwnProperty(key)) {
            if (create)
                this.framecache[key] = create;
            else
                return false;
        }
        return this.framecache[key];
    };

    // Stack State Step 0; initiate request
    this._updateState = function(segfault, thread) {
        // don't send state updates on reconnect, wait for plugin to request
        if (this.clientReconnect) return;

        this.state.err = (segfault === true)? "segfault" : null;
        this.state.thread = (thread)? thread : null;

        if (segfault === true)
            // dump the varobj cache in segfault so var-updates don't crash GDB
            this._flushVarCache();
        else
            this._updateThreadId();
    };

    // Stack State Step 0a; flush var objects in event of a segfault
    this._flushVarCache = function() {
        // determine all the varobj names by pulling keys from the cache
        var keys = [];
        for (var key in this.varcache) {
            if (this.varcache.hasOwnProperty(key))
                keys.push(key);
        }
        this.varcache = {};

        function __flush(varobjs) {
            // once we've run out of keys, resume state compilation
            if (varobjs.length == 0)
                return this._updateThreadId();

            // pop a key from the varobjs stack and delete it
            var v = varobjs.pop();
            this.issue("-var-delete", v, __flush.bind(this, varobjs));
        }

        // begin flushing the keys
        __flush.call(this, keys);
    };

    // Stack State Step 1; find the thread ID
    this._updateThreadId = function() {
        if (this.state.thread !== null)
            return this._updateStack();

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
                // if file name is not here a stack overflow has probably occurred
                if (this.state.frames[i].func == "??" ||
                    !this.state.frames[i].hasOwnProperty("fullname"))
                {
                    log("Probable stack corruption!");
                    this.state.err = "corrupt";
                    client.send(this.state);
                    this.state = {};
                    return;
                }

                var file = this.state.frames[i].fullname;

                // remember if we can view the source for this frame
                if (!(file in this.memoized_files)) {
                    this.memoized_files[file] = {
                        exists: fs.existsSync(file),
                        relative: path.relative(dirname, file)
                    };
                }

                // we must abort step if we cannot show source for this function
                if (!this.memoized_files[file].exists && !this.state.err) {
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
            // skip this frame if we have its variables cached
            if (this._cachedFrame(this.state.frames[frame], frame))
                return frameLocals.call(this, frame, null, true);

            var args = [
                "--thread",
                this.state.thread,
                "--frame",
                frame,
                "--simple-values"
            ].join(" ");
            this.issue("-stack-list-locals", args, frameLocals.bind(this, frame));
        }
        function frameLocals(i, state, cache) {
            var f = this.state.frames[i];
            if (cache)
                f.locals = this._cachedFrame(f, i).locals;
            else
                f.locals = state.status.locals;

            if (--i >= 0)
                requestLocals.call(this, i);
            else
                // update vars and fetch remaining
                this._updateCachedVars();
        }
        // work from bottom of stack; upon completion, active frame should be 0
        requestLocals.call(this, this.state.frames.length - 1);
    };

    // Stack State Step 5: update cached vars
    this._updateCachedVars = function() {
        this.issue("-var-update", "--all-values *", function(reply) {
            //update cache
            for (var i = 0; i < reply.status.changelist.length; i++) {
                var obj = reply.status.changelist[i];

                // updates to out-of-scope vars are irrelevant
                if (obj.in_scope != "true") {
                    if (obj.in_scope == "invalid")
                        this.issue("-var-delete", obj.name);
                    continue;
                }

                this.varcache[obj.name].value = obj.value;

                if (obj.type_changed == "true")
                    this.varcache[obj.name].type = obj.new_type;
            }

            // stitch cache together in state
            for (var i = 0; i < this.state.frames.length; i++) {
                var frame = this.state.frames[i];
                var cache = this._cachedFrame(frame, i);

                // cache miss
                if (cache === false) continue;

                // rebuild from cache
                frame.args = [];
                for (var j = 0; j < cache.args.length; j++)
                    frame.args.push(this.varcache[cache.args[j]]);

                frame.locals = [];
                for (var j = 0; j < cache.locals.length; j++)
                    frame.locals.push(this.varcache[cache.locals[j]]);
            }

            this._recurseVars();
        }.bind(this));
    };

    // Stack State Step 6 (final): fetch information for all non-trivial vars
    this._recurseVars = function() {
        var newvars = [];
        var ptrcache = {};

        function __iterVars(vars, varstack, f) {
            for (var i = 0; i < vars.length; i++) {
                if (vars[i].type.slice(-1) === '*') {
                    // variable is a pointer, store its address
                    vars[i].address = parseInt(vars[i].value, 16);

                    if (!vars[i].address) {
                        // don't allow null pointers' children to be evaluated
                        vars[i].address = 0;
                        vars[i].value = "NULL";
                        continue;
                    }
                    else if (ptrcache.hasOwnProperty(vars[i].address)) {
                        // don't re-compute pointers that we've already seen
                        continue;
                    }
                }
                varstack.push({ frame: f, item: vars[i] });
            }
        }

        function __createVars(varstack) {
            if (varstack.length == 0) {
                // DONE: set stack frame to topmost; send & flush compiled data
                this.issue("-stack-select-frame", "0");
                client.send(this.state);
                this.state = {};
                return;
            }

            var obj = varstack.pop();

            var item = obj.item;
            var frame = obj.frame;

            // if this is a pointer, check if we have already created a varobj
            if (item.address && ptrcache.hasOwnProperty(item.address)) {
                frame.push(ptrcache[item.address]);
                return __createVars.call(this, varstack);
            }

            // if this variable already has a corresponding varobj, get children
            if (item.objname)
                return __listChildren.call(this, item, varstack, frame);

            // no corresponding varobj for this variable, create one
            var args = ["-", "*", item.name].join(" ");
            this.issue("-var-create", args, function(item, state) {
                // allow the item to remember the varobj's ID
                item.objname = state.status.name;

                // store this varobj in caches
                this.varcache[item.objname] = item;
                if (item.hasOwnProperty("address"))
                    ptrcache[item.address] = item.objname;

                // notify the frame of this variable
                frame.push(item.objname);

                // fetch this varobj's children, if it has any
                if (parseInt(state.status.numchild, 10) > 0)
                    __listChildren.call(this, item, varstack, frame);
                else
                    __createVars.call(this, varstack);
            }.bind(this, item));
        }

        // created the variable, now request its children
        function __listChildren(item, varstack) {
            var args = ["--simple-values", item.objname].join(" ");
            this.issue("-var-list-children", args, function(item, state) {
                // if these children have children, add them to process queue
                if (parseInt(state.status.numchild, 10) > 0) {
                    item.children = state.status.children;
                    for (var i = 0; i < item.children.length; i++) {
                        var child = item.children[i];
                        child.objname = child.name;
                        this.varcache[child.name] = child;
                    }
                    __iterVars(item.children, varstack, []);
                }

                // process remaining variables in queue
                __createVars.call(this, varstack);
            }.bind(this, item));
        }

        // iterate over all locals and args and push complex vars onto stack
        for (var i = 0; i < this.state.frames.length; i++) {
            var frame = this.state.frames[i];

            // skip the frame if it's already cached
            if (this._cachedFrame(frame, i) !== false) continue;

            var cache = this._cachedFrame(frame, i, { args: [], locals: [] });
            __iterVars(frame.args, newvars, cache.args);
            __iterVars(frame.locals, newvars, cache.locals);
        }
        __createVars.call(this, newvars);
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
        else if (cause === "breakpoint-hit" || cause === "end-stepping-range" ||
                 cause === "function-finished")
            // update GUI state at breakpoint or after a step in/out
            this._updateState(false, thread);
        else if (cause === "exited-normally")
            // program has quit
            process.exit();
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

gdb.waitConnect(function(reply, err) {
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
