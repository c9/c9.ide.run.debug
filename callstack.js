define(function(require, exports, module) {
    main.consumes = [
        "DebugPanel", "util", "ui", "tabManager", "debugger", "save"
    ];
    main.provides = ["callstack"];
    return main;

    function main(options, imports, register) {
        var util       = imports.util;
        var DebugPanel = imports.DebugPanel;
        var ui         = imports.ui;
        var save       = imports.save;
        var debug      = imports.debugger;
        var tabs       = imports.tabManager;
        
        var Range    = require("ace/range").Range;
        var markup   = require("text!./callstack.xml");
        
        /***** Initialization *****/
        
        var deps   = main.consumes.splice(0, main.consumes.length - 1);
        var plugin = new DebugPanel("Ajax.org", deps, {
            caption : "Call Stack",
            index   : 200
        });
        var emit   = plugin.getEmitter();
        
        var datagrid, modelSources, modelFrames; // UI Elements
        var sources = [];
        var frames  = [];
        
        var activeFrame, dbg, menu, button;
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            modelSources = new ui.model();
            modelFrames  = new ui.model();
            plugin.addElement(modelSources, modelFrames);
            
            // Set and clear the dbg variable
            debug.on("attach", function(e){
                dbg = e.implementation;
            });
            debug.on("detach", function(e){
                dbg = null;
            });
            debug.on("stateChange", function(e){
                plugin[e.action]();
                if (e.action == "disable")
                    clearFrames();
            });
            
            debug.on("framesLoad", function(e){
                function setFrames(frames, frame, force) {
                    // Load frames into the callstack and if the frames 
                    // are completely reloaded, set active frame
                    if (loadFrames(frames) && (force || 
                      activeFrame == frame || activeFrame == frames[0])) {
                          
                        // Set the active frame
                        activeFrame = frames[0];
                        emit("frameActivate", { frame : activeFrame });
                        debug.activeFrame = activeFrame;
                        
                        e.frame = activeFrame;
                        emit("framesLoad", e);
                    }
                }
                
                // Load frames
                if (e.frames) 
                    setFrames(e.frames, e.frame);
                else { 
                    dbg.getFrames(function(err, frames){
                        setFrames(frames, e.frame);
                    });
                }
                
                // If we're most likely in the current frame, lets update
                // The callstack and show it in the editor
                var frame = frames[0];
                if (frame && e.frame.path == frame.path 
                  && e.frame.sourceId == frame.sourceId) {
                    frame.line   = e.frame.line;
                    frame.column = e.frame.column;
                    
                    setFrames(frames, frame, true);
                }
                // Otherwise set the current frame as the active one, until
                // we have fetched all the frames
                else {
                    setFrames([e.frame], e.frame, true);
                }
            });
            
            debug.on("break", function(e){
                // Show the frame in the editor
                debug.showDebugFrame(activeFrame);
            });
            
            debug.on("frameActivate", function(e){
                // This is disabled, because frames should be kept around a bit
                // in order to update them, for a better UX experience
                //callstack.activeFrame = e.frame;
                updateMarker(e.frame, true);
            });
            
            // Loading new sources
            debug.on("sources", function(e){
                loadSources(e.sources);
            }, plugin);
            
            // Adding single new sources when they are compiles
            debug.on("sourcesCompile", function(e){
                addSource(e.source);
            }, plugin);
            
            // Set script source when a file is saved
            save.on("afterSave", function(e) {
                if (debug.state == "disconnected")
                    return;

                var script = findSourceByPath(e.path);
                if (!script)
                    return;
    
                var value = e.document.value;
                dbg.setScriptSource(script, value, false, function(e) {
                    // @todo update the UI
                });
            }, plugin);
        }

        var drawn = false;
        function draw(options){
            if (drawn) return;
            drawn = true;
            
            // Create UI elements
            ui.insertMarkup(options.aml, markup, plugin);
            
            datagrid = plugin.getElement("datagrid");
            datagrid.setAttribute("model", modelFrames);
            
            // Update markers when a document becomes available
            tabs.on("tabAfterActivateSync", function(e) {
                updateMarker(activeFrame);
            });
            
            // stack view
            datagrid.on("afterselect", function(e) {
                // afterselect can be called after setting value, without user interaction
                if (!datagrid.hasFocus())
                    return;
                
                setActiveFrame(e.selected && findFrame(e.selected), true);
            });
            
            var hbox = debug.getElement("hbox");
            menu = hbox.ownerDocument.documentElement.appendChild(new ui.menu({
                style : "top: 56px;"
                    + "left: 803px;"
                    + "opacity: 1;"
                    + "border: 0px;"
                    + "padding: 0px;"
                    + "background-color: transparent;"
                    + "margin: -3px 0px 0px;"
                    + "box-shadow: none;",
                childNodes : [
                    new ui.list({
                      id            : "lstScripts",
                      margin        : "3 -2 0 0",
                      style         : "position:relative",
                      skin          : "list_dark",
                      maxitems      : "10",
                      disabled      : "true" ,
                      each          : "[source]",
                      caption       : "[@name]",
                      autoselect    : "false",
                      icon          : "scripts.png" ,
                      onafterselect : "this.parentNode.hide()",
                    })
                ]
            }));
            button = hbox.appendChild(new ui.button({
                id       : "btnScripts",
                tooltip  : "Available internal and external scripts",
                icon     : "scripts.png",
                right    : "0",
                top      : "0",
                skin     : "c9-menu-btn",
                disabled : "true"
            }));
            plugin.addElement(menu, button);
            
            // Load the scripts in the sources dropdown
            var list = menu.firstChild
            list.setModel(modelSources);
            list.on("afterselect", function(e){
                debug.openFile({
                    scriptId  : e.selected.getAttribute("id"),
                    path      : e.selected.getAttribute("path"),
                    generated : true
                });
            }, plugin);
            
            // Set context menu to the button
            button.setAttribute("submenu", menu);
        }
        
        function setActiveFrame(frame, fromDG) {
            activeFrame = frame;
            if (!frames.length) return;
            
            if (!fromDG && datagrid) {
                // Select the frame in the UI
                if (!frame) {
                    modelFrames.clear();
                    frames = [];
                }
                else {
                    datagrid.select(findFrameXml(frame));
                }
            }
            
            // Highlight frame in Ace and Open the file
            if (frame)
                debug.showDebugFrame(frame);
            // updateMarker(frame);
                
            emit("frameActivate", { frame : activeFrame });
            debug.activeFrame = activeFrame;
        }
        
        /***** Helper Functions *****/
        
        function addMarker(session, type, row) {
            var marker = session.addMarker(new Range(row, 0, row + 1, 0), "ace_" + type, "line");
            session.addGutterDecoration(row, type);
            session["$" + type + "Marker"] = {lineMarker: marker, row: row};
        }

        function removeMarker(session, type) {
            var markerName = "$" + type + "Marker";
            session.removeMarker(session[markerName].lineMarker);
            session.removeGutterDecoration(session[markerName].row, type);
            session[markerName] = null;
        }
        
        function removeMarkerFromSession(session){
            session.$stackMarker && removeMarker(session, "stack");
            session.$stepMarker && removeMarker(session, "step");
        }

        function updateMarker(frame, scrollToLine) {
            // Remove from all active sessions, when there is no active frame.
            if (!frame) {
                tabs.getPanes().forEach(function(pane){
                    var tab = pane.getTab();
                    if (tab && tab.editor && tab.editor.type == "ace") {
                        var session = tab.document.getSession().session;
                        removeMarkerFromSession(session);
                    }
                });
                return;
            }
            
            // Otherwise find the active session and set the marker
            var tab    = frame && tabs.findTab(frame.path);
            var editor = tab && tab.isActive() && tab.editor;
            if (!editor || editor.type != "ace")
                return;
                
            var session = tab.document.getSession().session;
            removeMarkerFromSession(session);

            if (!frame)
                return;
                
            var path      = tab.path;
            var framePath = frame.path;
            var row       = frame.line;
            
            if (frame.istop) {
                if (path == framePath) {
                    addMarker(session, "step", row);
                    
                    if (scrollToLine)
                        tab.editor.ace.scrollToLine(row, true, true);
                }
            }
            else {
                if (path == framePath)
                    addMarker(session, "stack", row);

                var topFrame = frames[0];
                if (path == topFrame.path)
                    addMarker(session, "step", topFrame.line);
            }
        }
        
        /***** Methods *****/
        
        function findSourceByPath(path){
            for (var i = 0, l = sources.length, source; i < l; i++) {
                if ((source = sources[i]).path == path)
                    return source;
            }
        }
        
        function findSource(id){
            if (typeof id == "object") {
                id = parseInt(id.getAttribute("id"), 10);
            }
            
            for (var i = 0, l = sources.length, source; i < l; i++) {
                if ((source = sources[i]).id == id)
                    return source;
            }
        }
        
        function findSourceXml(source){
            return modelSources.queryNode("//file[@path=" 
                + util.escapeXpathString(String(source.path)) + "]");
        }
        
        function findFrame(index){
            if (typeof index == "object") {
                index = parseInt(index.getAttribute("index"), 10);
            }
            
            for (var i = 0, l = frames.length, frame; i < l; i++) {
                if ((frame = frames[i]).index == index)
                    return frame;
            }
        }
        
        function findFrameXml(frame){
            return modelFrames.queryNode("//frame[@index=" 
                + util.escapeXpathString(String(frame.index)) + "]")
        }
        
        /**
         * Assumptions:
         *  - .index stays the same
         *  - sequence in the array stays the same
         *  - ref stays the same when stepping in the same context
         */
        function updateFrameXml(frame, noRecur){
            var node = findFrameXml(frame);
            if (!node)
                return;
            
            //With code insertion, line/column might change??
            node.setAttribute("line", frame.line);
            node.setAttribute("path", frame.path);
            apf.xmldb.setAttribute(node, "column", frame.column);
        
            if (noRecur)
                return;
        
            // Updating the scopes of a frame
            if (frame.variables) {
                emit("scopeUpdate", {
                    scope     : frame,
                    variables : frame.variables
                });
            }
            else {
                dbg.getScope(activeFrame, frame, function(err, vars){
                    if (err) return console.error(err);
                    
                    emit("scopeUpdate", {
                        scope     : frame,
                        variables : vars
                    });
                });
            }
        
            // Update scopes if already loaded
            frame.scopes && frame.scopes.forEach(function(scope){
                if (scope.variables)
                    emit("scopeUpdate", { scope: scope });
            });
        };
        
        function loadFrames(input, noRecur){
            // If we're in the same frameset, lets just update the frames
            if (input.length && input.length == frames.length 
              && frames[0].equals(input[0])) {
                for (var i = 0, l = input.length; i < l; i++)                                                                        
                    updateFrameXml(input[i], noRecur);
                return false;
            }
            else {
                frames = input;
                modelFrames.load("<frames>" + frames.join("") + "</frames>");
                
                if (activeFrame && frames.indexOf(activeFrame) > -1)
                    setActiveFrame(activeFrame);
                
                return true;
            }
        }
        
        function loadSources(input){
            // @todo consider only calling xmlupdate once
            // @todo there used to be an optimization here that checked 
            // whether the current frameset is the same as the one being loaded
            
            sources = input;
            modelSources.load("<sources>" + sources.join("") + "</sources>");
        }
        
        function clearFrames(){
            setActiveFrame(null);
        }
        
        function addSource(source){
            sources.push(source);
            modelSources.appendXml(source.xml);
        }
        
        function updateAll(){
            frames.forEach(function(frame){
                updateFrameXml(frame);
            });
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
            plugin.once("draw", draw);
        });
        plugin.on("enable", function(){
            if (drawn) {
                menu.enable();
                button.enable();
            }
        });
        plugin.on("disable", function(){
            if (drawn) {
                menu.disable();
                button.disable();
            }
        });
        plugin.on("unload", function(){
            loaded = false;
            drawn  = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * The call stack panel for the {@link debugger Cloud9 debugger}.
         * 
         * This panel allows a user to inspect the call stack and jump to the
         * different items in the stack.
         * 
         * @singleton
         * @extends DebugPanel
         **/
        plugin.freezePublicAPI({
            /**
             * When the debugger has hit a breakpoint or an exception, it breaks
             * and shows the active frame in the callstack panel. The active
             * frame represents the scope at which the debugger is stopped.
             * @property {debugger.Frame} activeFrame
             */
            get activeFrame(){ return activeFrame; },
            set activeFrame(frame){ setActiveFrame(frame); },
            /**
             * A list of sources that are available from the debugger. These
             * can be files that are loaded in the runtime as well as code that
             * is injected by a script or by the runtime itself.
             * @property {debugger.Source[]} sources
             * @readonly
             */
            get sources(){ return sources; },
            /**
             * A list (or stack) of frames that make up the call stack. The
             * frames are in order and the index 0 contains the frame where
             * the debugger is breaked on.
             * @property {debugger.Frame[]} frames
             * @readonly
             */
            get frames(){ return frames; },
            
            /**
             * Updates all frames in the call stack UI.
             */
            updateAll : updateAll,
            
            /**
             * Updates a specific frame in the call stack UI
             * @param {debugger.Frame} frame  The frame to update.
             */
            updateFrame : updateFrameXml
        });
        
        register(null, {
            callstack: plugin
        });
    }
});