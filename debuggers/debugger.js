define(function(require, exports, module) {
    main.consumes = [
        "Panel", "c9", "util", "settings", "ui", "layout", "menus", "save", 
        "buttons", "callstack", "breakpoints", "immediate", "variables", "fs",
        "watches", "run", "panels", "tabManager" //, "quickwatch"
    ];
    main.provides = ["debugger"];
    return main;

    function main(options, imports, register) {
        var c9       = imports.c9;
        var util     = imports.util;
        var Panel    = imports.Panel;
        var settings = imports.settings;
        var ui       = imports.ui;
        var fs       = imports.fs;
        var menus    = imports.menus;
        var save     = imports.save;
        var layout   = imports.layout;
        var tabs     = imports.tabManager;
        var panels   = imports.panels;
        var run      = imports.run;
        
        var buttons     = imports.buttons;
        var callstack   = imports.callstack;
        var breakpoints = imports.breakpoints;
        var immediate   = imports.immediate;
        var watches     = imports.watches;
        //var quickwatch  = imports.quickwatch;
        var variables   = imports.variables;
        
        /***** Initialization *****/
        
        var plugin = new Panel("Ajax.org", main.consumes, {
            index        : 100,
            caption      : "Debugger",
            className    : "debugger",
            elementName  : "winDebugger",
            minWidth     : 165,
            width        : 300,
            where        : "right"
        });
        var emit   = plugin.getEmitter();
        
        var dbg, debuggers = {}, pauseOnBreaks = 0, state = "disconnected";
        var running; 
        
        function load(){
            // State Change
            var stateTimer;
            dbg.on("stateChange", function(e){
                var action = e.state == "running" ? "disable" : "enable";
                
                // Wait for 500ms in case we are step debugging
                clearTimeout(stateTimer);
                if (action == "disable")
                    stateTimer = setTimeout(function(){
                        updatePanels(action, e.state);
                    }, 500);
                else {
                    updatePanels(action, e.state);
                }
            }, plugin);
            
            run.on("started", function(){
                running = run.STARTED;
                buttons.state = state;
            }, plugin);
            run.on("stopped", function(){
                running = run.STOPPED;
                buttons.state = "disconnected";
            }, plugin);
            
            // Receive the breakpoints on attach
            dbg.on("attach", function(e){
                emit("attach", e);
                
                // Add breakpoints that we potentially got from the server
                e.breakpoints.forEach(function(bp){
                    if (bp.serverOnly)
                        breakpoints.setBreakpoint(bp, true);
                });
                
                // Deactivate breakpoints if user wants to
                if (!breakpoints.enableBreakpoints)
                    breakpoints.deactivateAll();
                
                
            }, plugin);
            
            dbg.on("detach", function(e){
                buttons.state = "detached";
                
                //@todo
                emit("detach", e);
            }, plugin);
            
            // Debug
            buttons.on("resume",     function(){ dbg.resume(); }, plugin);
            buttons.on("suspend",    function(){ dbg.suspend(); }, plugin);
            buttons.on("stepInto",  function(){ dbg.stepInto(); }, plugin);
            buttons.on("stepOut",   function(){ dbg.stepOut(); }, plugin);
            buttons.on("stepOver",  function(){ dbg.stepOver(); }, plugin);
            buttons.on("breakpointsRemove", function(e){
                breakpoints.breakpoints.forEach(function(bp){
                    breakpoints.clearBreakpoint(bp);
                });
            }, plugin);
            buttons.on("breakpointsEnable", function(e){
                e.value
                    ? breakpoints.activateAll()
                    : breakpoints.deactivateAll();
            }, plugin);
            buttons.on("pauseToggle", function(e){ 
                dbg.setBreakBehavior(
                    e.value === 1 ? "uncaught" : "all",
                    e.value === 0 ? false : true
                );
                
                pauseOnBreaks = e.value;
                settings.set("user/debug/@pause", e.value);
            }, plugin);
            breakpoints.on("active", function(e){
                buttons.enableBreakpoints = e.value;
            }, plugin);
            
            // When hitting a breakpoint or exception or stepping
            function startDebugging(e){
                var frame;
                
                if (settings.getBool("user/debug/@autoshow"))
                    panels.activate("debugger");
                
                // Reload Frames
                function setFrames(err, frames) {
                    emit("framesLoad", {frames: frames});
                    
                    // Load frames into the callstack and if the frames 
                    // are completely reloaded, set active frame
                    if (callstack.loadFrames(frames)
                      && (callstack.activeFrame == e.frame 
                      || callstack.activeFrame == frame)) {
                          
                        // Set the active frame
                        callstack.activeFrame = frames[0];
                        
                        // Clear the cached states of the variable datagrid
                        variables.clearCache();
                    }
                }
                
                // Process Exception
                if (e.exception) {
                    // @todo add this into the ace view?
                }
                
                // Load frames
                if (e.frames) setFrames(null, e.frames)
                else dbg.getFrames(setFrames);
                
                // If we're most likely in the current frame, lets update
                // The callstack and show it in the editor
                frame = callstack.frames[0];
                if (frame && e.frame.path == frame.path 
                  && e.frame.sourceId == frame.sourceId) {
                    var frames = callstack.frames;
                    
                    frame.line   = e.frame.line;
                    frame.column = e.frame.column;
                    
                    emit("framesLoad", {frames: frames});
                    callstack.loadFrames(frames, true);
                    callstack.activeFrame = frame;
                }
                // Otherwise set the current frame as the active one, until
                // we have fetched all the frames
                else {
                    emit("framesLoad", {frames: [e.frame]});
                    callstack.loadFrames([e.frame]);
                    callstack.activeFrame = e.frame;
                }
                
                // Update Watchers
                watches.updateAll();
                
                // Show the frame in the editor
                callstack.showDebugFrame(callstack.activeFrame);
                
                emit("break", e);
            }
            dbg.on("break", startDebugging, plugin);
            dbg.on("exception", startDebugging, plugin);
            dbg.on("suspend", function(){
                dbg.getFrames(function(err, frames){
                    if (frames.length) {
                        startDebugging({
                            frames : frames,
                            frame  : frames[0]
                        });
                    }
                });
            }, plugin);
            
            // When a new frame becomes active
            dbg.on("frameActivate", function(e){
                // This is disabled, because frames should be kept around a bit
                // in order to update them, for a better UX experience
                //callstack.activeFrame = e.frame;
                callstack.updateMarker(e.frame);
            }, plugin);
            
            // Clicking on the call stack
            callstack.on("beforeOpen", function(e){
                return emit("beforeOpen", e);
            }, plugin)
            
            callstack.on("open", function(e){
                function done(err, value){
                    if (err) return; //@todo util.alert?
                    
                    if (emit("open", { 
                        path  : e.source.path, 
                        value : value,
                        done  : e.done,
                        tab  : e.tab
                    }) !== false)
                        e.done(value);
                }
                
                //!e.generated && 
                if ((e.source.path || "").charAt(0) == "/") {
                    fs.readFile(e.source.path, "utf8", done);
                }
                else {
                    dbg.getSource(e.source, done);
                    e.tab.document.getSession().readOnly = true;
                }
            }, plugin)
            
            // Updating the scopes of a frame
            callstack.on("scopeUpdate", function(e){
                if (e.variables) {
                    variables.updateScope(e.scope, e.variables);
                }
                else {
                    dbg.getScope(callstack.activeFrame, e.scope, function(err, vars){
                        if (err) return console.error(err);
                        
                        variables.updateScope(e.scope, vars);
                    });
                }
            }, plugin);
            
            // Loading new sources
            dbg.on("sources", function(e){
                callstack.loadSources(e.sources);
            }, plugin);
            
            // Adding single new sources when they are compiles
            dbg.on("sourcesCompile", function(e){
                callstack.addSource(e.source);
            }, plugin);
            
            // Load the scripts in the sources dropdown
            buttons.getElement("lstScripts", function(lstScripts){
                lstScripts.setModel(callstack.modelSources);
                
                lstScripts.on("afterselect", function(e){
                    callstack.openFile({
                        scriptId  : e.selected.getAttribute("id"),
                        path      : e.selected.getAttribute("path"),
                        generated : true
                    });
                }, plugin)
            });
            
            // When clicking on a frame in the call stack show it 
            // in the variables datagrid
            callstack.on("frameActivate", function(e){
                // @todo reload the clicked frame recursively + keep state
                variables.loadFrame(e.frame);
            }, plugin);
            
            // Variables
            variables.on("expand", function(e){
                if (e.variable) {
                    //<a:insert match="[item[@children='true']]" get="{adbg.loadObject(dbg, %[.])}" />
                    dbg.getProperties(e.variable, function(err, properties){
                        if (err) return console.error(err);
                        
                        variables.updateVariable(e.variable, properties, e.node);
                        e.expand();
                    });
                }
                // Local scope
                else if (e.scope.type == 1) {
                    //variables.updateScope(e.scope);
                    e.expand();
                }
                // Other scopes
                else {
                    dbg.getScope(callstack.activeFrame, e.scope, function(err, vars){
                        if (err) return console.error(err);
                        
                        variables.updateScope(e.scope, vars);
                        e.expand();
                    });
                }
            }, plugin);
            
            // Editor variables of the current frame
            variables.on("variableEdit", function(e){
                // Set new value
                dbg.setVariable(e.variable, e.parents, 
                  e.value, callstack.activeFrame, function(err){
                    if (err) 
                        return e.undo();
                        
                    // Reload properties of the variable
                    dbg.getProperties(e.variable, function(err, properties){
                        variables.updateVariable(e.variable, properties, e.node);
                    });
                });
            }, plugin);
            
            // Editing watches in the current or global frame
            watches.on("setWatch", function(e){
                // Execute expression
                if (e.isNew) {
                    dbg.evaluate(e.name, callstack.activeFrame, 
                      !callstack.activeFrame, true, function(err, variable){
                        if (err) 
                            return e.error(err.message);
                        
                        e.variable.json = variable.json;

                        watches.updateVariable(e.variable, 
                            e.variable.properties || [], e.node);
                    })
                }
                // Set new value of a property
                else {
                    dbg.setVariable(e.variable, e.parents, 
                      e.value, callstack.activeFrame, function(err){
                        if (err) 
                            return e.undo();
                            
                        // Reload properties of the variable
                        dbg.getProperties(e.variable, function(err, properties){
                            watches.updateVariable(e.variable, properties, e.node);
                        });
                    });
                }
            }, plugin);
            
            // Breakpoints
            function updateBreakpoint(e){
                // Give plugins the ability to update a breakpoint before
                // setting it in the debugger
                emit("breakpointsUpdate", e);
                
                if (!state || state == "disconnected")
                    return;
                
                var bp = e.breakpoint;
                // There used to be a timeout here.
                
                if (e.action == "enable" || e.action == "disable" 
                  || e.action == "condition" || e.action == "ignoreCount") {
                    dbg.changeBreakpoint(bp);
                }
                else if (e.action == "add") {
                    dbg.setBreakpoint(bp);
                }
                else if (e.action == "remove") {
                    dbg.clearBreakpoint(bp);
                }
            }
            // Breakpoints may have already been set
            breakpoints.breakpoints.forEach(function(bp){
                updateBreakpoint({breakpoint: bp, action: "add"});
            });
            // Listen for updates
            breakpoints.on("update", updateBreakpoint, plugin);
            
            // Open a file at the right position when clicking on a breakpoint
            breakpoints.on("breakpointShow", function(e){
                callstack.openFile(e);
            }, plugin);
            
            dbg.on("breakpointUpdate", function(e){
                var bp = e.breakpoint;
                
                if (bp.actual) {
                    // Delete breakpoints that are outside of the doc length
                    var session = tabs.findTab(bp.path).document.getSession();
                    if (bp.actual.line >= session.session.getLength()) {
                        breakpoints.clearBreakpoint(bp);
                        return;
                    }
                }
                
                emit("breakpointsUpdate", {
                    breakpoint : bp, 
                    action     : "add", 
                    force      : true
                });
                
                var loc = bp.actual || bp;
                var bps = breakpoints.findBreakpoints(bp.path, loc.line);
                if (bps.length > 1) {
                    var bpi, condition, ignoreCount;
                    for (var i = 0, l = bps.length; i < l; i++) {
                        bpi = bps[i];
                        
                        if (bpi.condition) condition = bpi.condition;
                        if (bpi.ignoreCount) ignoreCount = bpi.ignoreCount;
                        if (bpi != bp)
                            breakpoints.clearBreakpoint(bpi, false, true);
                    }
                    //@todo should this be reset on the server?
                    bp.condition   = condition;
                    bp.ignoreCount = ignoreCount;
                }
                
                breakpoints.redrawBreakpoint(bp);
            }, plugin);

            // Immediate 
            // immediate.addType("Debugger (current frame)", "debug-frame", plugin);
            // immediate.addType("Debugger (global)", "debug-global", plugin);

            // immediate.on("evaluate", function(e){
            //     if (e.type.substr(0, 5) == "debug") {
            //         var global = e.type.indexOf("global") > -1;
                    
            //         dbg.evaluate(e.expression, null, global, false, 
            //             function(err, value, body, refs){
            //                 if (err) 
            //                     e.output.error(err.message, err.stack);
            //                 else {
            //                     // @todo expand this do display types, etc.
            //                     //       probably best to move that into immediate
            //                     e.output.log(value.value);
            //                 }
                            
            //                 watches.updateAll();
            //                 if (!global)
            //                     callstack.updateAll();
                            
            //                 e.done();
            //             }
            //         )
            //     }
            // }, plugin);
            
            // Quickwatch
            //@todo
            
            // Set script source when a file is saved
            save.on("afterSave", function(e) {
                if (state == "disconnected")
                    return;

                var script = callstack.findSourceByPath(e.path);
                if (!script)
                    return;
    
                var value = e.document.value;
                dbg.setScriptSource(script.id, value, false, function(e) {
                    // @todo update the UI
                });
            }, plugin);
        }
        
        var drawn;
        function draw(opts){
            if (drawn) return;
            drawn = true;
            
            // Import Skin
            ui.insertSkin({
                name         : "debugger",
                data         : require("text!./skin.xml"),
                "media-path" : options.staticPrefix + "/images/",
                "icon-path"  : options.staticPrefix + "/icons/"
            }, plugin);
            
            // Create UI elements
            var bar = opts.aml.appendChild(new ui.bar({
                "id"    : "winDebugger",
                "skin"  : "panel-bar",
                "class" : "debugcontainer"
            }));
            plugin.addElement(bar);
            
            // Draw buttons
            buttons.draw({container: bar});
            
            var scroller = bar.$ext.appendChild(document.createElement("div"))
            scroller.className = "scroller";
            
            var captions = ["Watch Expressions", "Call Stack", "Scope Variables", "Breakpoints"];
            [watches, callstack, variables, breakpoints].forEach(function(c, i){
                var frame = ui.frame({ 
                    htmlNode    : scroller,
                    buttons     : "min",
                    activetitle : "min",
                    caption     : captions[i]
                });
                // bar.appendChild(frame);
                c.draw({container: frame});
            });
        }
        
        function updatePanels(action, runstate){
            state = running != run.STOPPED ? runstate : "disconnected";
            
            watches[action]();
            
            callstack[action](); 
            if (action == "disable")
                callstack.clearFrames();
                
            //buttons[action]();
            buttons.state = state;
            
            variables[action]();
            breakpoints[action]();
            
            immediate[action]("debugger"); // @todo
            //quickwatch[action]();
            
            if (action == "disable")
                watches.updateAll();
        }
        
        /***** Methods *****/
        
        function registerDebugger(type, debug){
            debuggers[type] = debug;
        }
        
        function unregisterDebugger(type, debug){
            if (debuggers[type] == debug)
                delete debuggers[type];
        }
        
        function debug(runner, callback){
            var err;
            
            // Only update debugger implementation if switching or not yet set
            if (!dbg || dbg != debuggers[runner["debugger"]]) {
                
                // Currently only supporting one debugger at a time
                if (dbg) {
                    // Detach from runner
                    dbg.detach();
                    
                    // Remove all the set events
                    plugin.cleanUp(true);
                }
                
                // Find the new debugger
                dbg = debuggers[runner["debugger"]];
                if (!dbg) {
                    err = new Error(runner["debugger"]
                        ? "Unable to find a debugger with type " + runner["debugger"]
                        : "No debugger type specified in runner");
                    err.code = "EDEBUGGERNOTFOUND";
                    return callback(err);
                }
                
                // Attach all events necessary
                load();
            }
            
            // Hook for plugins to delay or cancel debugger attaching
            // However cancels is responible for calling the callback
            if (emit("beforeAttach", {
                runner   : runner, 
                callback : callback
            }) === false)
                return;
            
            // Attach the debugger to the running process
            dbg.attach(runner, breakpoints.breakpoints, callback);
        }
        
        function stop(){
            if (!dbg) return;
            
            // Detach from runner
            dbg && dbg.detach();
            
            updatePanels("disable", "disconnected");
            
            if (settings.getBool("user/debug/@autoshow"))
                panels.deactivate("debugger");
            
            // // Remove all the set events
            // plugin.cleanUp(true);
            
            // dbg = null;
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            settings.on("read", function(){
                settings.setDefaults("user/debug", [
                    ["pause", "0"],
                    ["autoshow", "true"]
                ]);
                
                buttons.enableBreakpoints = breakpoints.enableBreakpoints;
                buttons.pauseOnBreaks = pauseOnBreaks =
                    settings.getNumber("user/debug/@pause");
            });
            
            // Register this panel on the left-side panels
            plugin.setCommand({
                name : "toggledebugger",
                hint : "show the debugger panel",
                // bindKey      : { mac: "Command-U", win: "Ctrl-U" }
            });
        });
        plugin.on("draw", function(e){
            draw(e);
        });
        plugin.on("enable", function(){
            
        });
        plugin.on("disable", function(){
            
        });
        plugin.on("unload", function(){
            drawn  = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * Generic Debugger for Cloud9 IDE. This plugin is responsible for 
         * binding the different debug panels to a debugger implementation.
         * 
         * The default debug panels are:
         * 
         * * {@link breakpoints}
         * * {@link buttons}
         * * {@link callstack}
         * * {@link variables}
         * * {@link watches}
         * 
         * #### Remarks
         * 
         * * The debugger also works together with the {@link immediate Immediate Panel}.
         * * If you want to create a debugger for your platform, check out the
         * {@link debugger.implementation} reference specification.
         * * The debugger implementation is choosen based on configuration
         * variables in the runner. See {@link #debug} and {@link run#run} for
         * more information on runners.
         * 
         * The following example shows how to start a debugger and 
         * programmatically work with breakpoints and breaks:
         * 
         *     // Start a process by executing example.js with the 
         *     // default runner for that extension (Node.js)
         *     var process = run.run("auto", {
         *         path  : "/example.js",
         *         debug : true
         *     }, function(err, pid){
         *     
         *         // When a breakpoint is hit, ask if the user wants to break.
         *         debug.on("break", function(){
         *             if (!confirm("Would you like to break here?"))
         *                 debug.resume();
         *         });
         *         
         *         // Set a breakpoint on the first line of example.js
         *         debug.setBreakpoint({
         *             path       : "/example.js",
         *             line       : 0,
         *             column     : 0,
         *             enabled    : true
         *         });
         *         
         *         // Attach a debugger to the running process
         *         debug.debug(process.runner, function(err){
         *             if (err) throw err.message;
         *         });
         *     });
         *
         * @singleton
         */
        plugin.freezePublicAPI({
            /**
             * When the debugger has hit a breakpoint or an exception, it breaks
             * and shows the active frame in the callstack panel. The active
             * frame represents the scope at which the debugger is stopped.
             * @property {debugger.Frame} activeFrame
             */
            get activeFrame(){ return callstack.activeFrame; },
            set activeFrame(frame){ callstack.activeFrame = frame; },
            /**
             * A list of sources that are available from the debugger. These
             * can be files that are loaded in the runtime as well as code that
             * is injected by a script or by the runtime itself.
             * @property {debugger.Source[]} sources
             * @readonly
             */
            get sources(){ return callstack.sources; },
            /**
             * 
             */
            get breakOnExceptions(){ return dbg.breakOnExceptions; },
            /**
             * 
             */
            get breakOnUncaughtExceptions(){ return dbg.breakOnUncaughtExceptions; },
            
            _events : [
                /**
                 * Fires 
                 * @event beforeAttach
                 * @param {Object} e
                 */
                "beforeAttach",
                /**
                 * Fires 
                 * @event attach
                 * @param {Object} e
                 */
                "attach",
                /**
                 * Fires 
                 * @event detach
                 * @param {Object} e
                 */
                "detach",
                /**
                 * Fires 
                 * @event framesLoad
                 * @param {Object} e
                 */
                "framesLoad",
                /**
                 * Fires 
                 * @event break
                 * @param {Object} e
                 */
                "break",
                /**
                 * Fires 
                 * @event beforeOpen
                 * @param {Object} e
                 */
                "beforeOpen",
                /**
                 * Fires 
                 * @event open
                 * @param {Object} e
                 */
                "open",
                /**
                 * Fires 
                 * @event breakpointsUpdate
                 * @param {Object} e
                 */
                "breakpointsUpdate"
            ],
            
            /**
             * Attaches the debugger that is specified by the runner to the
             * running process that is started using the same runner.
             * 
             * *N.B.: There can only be one debugger attached at the same time.*
             * 
             * @param {Object}   runnner        The runner as specified in {@link run#run}.
             * @param {Function} callback       Called when the debugger is attached.
             * @param {Error}    callback.err   Error object with information on an error if one occured.
             */
            debug : debug,
            
            /**
             * Detaches the started debugger from it's process.
             */
            stop : stop,
            
            /**
             * Registers a {@link debugger.implementation debugger implementation}
             * with a unique name. This name is used as the "debugger" property
             * of the runner.
             * @param {String}                  name      The unique name of this debugger implementation.
             * @param {debugger.implementation} debugger  The debugger implementation.
             */
            registerDebugger : registerDebugger,
            
            /**
             * Unregisters a{@link debugger.implementation debugger implementation}.
             * @param {String}                  name      The unique name of this debugger implementation.
             * @param {debugger.implementation} debugger  The debugger implementation.
             */
            unregisterDebugger : unregisterDebugger,
            
            /**
             * Continues execution of a process after it has hit a breakpoint.
             */
            resume : function(){ dbg.resume() },
            
            /**
             * Pauses the execution of a process at the next statement.
             */
            suspend : function(){ dbg.suspend() },
            
            /**
             * Step into the next statement.
             */
            stepInto : function(){ dbg.stepInto() },
            
            /**
             * Step out of the current statement.
             */
            stepOut : function(){ dbg.stepOut() },
            
            /**
             * Step over the next statement.
             */
            stepOver : function(){ dbg.stepOver() },
            
            /**
             * Retrieves the contents of a source file from the debugger (not 
             * the file system).
             * @param {debugger.Source} source         The source file.
             * @param {Function}        callback       Called when the contents is retrieved.
             * @param {Function}        callback.err   Error object if an error occured.
             * @param {Function}        callback.data  The contents of the file.
             */
            getSource : function(source, callback){ 
                dbg.getSource(source, callback);
            },
            
            /**
             * 
             */
            setBreakBehavior : function(){ 
                dbg.setBreakBehavior(); 
            },
            
            /**
             * 
             */
            evaluate : function(frame, global, disableBreak){ 
                dbg.evaluate(frame, global, disableBreak); 
            },
            
            /**
             * Adds a breakpoint to a line in a source file.
             * @param {debugger.Breakpoint} breakpoint  The breakpoint to add.
             */
            setBreakpoint : breakpoints.setBreakpoint,
            
            /**
             * Removes a breakpoint from a line in a source file.
             * @param {debugger.Breakpoint} breakpoint  The breakpoint to remove.
             */
            clearBreakpoint : breakpoints.clearBreakpoint
        });
        
        register(null, {
            "debugger": plugin
        });
    }
});