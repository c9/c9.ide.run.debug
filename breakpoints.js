define(function(require, exports, module) {
    main.consumes = [
        "DebugPanel", "c9", "util", "settings", "ui", "tabManager", "debugger"
    ];
    main.provides = ["breakpoints"];
    return main;

    function main(options, imports, register) {
        var c9         = imports.c9;
        var util       = imports.util;
        var DebugPanel = imports.DebugPanel;
        var settings   = imports.settings;
        var ui         = imports.ui;
        var tabs       = imports.tabManager;
        var debug      = imports.debugger;
        
        var markup     = require("text!./breakpoints.xml");
        var html       = require("text!./breakpoints.html");
        var Breakpoint = require("./data/breakpoint");
        
        /***** Initialization *****/
        
        var deps   = main.consumes.slice(0, main.consumes.length - 1);
        var plugin = new DebugPanel("Ajax.org", deps, {
            caption: "Breakpoints"
        });
        var emit   = plugin.getEmitter();
        
        var changed           = false;
        var breakpoints       = [];
        var enableBreakpoints = true;
        
        var dbg;
        var list, menu, model, hCondition, hInput; // UI Elements
        var btnBreakpoints, btnBpRemove;
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            model = new ui.model();
            
            plugin.addElement(model);
            
//            ide.on("afterfilesave", function(e) {
//                var doc = e.doc;
//                if (!doc || !doc.acesession)
//                    return;
//                if (doc.acesession.$breakpoints.length)
//                    _self.updateBreakpointModel(doc.acesession);
//            });
    
            tabs.on("tabAfterActivate", function(e){
                var tab = e.tab;
                if (!tab || !tab.editor || tab.editor.type != "ace")
                    return;
                    
                var ace = tab.editor.ace;
                
                decorateAce(ace);
                decorateDocument(tab.document);
                updateDocument(tab.document);
            });
            
            debug.on("attach", function(e){
                dbg = e.implementation;
                
                // Add breakpoints that we potentially got from the server
                e.breakpoints.forEach(function(bp){
                    if (bp.serverOnly)
                        setBreakpoint(bp, true);
                });
                
                // Deactivate breakpoints if user wants to
                if (!enableBreakpoints)
                    deactivateAll();
            });
            debug.on("detach", function(e){
                dbg = null;
            });
            debug.on("stateChange", function(e){
                plugin[e.action]();
            });
            
            debug.on("getBreakpoints", function(){ 
                return breakpoints; 
            });
            
            debug.on("breakpointUpdate", function(e){
                var bp = e.breakpoint;
                
                if (bp.actual) {
                    // Delete breakpoints that are outside of the doc length
                    var session = tabs.findTab(bp.path).document.getSession();
                    if (bp.actual.line >= session.session.getLength()) {
                        breakpoints.clearBreakpoint(bp);
                        return;
                    }
                }
                
                var loc = bp.actual || bp;
                var bps = findBreakpoints(bp.path, loc.line);
                if (bps.length > 1) {
                    var bpi, condition, ignoreCount;
                    for (var i = 0, l = bps.length; i < l; i++) {
                        bpi = bps[i];
                        
                        if (bpi.condition) condition = bpi.condition;
                        if (bpi.ignoreCount) ignoreCount = bpi.ignoreCount;
                        if (bpi != bp)
                            clearBreakpoint(bpi, false, true);
                    }
                    //@todo should this be reset on the server?
                    bp.condition   = condition;
                    bp.ignoreCount = ignoreCount;
                }
                
                redrawBreakpoint(bp);
            }, plugin);
            
            // Breakpoints may have already been set
            breakpoints.forEach(function(bp){
                updateBreakpointAtDebugger(bp, "add");
            });
            
            // restore the breakpoints from the IDE settings
            settings.on("read", function (e) {
                settings.setDefaults("user/breakpoints", [
                    ["active", "true"]
                ]);
                
                var list = settings.getJson("user/breakpoints");
                
                // bind it to the Breakpoint model
                breakpoints = (list || []).map(function(bp){
                    return new Breakpoint(bp);
                });
                model.load("<breakpoints>" 
                    + breakpoints.join("") + "</breakpoints>");
                
                // update the currently active document
                if (tabs.focussedTab && tabs.focussedTab.editor.type == "ace") {
                    updateDocument(tabs.focussedTab.document);
                }
                
                enableBreakpoints = settings.getBool("user/breakpoints/@active");
                toggleBreakpoints(enableBreakpoints);
                
                if (!enableBreakpoints)
                    list.setAttribute("class", "listBPDisabled");
            });
            
            settings.on("write", function (e) {
                if (changed) {
                    var list = breakpoints.map(function(bp){
                        return bp.json;
                    });
                    settings.setJson("user/breakpoints", list);
                }
                
                changed = false;
            });
        }

        var drawn;
        function draw(options){
            if (drawn) return false;
            drawn = true;
            
            // Create UI elements
            ui.insertMarkup(options.aml, markup, plugin);
            
            // Create HTML elements
            var nodes = ui.insertHtml(null, html, plugin);
            hCondition = nodes[0];
            hInput     = hCondition.getElementsByTagName("input")[0];
            hInput.onblur = function(){
                hCondition.style.display = "none";
            }
            hInput.onmousedown = function(e){
                apf.stopEvent(e);
            }
            
            list = plugin.getElement("list");
            list.setAttribute("model", model);
            list.$isWindowContainer = false; //apf hack
            
            list.on("click", function(e){
                var selected = list.selected;
                if (!selected || e.htmlEvent.target == e.htmlEvent.currentTarget)
                    return;

                var className = e.htmlEvent.target.className || "";
                if (className.indexOf("btnclose") != -1) {
                    clearBreakpoint(findBreakpoint(selected));
                }
                else if (className.indexOf("checkbox") == -1)
                    gotoBreakpoint(selected);
            });

            // Breakpoint is removed
            list.on("afterremove", function(e){
                var bp = findBreakpoint(e.xmlNode);
                clearBreakpoint(bp, true);
            });
            
            // Breakpoint is enabled / disabled
            list.on("aftercheck", function(e){
                var bp = findBreakpoint(e.xmlNode);
                
                if (!bp.enabled)
                    enableBreakpoint(bp, true);
                else
                    disableBreakpoint(bp, true);
            });
    
            menu = plugin.getElement("menu");
        
            list.setAttribute("contextmenu", menu);
            
            menu.on("prop.visible", function(){
                var length = list.length;
                
                menu.childNodes.forEach(function(item){
                    if (item.localName == "divider") return;
                    if (item.value == "deactivate") {
                        item.setAttribute("caption", enableBreakpoints 
                            ? "Deactivate Breakpoints"
                            : "Activate Breakpoints");
                        return;
                    }
                    
                    item.setAttribute("disabled", length ? false : true);
                })
            });
            
            menu.on("itemclick", function(e){
                if (!list.selected)
                    return;

                if (e.value == "remove") {
                    clearBreakpoint(findBreakpoint(list.selected));
                }
                else if (e.value == "remove-all") {
                    breakpoints.forEach(function(bp){
                        clearBreakpoint(bp);
                    });
                }
                else if (e.value == "deactivate") {
                    if (enableBreakpoints)
                        deactivateAll();
                    else
                        activateAll();
                }
                else if (e.value == "enable-all") {
                    breakpoints.forEach(function(bp){
                        enableBreakpoint(bp);
                    });
                }
                else if (e.value == "disable-all") {
                    breakpoints.forEach(function(bp){
                        disableBreakpoint(bp);
                    });
                }
            });
            
            var hbox2 = debug.getElement("hbox2");
            btnBreakpoints = hbox2.insertBefore(new ui.button({
                id       : "btnBreakpoints",
                tooltip  : "Deactivate Breakpoints",
                icon     : "toggle_breakpoints2.png",
                skinset  : "default",
                skin     : "c9-menu-btn"
            }), hbox2.selectSingleNode("a:divider"));
            btnBpRemove = hbox2.insertBefore(new ui.button({
                id       : "btnBpRemove",
                tooltip  : "Clear All Breakpoints",
                icon     : "remove_breakpoints.png",
                skinset  : "default",
                skin     : "c9-menu-btn"
            }), hbox2.selectSingleNode("a:divider"));
            plugin.addElement(btnBreakpoints, btnBpRemove);
            
            btnBreakpoints.on("click", function(){
                toggleBreakpoints();
            });
            
            btnBpRemove.on("click", function(){
                breakpoints.forEach(function(bp){
                    clearBreakpoint(bp);
                });
            });
            
            emit("draw");
        }
        
        /***** Helper Functions *****/
        
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
            
            if (enableBreakpoints)
                activateAll();
            else
                deactivateAll();
        }
        
        // Breakpoints
        function updateBreakpointAtDebugger(bp, action){
            // Give plugins the ability to update a breakpoint before
            // setting it in the debugger
            // emit("breakpointsUpdate", e);
            
            if (!debug.state || debug.state == "disconnected")
                return;
            
            // There used to be a timeout here.
            
            if (action == "enable" || action == "disable" 
              || action == "condition" || action == "ignoreCount") {
                dbg.changeBreakpoint(bp);
            }
            else if (action == "add") {
                dbg.setBreakpoint(bp);
            }
            else if (action == "remove") {
                dbg.clearBreakpoint(bp);
            }
        }
        
        /**
         * Adds and event listener to this ace instance that draws breakpoints
         */
        function decorateAce(editor) {
            if (editor.$breakpointListener)
                return;
            
            var el = document.createElement("div");
            editor.renderer.$gutter.appendChild(el);
            el.style.cssText = "position:absolute;top:0;bottom:0;left:0;width:18px;cursor:pointer";
    
            editor.on("guttermousedown", editor.$breakpointListener = function(e) {
                if (e.getButton()) // !editor.isFocused()
                    return;
                    
                var gutterRegion = editor.renderer.$gutterLayer.getRegion(e);
                if (gutterRegion != "markers")
                    return;
                    
                e.stop();
                
                var session   = editor.session;
                var line      = e.getDocumentPosition().row;
                var path      = session.c9doc.tab.path;
                var className = session.getBreakpoints()[line];
                var obp       = findBreakpoint(path, line);
                var removed   = false;
                var enabled   = true;
                
                function createBreakpoint(condition){
                    var caption = path.indexOf(c9.davPrefix) > -1
                        ? path.substring(path.indexOf(c9.davPrefix) + c9.davPrefix.length)
                        : path;
                    var lineContents = session.getLine(line);
                    
                    return setBreakpoint({
                        path       : path,
                        line       : line,
                        column     : (lineContents.match(/^(\s+)/) ||[0,""])[1].length,
                        text       : caption,
                        content    : lineContents,
                        enabled    : enabled,
                        condition  : condition
                    });
                }
                
                // Show condition dialog
                if (e.getAccelKey()) {
                    showConditionDialog(editor, createBreakpoint, path, line, obp);
                    return;
                }
                // Toggle disabled/enabled
                else if (e.getShiftKey()) {
                    enabled = className && className.indexOf("disabled") == -1;
                    removed = false;
                } 
                // Toggle add/remove
                else {
                    removed = className ? true : false;
                    enabled = true;
                }
    
                // Remove old breakpoint
                if (obp) {
                    if (removed)
                        clearBreakpoint(obp);
                    else if (enabled)
                        enableBreakpoint(obp);
                    else
                        disableBreakpoint(obp);
                    return;
                }
                
                createBreakpoint();
            });
        }
        
        function showConditionDialog(ace, createBreakpoint, path, line, breakpoint){
            // Attach dialog to ace
            ace.container.appendChild(hCondition);
            hCondition.style.display = "block";
            
            // Set left
            // var gutterWidth = ace.renderer.$gutterLayer.gutterWidth;
            hCondition.style.left = "2px"; //(gutterWidth + 5) + "px"; //gutter width
            
            // Set top
            var pos = ace.renderer.$cursorLayer.getPixelPosition({
                row    : line+1,
                column : 0
            }, true);
            hCondition.style.top = (pos.top + 2) + "px"; // line position
            
            // Set current value
            hInput.value = breakpoint.condition ||  "";
            
            var node = hCondition.getElementsByTagName("div")[0].firstChild;
            node.nodeValue = node.nodeValue.replace(/\d+/, line + 1);
            
            if (!breakpoint)
                breakpoint = createBreakpoint();
            
            hInput.onkeydown = function(e){
                if (e.keyCode == 27) {
                    hCondition.style.display = "none";
                    apf.stopEvent(e);
                }
                else if (e.keyCode == 13) {
                    setCondition(breakpoint, hInput.value);
                    hCondition.style.display = "none";
                    
                    apf.stopEvent(e);
                }
                
            };
            
            hInput.focus();
        }
        
        /**
         * Adds and event listener to an ace session that updates breakpoints
         */
        function decorateDocument(doc) {
            var session = doc.getSession()
            if (session.hasBreakpoints)
                return;

            if (!session.session) debugger;            
            session.session.on("change", function(e) {
                var breakpoints = session.session.$breakpoints;
                
                if (!breakpoints.length) //!session.c9doc.isInited || 
                    return;
                
                var delta = e.data;
                var range = delta.range;
                if (range.end.row == range.start.row)
                    return;
    
                var len, firstRow;
                len = range.end.row - range.start.row;
                if (delta.action == "insertText") {
                    firstRow = range.start.column 
                        ? range.start.row + 1 
                        : range.start.row;
                }
                else {
                    firstRow = range.start.row;
                }
    
                if (delta.action[0] == "i") {
                    var args = Array(len);
                    args.unshift(firstRow, 0);
                    breakpoints.splice.apply(breakpoints, args);
                }
                else {
                    var rem = breakpoints.splice(firstRow + 1, len);
    
                    if (!breakpoints[firstRow]) {
                        for (var i = rem.length; i--; ) {
                            if (rem[i]) {
                                breakpoints[firstRow] = rem[i];
                                break;
                            }
                        }
                    }
                }
            });
            
            session.hasBreakpoints = true;
        }
        
        function updateDocument(doc) {
            if (doc.editor.type != "ace")
                return;
                
            var session = doc.getSession();
            var rows    = [];
            var path    = doc.tab.path;
            
            if (!session.session)
                return;
    
            breakpoints.forEach(function(bp){
                if (bp.path != path)
                    return;

                rows[((bp.actual || bp).line)] 
                    = " ace_breakpoint "
                        + (bp.condition ? "condition" : "")
                        + (bp.enabled ? "" : "disabled ");
            });

            session.session.$breakpoints = rows;
            session.session._emit("changeBreakpoint", {});
        }

//        function updateBreakpointModel(session) {
//            updating = true;
//            var path = session.c9doc.getNode().getAttribute("path");
//            var breakpoints = session.$breakpoints;
//            var caption = path;
//            var tofind = ide.davPrefix;
//            if (path.indexOf(tofind) == 0)
//                caption = path.substring(tofind.length + 1);
//    
//            var bpList = model.queryNodes("breakpoint[@path=" + util.escapeXpathString(path) + "]");
//            for (var i = bpList.length; i--; ) {
//                apf.xmldb.removeNode(bpList[i]);
//            }
//    
//            breakpoints.forEach(function(breakpoint, row) {
//                if (!breakpoint)
//                    return;
//                model.appendXml(apf.n("<breakpoint/>")
//                    .attr("path", path)
//                    .attr("line", row)
//                    .attr("text", caption + ":" + (+row + 1))
//                    .attr("lineoffset", 0)
//                    .attr("content", session.getLine(row))
//                    .attr("enabled", breakpoint.indexOf("disabled") == -1)
//                    .node()
//                );
//            });
//    
//            updating = false;
//        }

//        function updateOpenFiles() {
//            tabs.getTabs().forEach(function(tab){
//                if (tab.editor.type == "ace") {
//                    updateDocument(tab.document);
//                }
//            });
//        }

        function updateBreakpoint(breakpoint, action){
            //This can be optimized, currently rereading everything
            var tab = tabs.findTab(breakpoint.path);
            if (tab) {
                // @todo there used to be a timeout here
                updateDocument(tab.document);
            }
            
            // Don't call update to enable/disable breakpoints when they are
            // all deactivated
            if (enableBreakpoints || (action != "enable" && action != "disable"))
                updateBreakpointAtDebugger(breakpoint, action);
            
            changed = true;
        }
        
        /***** Methods *****/
        
        function setCondition(breakpoint, condition, ignoreXml) {
            if (!ignoreXml) {
                var bp = findBreakpointXml(breakpoint, true);
                ui.xmldb.setAttribute(bp, "condition", condition);
            }
            
            breakpoint.data.condition = condition;
            updateBreakpoint(breakpoint, "condition");
            
            return true;
        }
        
        function enableBreakpoint(breakpoint, ignoreXml) {
            if (!ignoreXml) {
                var bp = findBreakpointXml(breakpoint, true);
                ui.xmldb.setAttribute(bp, "enabled", "true");
            }
            
            breakpoint.data.enabled = true;
            updateBreakpoint(breakpoint, "enable");
            
            return true;
        }
        
        function disableBreakpoint(breakpoint, ignoreXml){
            if (!ignoreXml) {
                var bp = findBreakpointXml(breakpoint, true);
                ui.xmldb.setAttribute(bp, "enabled", "false");
            }
            
            breakpoint.data.enabled = false;
            updateBreakpoint(breakpoint, "disable");
            
            return true;
        }
        
        function setBreakpoint(breakpoint, noEvent){
            // Ignore if the breakpoint already exists
            for (var i = 0, l = breakpoints.length, bp; i < l; i++) {
                if ((bp = breakpoints[i]).equals(breakpoint)) {
                    return;
                }
            }
                
            // Make sure we have a breakpoint object
            if (!(breakpoint instanceof Breakpoint))
                breakpoint = new Breakpoint(breakpoint);
            
            // Add to the model and array
            model.appendXml(breakpoint.xml);
            breakpoints.push(breakpoint);
            
            if (!noEvent) // Prevent recursion during init
                updateBreakpoint(breakpoint, "add");
            
            return breakpoint;
        }
        
        function clearBreakpoint(breakpoint, ignoreXml, silent){
            if (!ignoreXml) {
                var bp = findBreakpointXml(breakpoint);
                bp && apf.xmldb.removeNode(bp);
            }
            
            breakpoints.remove(breakpoint);
            if (!silent)
                updateBreakpoint(breakpoint, "remove");
        }
        
        function redrawBreakpoint(bp){
            var tab = tabs.findTab(bp.path);
            if (!tab) return;
            
            updateDocument(tab.document);
            
            var bpx = findBreakpointXml(bp);
            bpx.setAttribute("line", bp.line);
            ui.xmldb.setAttribute(bpx, "text", bp.text);
        }
        
        function findBreakpointXml(breakpoint){
            return model.queryNode("breakpoint[@path=" 
                + util.escapeXpathString(String(breakpoint.path)) 
                + " and @line='" + breakpoint.line + "']");
        }
        function findBreakpoint(path, line, multi){
            if (typeof path == "object") {
                line = parseInt(path.getAttribute("line"), 10);
                path = path.getAttribute("path");
            }
            
            var loc, bp, list = [];
            for (var i = 0, l = breakpoints.length; i < l; i++) {
                bp  = breakpoints[i];
                loc = bp.actual || bp;
                
                if (bp.path == path && (!line || loc.line == line)) {
                    if (!multi) return bp;
                    else list.push(bp);
                }
            }
            
            return multi ? list : false;
        }
        
        function findBreakpoints(path, line){
            return findBreakpoint(path, line, true);
        }
        
        function gotoBreakpoint(bp, line, column) {
            var path;
            
            if (bp instanceof Breakpoint) {
                var loc = bp.actual || bp;
                path   = bp.path;
                line   = loc.line;
                column = loc.column;
            }
            else if (typeof bp == "object") {
                return gotoBreakpoint(findBreakpoint(bp));
            }
            else {
                path = bp;
            }
            
            if (isNaN(line))    line    = null;
            if (isNaN(column)) column = null;
            
            debug.openFile({
                path   : path,
                line   : line,
                column : column
            });
        }
        
        function activateAll(){
            if (enableBreakpoints) return;
            
            enableBreakpoints = true;
            settings.set("user/breakpoints/@active", true);
            
            breakpoints.forEach(function(bp){
                if (bp.enabled)
                    updateBreakpoint({id: bp.id, enabled: true}, "enable");
            });
            
            list.setAttribute("class", "");
            
            toggleBreakpoints(true);
        }
        
        function deactivateAll(){
            if (!enableBreakpoints) return;
            
            enableBreakpoints = false;
            settings.set("user/breakpoints/@active", false);
            
            breakpoints.forEach(function(bp){
                updateBreakpoint({id: bp.id, enabled: false}, "disable");
            });
            
            list.setAttribute("class", "listBPDisabled");
            
            toggleBreakpoints(false);
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
        });
        plugin.on("draw", function(e){
            draw(e);
        });
        plugin.on("enable", function(){
            if (!enableBreakpoints)
                list.setAttribute("class", "listBPDisabled");
        });
        plugin.on("disable", function(){
            
        });
        plugin.on("unload", function(){
            loaded = false;
            drawn  = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * 
         **/
        plugin.freezePublicAPI({
            /**
             * 
             */
            get breakpoints(){ return breakpoints.slice(0); },
            
            /**
             * 
             */
            get enableBreakpoints(){ return enableBreakpoints; },
            set enableBreakpoints(v){ 
                enableBreakpoints = v;
                toggleBreakpoints(v);
            },
            
            /**
             * 
             */
            setCondition : setCondition,
            
            /**
             * 
             */
            enableBreakpoint : enableBreakpoint,
            
            /**
             * 
             */
            disableBreakpoint : disableBreakpoint,
            
            /**
             * 
             */
            gotoBreakpoint : gotoBreakpoint,
            
            /**
             * 
             */
            setBreakpoint : setBreakpoint,
            
            /**
             * 
             */
            clearBreakpoint : clearBreakpoint,
            
            /**
             * 
             */
            activateAll : activateAll,
            
            /**
             * 
             */
            deactivateAll : deactivateAll
        });
        
        register(null, {
            breakpoints: plugin
        });
    }
});