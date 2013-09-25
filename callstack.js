/**
 * Callstack for Cloud9 IDE
 *
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "c9", "util", "settings", "ui", "layout", "tabManager"
    ];
    main.provides = ["callstack"];
    return main;

    function main(options, imports, register) {
        var c9       = imports.c9;
        var util     = imports.util;
        var Plugin   = imports.Plugin;
        var settings = imports.settings;
        var ui       = imports.ui;
        var layout   = imports.layout;
        var tabs     = imports.tabManager;
        
        var Range    = require("ace/range").Range;
        var Frame    = require("./data/frame");
        var Source   = require("./data/source");
        var markup   = require("text!./callstack.xml");
        
        /***** Initialization *****/
        
        var deps   = main.consumes.splice(0, main.consumes.length - 1);
        var plugin = new Plugin("Ajax.org", deps);
        var emit   = plugin.getEmitter();
        
        var datagrid, modelSources, modelFrames; // UI Elements
        var sources = [];
        var frames  = [];
        
        var activeFrame;
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            modelSources = new ui.model();
            modelFrames  = new ui.model();
            
            plugin.addElement(modelSources, modelFrames);
            
            // restore the callstack from the IDE settings
            settings.on("read", function (e) {
                settings.setDefaults("user/callstack", [["show", "false"]]);
                
                if (settings.getBool("user/callstack/@show"))
                    show();
            });
            
            settings.on("write", function (e) {
                
            });
        }

        var drawn = false;
        function draw(options){
            if (drawn) return;
            drawn = true;
            
            // Create UI elements
            ui.insertMarkup(options.container, markup, plugin);
        
            datagrid = plugin.getElement("datagrid");
            datagrid.setAttribute("model", modelFrames);
            
            // Update markers when a document becomes available
            tabs.on("tabAfterActivate", function(e) {
                updateMarker(activeFrame);
            });
            
            // stack view
            datagrid.on("afterselect", function(e) {
                // afterselect can be called after setting value, without user interaction
                if (!datagrid.hasFocus())
                    return;
                
                setActiveFrame(e.selected && findFrame(e.selected), true);
            });
            
            emit("draw");
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
                showDebugFrame(frame);
            updateMarker(frame);
                
            emit("frameActivate", {frame : activeFrame});
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

        function updateMarker(frame) {
            var tab   = tabs.focussedTab;
            var editor = tab && tab.editor;
            if (!editor || editor.type != "ace")
                return;
                
            var session = tab.document.getSession().session;

            session.$stackMarker && removeMarker(session, "stack");
            session.$stepMarker && removeMarker(session, "step");

            if (!frame)
                return;
                
            var path      = tab.path;
            var framePath = frame.path;
            var row       = frame.line;
            
            if (frame.istop) {
                if (path == framePath)
                    addMarker(session, "step", row);
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
        
        function showDebugFrame(frame) {
            openFile({
                scriptId : frame.sourceId,
                line     : frame.line - 1,
                column   : frame.column,
                text     : frame.name,
                path     : frame.path
            });
        }
    
        function showDebugFile(scriptId, row, column, text) {
            openFile({
                scriptId : scriptId, 
                line     : row, 
                column   : column, 
                text     : text
            });
        }
    
        /**
         *  show file
         *    options {path or scriptId, row, column}
         */
        function openFile(options) {
            var row      = options.line + 1;
            var column   = options.column;
            var text     = options.text || "" ;
            var path     = options.path;
            var scriptId = options.scriptId;
            
            if (!path) {
                path = modelSources.queryValue("//file[@scriptid='" 
                    + scriptId + "']/@path");
            }
            else if (!scriptId) {
                scriptId = modelSources.queryValue("//file[@path=" 
                    + util.escapeXpathString(path) + "]/@scriptid");
            }
            
            var isFileFromWorkspace = path.charAt(0) == "/";
            
            var state = {
                path       : path,
                active     : true,
                value      : -1,
                document   : {
                    title  : path.substr(path.lastIndexOf("/") + 1),
                    ace    : {
                        scriptId    : scriptId,
                        debug       : isFileFromWorkspace ? 0 : 1,
                        lineoffset  : 0
                    }
                }
            };
            if (row) {
                state.document.ace.jump = {
                    row    : row,
                    column : column
                };
            }

            if (emit("beforeOpen", {
                source    : findSource(scriptId) || { id : scriptId },
                state     : state,
                generated : options.generated
            }) === false)
                return;

            tabs.open(state, function(err, tab, done){
                emit("open", {
                    source    : findSource(scriptId) || { id : scriptId },
                    tab       : tab,
                    line      : row,
                    column    : column,
                    generated : options.generated,
                    done      : function(source){
                        tab.document.value = source;
                        // tab.document.getSession().jumpTo({
                        //     row    : row,
                        //     column : column
                        // });
                        // done();
                    }
                })
            });
        }
        
        function show(){
            draw();
            datagrid.show();
        }
        
        function hide(){
            datagrid.hide();
        }
        
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
        
            emit("scopeUpdate", {
                scope     : frame,
                variables : frame.variables
            });
        
            // Update scopes if already loaded
            frame.scopes && frame.scopes.forEach(function(scope){
                if (scope.variables) {
                    emit("scopeUpdate", {scope: scope});
                }
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
         * @param {Object} e
         *     node     {XMLNode} description
         *     oldpath  {String} description
         **/
        plugin.freezePublicAPI({
            get activeFrame(){ return activeFrame; },
            set activeFrame(frame){ setActiveFrame(frame); },
            get sources(){ return sources; },
            get frames(){ return frames; },
            
            get modelSources(){ return modelSources; },
            get modelFrames(){ return modelFrames; },
            
            /**
             * 
             */
            draw : draw,
            
            /**
             * 
             */
            show : show,
            
            /**
             * 
             */
            hide : hide,
            
            /**
             * 
             */
            showDebugFrame : showDebugFrame,
            
            /**
             * 
             */
            showDebugFile : showDebugFile,
            
            /**
             * 
             */
            openFile : openFile,
            
            /**
             * 
             */
            findSource : findSource,
            
            /**
             * 
             */
            findSourceByPath : findSourceByPath,
            
            /**
             * 
             */
            findSourceXml : findSourceXml,
            
            /**
             * 
             */
            findFrame : findFrame,
            
            /**
             * 
             */
            findFrameXml : findFrameXml,
            
            /**
             * 
             */
            loadFrames : loadFrames,
            
            /**
             * 
             */
            loadSources : loadSources,
            
            /**
             * 
             */
            clearFrames : clearFrames,
            
            /**
             * 
             */
            addSource : addSource,
            
            /**
             * 
             */
            updateAll : updateAll,
            
            /**
             * 
             */
            updateFrame : updateFrameXml,
            
            /**
             * 
             */
            updateMarker : updateMarker
        });
        
        register(null, {
            callstack: plugin
        });
    }
});