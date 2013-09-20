/**
 * Generic Debugger for Cloud9 IDE
 *
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = [
        "plugin", "c9", "util", "settings", "ui", "layout", "menus", "save", 
        "buttons", "callstack", "breakpoints", "immediate", "variables", "fs",
        "watches", "run", "panels", "tabs" //, "quickwatch"
    ];
    main.provides = ["debugger"];
    return main;

    function main(options, imports, register) {
        var c9       = imports.c9;
        var util     = imports.util;
        var Plugin   = imports.plugin;
        var settings = imports.settings;
        var ui       = imports.ui;
        var fs       = imports.fs;
        var menus    = imports.menus;
        var save     = imports.save;
        var layout   = imports.layout;
        var tabs     = imports.tabs;
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
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit   = plugin.getEmitter();
        
        var dbg, debuggers = {}, pauseOnBreaks = 0, state = "disconnected";
        var running; 
        
        function load(){
            // State Change
            var stateTimer;
            dbg.on("state.change", function(e){
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
            buttons.on("step.into",  function(){ dbg.stepInto(); }, plugin);
            buttons.on("step.out",   function(){ dbg.stepOut(); }, plugin);
            buttons.on("step.over",  function(){ dbg.stepOver(); }, plugin);
            buttons.on("breakpoints.remove", function(e){
                breakpoints.breakpoints.forEach(function(bp){
                    breakpoints.clearBreakpoint(bp);
                });
            }, plugin);
            buttons.on("breakpoints.enable", function(e){
                e.value
                    ? breakpoints.activateAll()
                    : breakpoints.deactivateAll();
            }, plugin);
            buttons.on("pause.toggle", function(e){ 
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
                    emit("frames.load", {frames: frames});
                    
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
                    
                    emit("frames.load", {frames: frames});
                    callstack.loadFrames(frames, true);
                    callstack.activeFrame = frame;
                }
                // Otherwise set the current frame as the active one, until
                // we have fetched all the frames
                else {
                    emit("frames.load", {frames: [e.frame]});
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
            dbg.on("frame.activate", function(e){
                // This is disabled, because frames should be kept around a bit
                // in order to update them, for a better UX experience
                //callstack.activeFrame = e.frame;
                callstack.updateMarker(e.frame);
            }, plugin);
            
            // Clicking on the call stack
            callstack.on("before.open", function(e){
                return emit("before.open", e);
            }, plugin)
            
            callstack.on("open", function(e){
                function done(err, value){
                    if (err) return; //@todo util.alert?
                    
                    if (emit("open", { 
                        path  : e.source.path, 
                        value : value,
                        done  : e.done,
                        page  : e.page
                    }) !== false)
                        e.done(value);
                }
                
                //!e.generated && 
                if ((e.source.path || "").charAt(0) == "/") {
                    fs.readFile(e.source.path, "utf8", done);
                }
                else {
                    dbg.getSource(e.source, done);
                    e.page.document.getSession().readOnly = true;
                }
            }, plugin)
            
            // Updating the scopes of a frame
            callstack.on("scope.update", function(e){
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
            dbg.on("sources.compile", function(e){
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
            callstack.on("frame.activate", function(e){
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
            variables.on("variable.edit", function(e){
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
            watches.on("watch.set", function(e){
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
                emit("breakpoints.update", e);
                
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
            breakpoints.on("breakpoint.show", function(e){
                callstack.openFile(e);
            }, plugin);
            
            dbg.on("breakpoint.update", function(e){
                var bp = e.breakpoint;
                
                if (bp.actual) {
                    // Delete breakpoints that are outside of the doc length
                    var session = tabs.findPage(bp.path).document.getSession();
                    if (bp.actual.line >= session.session.getLength()) {
                        breakpoints.clearBreakpoint(bp);
                        return;
                    }
                }
                
                emit("breakpoints.update", {
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
            save.on("after.save", function(e) {
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
            var bar = opts.panel.appendChild(new ui.bar({
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
            
            emit("draw");
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
            if (emit("before.attach", {
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
            panels.register({
                index        : 100,
                caption      : "Debugger",
                command      : "toggledebugger",
                hint         : "show the debugger panel",
                // bindKey      : { mac: "Command-U", win: "Ctrl-U" },
                className    : "debugger",
                panel        : plugin,
                elementName  : "winDebugger",
                minWidth     : 165,
                width        : 300,
                draw         : draw,
                where        : "right"
            });
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
         * Draws the file tree
         * @event afterfilesave Fires after a file is saved
         *   object:
         *     node     {XMLNode} description
         *     oldpath  {String} description
         **/
        plugin.freezePublicAPI({
            get activeFrame(){ return callstack.activeFrame; },
            set activeFrame(frame){ callstack.activeFrame = frame; },
            get sources(){ return callstack.sources; },
            
            /**
             */
            debug : debug,
            
            /**
             */
            stop : stop,
            
            /**
             */
            registerDebugger : registerDebugger,
            
            /**
             */
            unregisterDebugger : unregisterDebugger,
            
            /**
             * 
             */
            resume : function(){ dbg.resume() },
            
            /**
             * 
             */
            suspend : function(){ dbg.suspend() },
            
            /**
             * 
             */
            stepInto : function(){ dbg.stepInto() },
            
            /**
             * 
             */
            stepOut : function(){ dbg.stepOut() },
            
            /**
             * 
             */
            stepOver : function(){ dbg.stepOver() },
            
            /**
             * 
             */
            getSource : function(source, callback){ 
                dbg.getSource(source, callback);
            },
            
            /**
             * 
             */
            updateFrame : callstack.updateFrame,
            
            /**
             * 
             */
            changeBreakpoint : breakpoints.changeBreakpoint,
            
            /**
             * 
             */
            setBreakpoint : breakpoints.setBreakpoint,
            
            /**
             * 
             */
            clearBreakpoint : breakpoints.clearBreakpoint
            
        });
        
        register(null, {
            "debugger": plugin
        });
    }
});