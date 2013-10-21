define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "ui", "debugger", "immediate.debugnode", "language", 
        "tabManager", "callstack", "ace"
    ];
    main.provides = ["liveinspect"];
    return main;

    function main(options, imports, register) {
        var Plugin     = imports.Plugin;
        var ui         = imports.ui;
        var ace        = imports.ace;
        var language   = imports.language;
        var debug      = imports.debugger;
        var tabManager = imports.tabManager;
        var callstack  = imports.callstack;
        var evaluator  = imports["immediate.debugnode"];
        
        // var inspector = require("ext/debugger/inspector");
        
        // postfix plugin because debugger is restricted keyword
        var Range  = require("ace/range").Range;
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit   = plugin.getEmitter();
        
        var activeTimeout     = null;
        var windowHtml        = null;
        var datagridHtml      = null;
        var currentExpression = null;
        var marker            = null;
        var isOpen            = false;
        
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
            
            // Import Skin
            ui.insertSkin({
                name         : "liveinspect",
                data         : require("text!./liveinspect.skin.xml"),
                "media-path" : options.staticPrefix + "/images/",
                "icon-path"  : options.staticPrefix + "/icons/"
            }, plugin);
            
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
            // apf.addListener(datagridHtml, "mouseover", function() {
            //     if (activeTimeout) {
            //         clearTimeout(activeTimeout);
            //         activeTimeout = null;
            //     }
            // });
    
            // we should track mouse movement over the whole window
            // apf.addListener(document, "mousemove", onDocumentMouseMove);
    
            // yes, this is superhacky but the editor function in APF is crazy
            // apf.addListener(datagridHtml, "dblclick", initializeEditor);
    
            // when collapsing or expanding the datagrid we want to resize
            // dgLiveInspect.addEventListener("expand", resizeWindow);
            // dgLiveInspect.addEventListener("collapse", resizeWindow);
        
            emit("draw");
        }
        
        /***** Methods *****/
        
        function resizeWindow(){
            // var gridRows = datagridHtml.querySelectorAll(".row");
            // // iterate over all properties
            // var rows = Object.keys(gridRows)
            //     .filter(function (r) { return !isNaN(r); }) // filter non numeric properties
            //     .map(function (r) { return gridRows[r]; }) // map them into real objects
            //     .filter(function (r) { return r.offsetHeight > 0; }); // check whether they are visible
    
            // // if we have any rows
            // if (rows && rows.length) {
            //     // determine height based on first one
            //     var height = rows[0].offsetHeight * rows.length;
    
            //     // add border of the container
            //     height += (windowHtml.scrollHeight - windowHtml.offsetHeight);
    
            //     // find header
            //     var header = datagridHtml.querySelector(".headings");
            //     if (header) {
            //         height += header.offsetHeight;
            //     }
    
            //     // we don't want this to fall of the screen
            //     var maxHeight = (window.innerHeight - container.$ext.offsetTop) - 30;
            //     if (height > maxHeight) {
            //         height = maxHeight;
            //     }
    
            //     // update height
            //     container.$ext.style.height = height + "px";
            // }
        };
    
        /**
         * WARNING this is a piece of junk
         * Initialize an editor in the place of the 'value' field when doubleclicking
         */
        // function initializeEditor(ev) {
        //     // get the real clicked element
        //     var target = ev.target;
    
        //     // only interested in the node with index 1
        //     if (target.tagName === "U" /* its in an <u> */
        //       && target.parentNode.parentNode.childNodes[1] === target.parentNode /* [1] index */
        //       && !target.parentNode.hid /* and no header */) {
    
        //         // bug in APF? When having only 1 item the 'selected' property isnt set properly
        //         var selected = dgLiveInspect.selected;
        //         if (!selected && dgLiveInspect.getModel().data.childNodes.length === 1) {
        //             // because you just doubleclicked an item, well just grab the only one
        //             selected = dgLiveInspect.getModel().data.childNodes[0];
        //         }
    
        //         // check whether we are able to edit this item
        //         if (!inspector.isEditable(selected)) {
        //             return;
        //         }
    
        //         // V8 debugger cannot change variables that are locally scoped, so we need at least
        //         // one parent property.
        //         if (inspector.calcName(selected, true).indexOf('.') === -1) {
        //             return;
        //         }
    
        //         // get current display property
        //         var originalDisplay = target.style.display;
    
        //         // create new simple input field
        //         var edit = document.createElement("input");
        //         edit.type = "text";
        //         edit.value = target.innerText;
        //         edit.style.width = "98%";
        //         edit.style.outline = "0";
        //         edit.style.border = "solid 1px gray";
        //         edit.style.height = "13px";
        //         edit.style["margin-top"] = "1px";
    
        //         // update variable
        //         var onBlur = function () {
        //             // remove to stop further prop
        //             edit.removeEventListener("blur", onBlur);
    
        //             // test for correct value
        //             if (!inspector.validateNewValue(selected, this.value)) {
        //                 alert("invalid value for type " + selected.getAttribute("type"));
        //                 return false;
        //             }
    
        //             // remove the texteditor
        //             this.parentNode.removeChild(this);
    
        //             // restore the label
        //             target.style.display = originalDisplay;
        //             target.innerText = this.value;
    
        //             inspector.setNewValue(selected, this.value, function (res) { });
        //         };
    
        //         // when blurring, update
        //         apf.addListener(edit, "blur", onBlur);
    
        //         // on keydown, same same
        //         apf.addListener(edit, "keydown", function(ev) {
        //             if (ev.keyCode === 27 || ev.keyCode === 13) { // tab or enter
        //                 return onBlur.call(this);
        //             }
        //             if (ev.keyCode === 32) {  // somewhere in APF the space is captured; no clue why
        //                 this.value += " "; // this is super lame, but better than nothing
        //             }
        //             return true;
        //         });
    
        //         // now hide the cur value
        //         target.style.display = "none";
        //         // and append textbox
        //         target.parentNode.appendChild(edit);
    
        //         // focus
        //         edit.focus();
        //     }
        // };
    
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
                
                windowHtml.style.left = ev.clientX + "px";
                windowHtml.style.top = (ev.clientY + 8) + "px";
            }, 450);
        };
    
        /**
         * onDocumentMove handler to clear the timeout
         */
        // function onDocumentMouseMove (ev) {
        //     if (!activeTimeout) {
        //         return;
        //     }
    
        //     // see whether we hover over the editor or the quickwatch window
        //     var mouseMoveAllowed = false;
    
        //     var eles = [ code.amlEditor, container ];
        //     // only the visible ones
        //     eles.filter(function (ele) { return ele.visible; })
        //         .map(function (ele) { return ele.$ext; }) // then get the HTML counterpart
        //         .forEach(function (ele) {
        //             // then detect real position
        //             var position = apf.getAbsolutePosition(ele, document.body);
        //             var left = position[0];
        //             var top = position[1];
    
        //             // x boundaries
        //             if (ev.pageX >= left && ev.pageX <= (left + ele.offsetWidth)) {
        //                 // y boundaries
        //                 if (ev.pageY >= top && ev.pageY <= (top + ele.offsetHeight)) {
        //                     // we are in the editor, so return; this will be handled
        //                     mouseMoveAllowed = true;
        //                 }
        //             }
        //         });
    
        //     if (mouseMoveAllowed) return;
    
        //     // not in the editor?
        //     if (container.visible) {
        //         // if we are visible, then give the user 400 ms to get back into the window
        //         // otherwise hide it
        //         if (activeTimeout)
        //             clearTimeout(activeTimeout);
        //         activeTimeout = setTimeout(hide, 400);
        //     }
        //     else {
        //         // if not visible? then just clear the timeout
        //         clearTimeout(activeTimeout);
        //         activeTimeout = null;
        //     }
        // };
    
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
            
            addMarker(data);
            
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
                }
            }, function(){
                // store it
                currentExpression = expr;
    
                // show window
                container.show();
    
                // resize the window
                resizeWindow();
            });
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
    
        function addMarker (data) {
            var pos = data.pos;
            if (marker) {
                marker.session.removeMarker(marker.id);
            }
    
            debugger; // @todo find path to fetch ace
            var session = code.amlEditor.$editor.session;
            if (pos.el != pos.sl && data.value.indexOf("\n") == -1) {
                pos.el = pos.sl;
                pos.ec = session.getLine(pos.sl).length;
            }
    
            var range = new Range(pos.sl, pos.sc, pos.el, pos.ec);
            marker = {
                session: session,
                id: session.addMarker(range, "ace_bracket", "text", true),
                range: range
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