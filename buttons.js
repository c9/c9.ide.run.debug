define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "c9", "ui", "commands", "console", "debugger", "settings"
    ];
    main.provides = ["buttons"];
    return main;

    // @todo consider merging this plugin with the debugger plugin
    function main(options, imports, register) {
        var c9         = imports.c9;
        var Plugin     = imports.Plugin;
        var debug      = imports.debugger;
        var ui         = imports.ui;
        var commands   = imports.commands;
        var console    = imports.console;
        var settings   = imports.settings;
        
        var markup = require("text!./buttons.xml");
        var css    = require("text!./buttons.css");
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit   = plugin.getEmitter();
        
        var enableBreakpoints, pauseOnBreaks, state, dbg;
        var container, btnResume, btnStepOver, btnStepInto, btnStepOut, 
            lstScripts, btnSuspend, btnBreakpoints, btnPause, btnBpRemove,
            btnScripts, btnOutput, btnImmediate; // ui elements
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            // Commands
            
            commands.addCommand({
                name    : "resume",
                group   : "Run & Debug",
                hint    : "resume the current paused process",
                bindKey : {mac: "F8", win: "F8"},
                exec    : function(){
                    resume();
                }
            }, plugin);
            commands.addCommand({
                name    : "suspend",
                group   : "Run & Debug",
                hint    : "suspend the current running process",
                // bindKey : {mac: "F8", win: "F8"},
                exec    : function(){
                    suspend();
                }
            }, plugin);
            commands.addCommand({
                name    : "stepinto",
                group   : "Run & Debug",
                hint    : "step into the function that is next on the execution stack",
                bindKey : {mac: "F11", win: "F11"},
                exec    : function(){
                    stepInto()
                }
            }, plugin);
            commands.addCommand({
                name    : "stepover",
                group   : "Run & Debug",
                hint    : "step over the current expression on the execution stack",
                bindKey : {mac: "F10", win: "F10"},
                exec    : function(){
                    stepOver();
                }
            }, plugin);
            commands.addCommand({
                name    : "stepout",
                group   : "Run & Debug",
                hint    : "step out of the current function scope",
                bindKey : {mac: "Shift-F11", win: "Shift-F11"},
                exec    : function(){
                    stepOut();
                }
            }, plugin);

            // Draw the buttons when the debugger is drawn
            debug.on("draw", draw, plugin);
            
            // Update button state
            debug.on("stateChange", function(e){
                setState(e.state);
            });
            
            // Set and clear the dbg variable
            debug.on("attach", function(e){
                dbg = e.implementation;
            });
            debug.on("detach", function(e){
                dbg = null;
            });
            
            c9.on("stateChange", function(e){
                if (e.state & c9.PROCESS) {
                    
                }
                else {
                    
                }
            })
        }
        
        var drawn;
        function draw(options){
            if (drawn) return;
            drawn = true;
            
            // Load CSS
            ui.insertCss(css, plugin);
            
            // Create UI elements
            var parent = options.aml;
            ui.insertMarkup(parent, markup, plugin);
            
            container = plugin.getElement("hbox");
            
            btnResume      = plugin.getElement("btnResume");
            btnStepOver    = plugin.getElement("btnStepOver");
            btnStepInto    = plugin.getElement("btnStepInto");
            btnStepOut     = plugin.getElement("btnStepOut");
            lstScripts     = plugin.getElement("lstScripts");
            btnSuspend     = plugin.getElement("btnSuspend");
            btnBreakpoints = plugin.getElement("btnBreakpoints");
            btnBpRemove    = plugin.getElement("btnBpRemove");
            btnPause       = plugin.getElement("btnPause");
            btnScripts     = plugin.getElement("btnScripts");
            btnOutput      = plugin.getElement("btnOutput");
            btnImmediate   = plugin.getElement("btnImmediate");
            
            // @todo move this to F8 and toggle between resume
            // btnSuspend.on("click", function(){
            //     suspend();
            // });
            
            btnBreakpoints.on("click", function(){
                toggleBreakpoints();
            });
            
            // buttons.on("breakpointsRemove", function(e){
            //     breakpoints.breakpoints.forEach(function(bp){
            //         breakpoints.clearBreakpoint(bp);
            //     });
            // }, plugin);
            // buttons.on("breakpointsEnable", function(e){
            //     e.value
            //         ? breakpoints.activateAll()
            //         : breakpoints.deactivateAll();
            // }, plugin);
            // breakpoints.on("active", function(e){
            //     buttons.enableBreakpoints = e.value;
            // }, plugin);
            
            // @todo move this to the breakpoints plugin
            btnBpRemove.on("click", function(){
                emit("breakpointsRemove");
            });
            
            btnPause.on("click", function(){
                togglePause();
            });
            
            btnOutput.on("click", function(){
                commands.exec("showoutput");
            });
            
            btnImmediate.on("click", function(){
                commands.exec("showimmediate");
            });
            
            // @todo Move this to the callstack plugin
            // Load the scripts in the sources dropdown
            // buttons.getElement("lstScripts", function(lstScripts){
            //     lstScripts.setModel(callstack.modelSources);
                
            //     lstScripts.on("afterselect", function(e){
            //         callstack.openFile({
            //             scriptId  : e.selected.getAttribute("id"),
            //             path      : e.selected.getAttribute("path"),
            //             generated : true
            //         });
            //     }, plugin)
            // });
            btnScripts.setAttribute("submenu", lstScripts.parentNode);
            
            emit("draw");
        }
        
        /***** Methods *****/
        
        function resume(){   dbg && dbg.resume(); }
        function suspend(){  dbg && dbg.suspend(); }
        function stepInto(){ dbg && dbg.stepInto(); }
        function stepOver(){ dbg && dbg.stepOver(); }
        function stepOut(){  dbg && dbg.stepOut(); }
        
        function toggleBreakpoints(force){
            enableBreakpoints = force !== undefined
                ? force
                : !enableBreakpoints;
            
            if (btnBreakpoints) {
                btnBreakpoints.setAttribute("icon", enableBreakpoints 
                    ? "toggle_breakpoints2.png" 
                    : "toggle_breakpoints1.png");
                btnBreakpoints.setAttribute("tooltip", 
                    enableBreakpoints
                        ? "Deactivate Breakpoints"
                        : "Activate Breakpoints"
                );
            }
            
            emit("breakpointsEnable", {
                value : enableBreakpoints
            });
        }
        
        function togglePause(force){
            pauseOnBreaks = force !== undefined
                ? force
                : (pauseOnBreaks > 1 ? 0 : pauseOnBreaks + 1);

            if (btnPause) {
                btnPause.setAttribute("class", "pause" + pauseOnBreaks);
                btnPause.setAttribute("tooltip", 
                    pauseOnBreaks === 0
                        ? "Don't pause on exceptions"
                        : (pauseOnBreaks == 1
                            ? "Pause on all exceptions"
                            : "Pause on uncaught exceptions")
                );
            }
            
            dbg.setBreakBehavior(
                pauseOnBreaks === 1 ? "uncaught" : "all",
                pauseOnBreaks === 0 ? false : true
            );
            
            pauseOnBreaks = pauseOnBreaks;
            settings.set("user/debug/@pause", pauseOnBreaks);
        }
        
        function setState(v){
            state = v;
            
            if (!btnResume)
                return;

            btnResume.$ext.style.display = state == "stopped" 
                ? "inline-block" : "none";
            btnSuspend.$ext.style.display = state == "disconnected" 
                || state != "stopped" ? "inline-block" : "none";
                
            btnSuspend.setAttribute("disabled",     state == "disconnected");
            btnStepOver.setAttribute("disabled",    state == "disconnected" || state != "stopped");
            btnStepInto.setAttribute("disabled",    state == "disconnected" || state != "stopped");
            btnStepOut.setAttribute("disabled",     state == "disconnected" || state != "stopped");
            btnScripts.setAttribute("disabled",     state == "disconnected" || state != "stopped");
            // lstScripts.setAttribute("disabled",     state == "disconnected" || state != "stopped");
        }
        
        function show(){
            draw();
            container.show();
        }
    
        function hide(){
            container.hide();
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
        });
        plugin.on("enable", function(){
            
        });
        plugin.on("disable", function(){
            
        });
        plugin.on("unload", function(){
            loaded = false;
            drawn  = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * A panel in the debugger panel responsible for displaying the debug 
         * buttons.
         **/
        plugin.freezePublicAPI({
            get enableBreakpoints(){ return enableBreakpoints; },
            set enableBreakpoints(v){ 
                enableBreakpoints = v;
                toggleBreakpoints(v);
            },
            get pauseOnBreaks(){ return pauseOnBreaks; },
            set pauseOnBreaks(v){ 
                pauseOnBreaks = v; 
                togglePause(v);
            },
            
            /**
             * 
             */
            draw : draw,
            
            /**
             */
            show : show,
            
            /**
             */
            hide : hide
        });
        
        register(null, {
            buttons: plugin
        });
    }
});