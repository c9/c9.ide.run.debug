/**
 * Debugger UI for Cloud9 IDE
 *
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = [
        "plugin", "c9", "settings", "ui", "layout", "commands", "console"
    ];
    main.provides = ["buttons"];
    return main;

    function main(options, imports, register) {
        var c9       = imports.c9;
        var Plugin   = imports.plugin;
        //var settings = imports.settings;
        var ui       = imports.ui;
        //var menus    = imports.menus;
        var commands = imports.commands;
        var layout   = imports.layout;
        var console  = imports.console;
        
        var markup = require("text!./buttons.xml");
        var css    = require("text!./buttons.css");
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit   = plugin.getEmitter();
        
        plugin.__defineGetter__("state", function(){ 
            return state; 
        });
        plugin.__defineSetter__("state", function(v){ 
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
        });
        plugin.__defineGetter__("enableBreakpoints", function(){ 
            return enableBreakpoints; 
        });
        plugin.__defineSetter__("enableBreakpoints", function(v){ 
            enableBreakpoints = v;
            toggleBreakpoints(v);
        });
        plugin.__defineGetter__("pauseOnBreaks", function(){ 
            return pauseOnBreaks; 
        });
        plugin.__defineSetter__("pauseOnBreaks", function(v){ 
            pauseOnBreaks = v; 
            togglePause(v);
        });
        
        var enableBreakpoints, pauseOnBreaks, state;
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
//            commands.addCommand({
//                name: "evalInteractive",
//                bindKey: {mac: "Command-Return", win: "Ctrl-Return"},
//                hint:  "execute selection in interactive window",
//                exec: function(editor) {
//                    var menu = dock.getButtons("ext/debugger/debugger", "dbInteractive")[0];
//                    dock.layout.showMenu(menu.uniqueId);
//                    dbInteractive.parentNode.set(dbInteractive);
//    
//                    txtCode.focus();
//                    var range = editor.getSelectionRange();
//                    var val = range.isEmpty()
//                        ? editor.session.getLine(range.start.row)
//                        : editor.session.getTextRange(range);
//    
//                    txtCode.$editor.setValue(val.trim());
//                    require("ext/debugger" + "/inspector").consoleTextHandler({keyCode:13,ctrlKey:true});
//                },
//                isAvailable: function(editor, event) {
//                    if (dbg.state != "stopped")
//                        return false;
//                    if (event instanceof KeyboardEvent &&
//                      (!apf.activeElement || !apf.activeElement.$editor || apf.activeElement.$editor.path != "ext/code/code"))
//                        return false;
//                    return true;
//                },
//                findEditor: function(editor) {
//                    if (editor && editor.amlEditor)
//                        return editor.amlEditor.$editor;
//                    return editor;
//                }
//            }, plugin);
    
//            function getDebugHandler(runner) {
//                return _self.handlers.filter(function (handler) {
//                    return handler.handlesRunner(runner);
//                })[0];
//            }
//    
//            ide.addEventListener("dbg.ready", function(e) {
//                if (_self.$dbgImpl)
//                    return;
//                var runnerMatch = /(\w+)-debug-ready/.exec(e.type);
//                var debugHandler;
//                if (runnerMatch && (debugHandler = getDebugHandler(runnerMatch[1]))) {
//                    onAttach(debugHandler, e.pid, runnerMatch[1]);
//                }
//                else {
//                    console.log("Appropriate debug handler not found !!");
//                }
//            });
//    
//            ide.addEventListener("dbg.exit", function(e) {
//                if (_self.$dbgImpl) {
//                    _self.$dbgImpl.detach();
//                    _self.$dbgImpl = null;
//                }
//            });
//    
//            ide.addEventListener("dbg.state", function(e) {
//                if (_self.$dbgImpl)
//                    return;
//    
//                var runnerRE = /(\w+)-debug/;
//                var runnerMatch;
//                var debugHandler;
//                for (var attr in e) {
//                    if ((runnerMatch = runnerRE.exec(attr)) && (debugHandler = getDebugHandler(runnerMatch[1]))) {
//                        onAttach(debugHandler, e[runnerMatch[0]], runnerMatch[1]);
//                    }
//                }
//            });
        
            c9.on("state.change", function(e){
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
            var parent = options.container;
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
            
            btnBpRemove.on("click", function(){
                emit("breakpoints.remove");
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
            
            btnScripts.setAttribute("submenu", lstScripts.parentNode);
            
            draw = function(){};
            emit("draw");
        }
        
        function resume(){   emit("resume"); }
        function suspend(){  emit("suspend"); }
        function stepInto(){ emit("step.into"); }
        function stepOver(){ emit("step.over"); }
        function stepOut(){  emit("step.out"); }
        
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
            
            emit("breakpoints.enable", {
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
            
            emit("pause.toggle", {
                value : pauseOnBreaks
            });
        }
        
        /***** Methods *****/
        
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
         * Draws the file tree
         * @event afterfilesave Fires after a file is saved
         *   object:
         *     node     {XMLNode} description
         *     oldpath  {String} description
         **/
        plugin.freezePublicAPI({
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

//    registerDebugHandler : function(handler) {
//        this.handlers.push(handler);
//    },
//
//    loadSources : function(callback) {
//        this.$dbgImpl && this.$dbgImpl.loadSources(callback);
//    },
//
//    loadSource : function(script, callback) {
//        this.$dbgImpl && this.$dbgImpl.loadSource(script, callback);
//    },
//
//    loadObject : function(item, callback) {
//        this.$dbgImpl && this.$dbgImpl.loadObject(item, callback);
//    },
//
//    loadFrame : function(frame, callback) {
//        this.$dbgImpl && this.$dbgImpl.loadFrame(frame, callback);
//    },
//
//    resume : function(stepaction, stepcount, callback) {
//        ide.dispatchEvent("beforecontinue");
//
//        this.$dbgImpl && this.$dbgImpl.resume(stepaction, stepcount || 1, callback);
//    },
//
//    suspend : function() {
//        this.$dbgImpl && this.$dbgImpl.suspend();
//    },
//
//    evaluate : function(expression, frame, global, disableBreak, callback){
//        this.$dbgImpl && this.$dbgImpl.evaluate(expression, frame, global, disableBreak, callback);
//    },
//
//    changeLive : function(scriptId, newSource, previewOnly, callback) {
//        this.$dbgImpl && this.$dbgImpl.changeLive(scriptId, newSource, previewOnly, callback);
//    },
//
//    lookup: function(handles, includeSource, callback) {
//        this.$dbgImpl && this.$dbgImpl.lookup(handles, includeSource, callback);
//    },
//
//    updateBreakpoints: function() {
//        this.$dbgImpl && this.$dbgImpl.updateBreakpoints();
//    }