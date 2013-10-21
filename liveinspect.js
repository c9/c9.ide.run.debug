define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "ui", "debugger", "immediate.debugnode", "language", 
        "tabManager", "callstack", "ace"
    ];
    main.provides = ["liveinspect"];
    return main;

    // @todo on scroll hide container

    function main(options, imports, register) {
        var Plugin     = imports.Plugin;
        var ui         = imports.ui;
        var ace        = imports.ace;
        var language   = imports.language;
        var debug      = imports.debugger;
        var tabManager = imports.tabManager;
        var callstack  = imports.callstack;
        var evaluator  = imports["immediate.debugnode"];
        
        // postfix plugin because debugger is restricted keyword
        var Range  = require("ace/range").Range;
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit   = plugin.getEmitter();
        
        var activeTimeout     = null;
        var windowHtml        = null;
        var currentExpression = null;
        var currentTab        = null;
        var marker            = null;
        
        var dbg, container, worker;
        
        var loaded = false;
        function load() {
            if (loaded) return false;
            loaded = true;
            
            // Set and clear the dbg variable
            debug.on("attach", function(e){
                dbg = e.implementation;
            });
            debug.on("detach", function(e){
                dbg = null;
            });
            debug.on("stateChange", function(e){
                plugin[e.action]();
            });
            
            // Hook into the language worker
            language.on("initWorker", function(e) {
                worker = e.worker;
                
                // listen to the worker's response
                worker.on("inspect", function(event) {
                    if (!event || !event.data) {
                        return hide();
                    }
    
                    // create an expression that the debugger understands
                    if (event.data.value) {
                        liveWatch(event.data);
                    }
                });
            }, plugin);
    
            // bind mouse events to all open editors
            ace.on("create", function(e){
                var editor = e.editor;
                var ace    = editor.ace;

                ace.on("mousemove", function(e){
                    onEditorMouseMove(e, editor.pane);
                });
                ace.on("mousedown", onEditorClick);
                ace.on("changeSelection", onEditorClick);
            }, plugin);
        }
        
        var drawn = false;
        function draw() {
            if (drawn) return;
            drawn = true;
            
            // Create UI elements
            var markup = require("text!./liveinspect.xml");
            ui.insertMarkup(null, markup, plugin);
            
            container = plugin.getElement("winLiveInspect");
            
            // get respective HTML elements
            windowHtml = container.$ext;
            
            container.on("prop.visible", function(e) {
                // don't track when hiding the window
                if (!e.value)
                    return;
                    
            });
            
            // when hovering over the inspector window we should ignore all further listeners
            container.$ext.addEventListener("mousemove", function(){
                if (activeTimeout) {
                    clearTimeout(activeTimeout);
                    activeTimeout = null;
                }
            });
    
            // we should track mouse movement over the whole window
            apf.addListener(document, "mousemove", onDocumentMouseMove);
        
            emit("draw");
        }
        
        /***** Methods *****/
        
        /**
         * Determine whether the current file is the current frame where the
         * debugger is in.
         */
        function isCurrentFrame(pane){
            var frame = callstack.activeFrame;
            var tab   = frame && (tab = tabManager.findTab(frame.path)) 
                && pane.activeTab == tab;
            if (!tab)
                return false;
    
            // @todo check if we are still in the current function
            // var line = frame.getAttribute("line");
            // var column = frame.getAttribute("column");
    
            return true;
        }
    
        /**
         * onMouseMove handler that is being used to show / hide the inline quick watch
         */
        function onEditorMouseMove (ev, pane) {
            if (activeTimeout) {
                clearTimeout(activeTimeout);
                activeTimeout = null;
            }
    
            if (!dbg || dbg.state != 'stopped')
                return;
                
            activeTimeout = setTimeout(function () {
                activeTimeout = null;
                
                if (!isCurrentFrame(pane))
                    return hide();

                var pos = ev.getDocumentPosition();
                if (pos.column == ev.editor.session.getLine(pos.row).length)
                    return hide();

                worker.emit("inspect", { data: { row: pos.row, column: pos.column } });

                // hide it, and set left / top so it gets positioned right when showing again
                if (!marker || !marker.range.contains(pos.row, pos.column))
                    hide();
                
                draw();
            }, 250);
        };
    
        /**
         * onDocumentMove handler to clear the timeout
         */
        function onDocumentMouseMove (ev) {
            if (!container.visible)
                return;
    
            // see whether we hover over the editor or the quickwatch window
            var mouseMoveAllowed = false;
    
            var eles = [ currentTab.editor.ace.container, container.$ext ];
            // only the visible ones
            eles.filter(function (ele) { return ele.offsetWidth || ele.offsetHeight; })
                .forEach(function (ele) {
                    // then detect real position
                    var pos  = ele.getBoundingClientRect();
                    var left = pos.left;
                    var top  = pos.top;
    
                    // x boundaries
                    if (ev.pageX >= left && ev.pageX <= (left + ele.offsetWidth)) {
                        // y boundaries
                        if (ev.pageY >= top && ev.pageY <= (top + ele.offsetHeight)) {
                            // we are in the editor, so return; this will be handled
                            mouseMoveAllowed = true;
                        }
                    }
                });
    
            if (mouseMoveAllowed) return;
    
            // not in the editor?
            if (container.visible) {
                // if we are visible, then give the user 400 ms to get back into the window
                // otherwise hide it
                if (activeTimeout)
                    clearTimeout(activeTimeout);
                activeTimeout = setTimeout(hide, 400);
            }
            else {
                // if not visible? then just clear the timeout
                clearTimeout(activeTimeout);
                activeTimeout = null;
            }
        };
    
        /**
         * When clicking in the editor window, hide live inspect
         */
        function onEditorClick (ev) {
            hide(ev.editor);
        };
    
        /**
         * Execute live watching
         */
        function liveWatch (data) {
            if (!dbg) return;
            
            var expr = data.value;
            // already visible, and same expression?
            if (container && container.visible && expr === currentExpression)
                return;
    
            // if there is any modal window open, then don't show
            var windows = getNumericProperties(document.querySelectorAll(".winadv") || {})
                .filter(function (w) {
                    return w.style.display !== "none" && w.style.visibility !== "hidden";
                });
                
            if (windows.length)
                return;
            
            // if context menu open, then also disable
            // if (mnuCtxEditor && mnuCtxEditor.visible) {
            //     return;
            // }
    
            // evaluate the expression in the debugger, and receive model as callback
            evaluator.evaluate(expr, {
                addWidget : function(state){
                    container.$int.innerHTML = "";
                    container.$int.appendChild(state.el);
                },
                session : { repl: { onWidgetChanged : function(){
                    
                }}},
                setWaiting : function(show){
                    if (!show)
                        done();
                }
            }, function(){
                done();
            });
            
            function done(){
                // store it
                currentExpression = expr;
    
                var tab    = tabManager.findTab(data.path);
                if (!tab || !tab.isActive()) 
                    return hide();
                
                currentTab = tab;
                    
                addMarker(data);
                
                var pos    = data.pos;
                var ace    = tab.document.editor.ace;
                var coords = ace.renderer.textToScreenCoordinates(pos.sl, pos.sc);
                
                windowHtml.style.width  = 
                windowHtml.style.height = "auto";
                windowHtml.style.left   = coords.pageX + "px";
                windowHtml.style.top    = (coords.pageY + ace.renderer.lineHeight) + "px";
    
                // show window
                container.show();
            }
        };
    
        function hide () {
            if (container && container.visible)
                container.hide();
            
            if (marker) {
                marker.session.removeMarker(marker.id);
                marker = null;
            }
            
            if (activeTimeout)
                activeTimeout = clearTimeout(activeTimeout);
        };
    
        function addMarker(data) {
            if (marker)
                marker.session.removeMarker(marker.id);
    
            var tab = tabManager.findTab(data.path);
            var doc = tab && tab.document;
            if (!doc)
                return;
            
            var pos     = data.pos;
            var session = doc.getSession().session;
            
            if (pos.el != pos.sl && data.value.indexOf("\n") == -1) {
                pos.el = pos.sl;
                pos.ec = session.getLine(pos.sl).length;
            }
            
            var range = new Range(pos.sl, pos.sc, pos.el, pos.ec);
            marker = {
                id      : session.addMarker(range, "ace_bracket ace_highlight", "text", true),
                session : session,
                range   : range
            };
        };
    
        function getNumericProperties (obj) {
            return Object.keys(obj)
                .filter(function (k) { return !isNaN(k); })
                .map(function (k) { return obj[k]; });
        };
        
        /***** Lifecycle *****/
        
        plugin.on("load", function() {
            load();
        });
        plugin.on("enable", function() {
            
        });
        plugin.on("disable", function() {
            hide();
        });
        plugin.on("unload", function() {
            loaded = false;
            drawn  = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * 
         **/
        plugin.freezePublicAPI({
        });
        
        register(null, {
            liveinspect: plugin
        });
    }
});