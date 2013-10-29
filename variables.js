define(function(require, exports, module) {
    main.consumes = [
        "DebugPanel", "ui", "util", "debugger", "callstack"
    ];
    main.provides = ["variables"];
    return main;

    function main(options, imports, register) {
        var DebugPanel = imports.DebugPanel;
        var ui         = imports.ui;
        var callstack  = imports.callstack;
        var debug      = imports.debugger;
        var util       = imports.util;
        
        var markup   = require("text!./variables.xml");
        var Tree     = require("ace_tree/tree");
        var TreeData = require("ace_tree/data_provider");
        
        /***** Initialization *****/
        
        var plugin = new DebugPanel("Ajax.org", main.consumes, {
            caption : "Scope Variables",
            index   : 300
        });
        var emit   = plugin.getEmitter();
        
        var activeFrame, dbg, cached = {};
        var model, datagrid; // UI Elements
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            model = new TreeData();
            model.emptyMessage = "No variables to display";
            
            // <a:each match="[scope|variable]" sort="[@name]" sort-method="scopesort">
            // <a:insert match="[scope]" />
            // <a:insert match="[node()[@children='true']]" />
            model.columns = [{
                caption : "Property",
                value   : "name",
                defaultValue : "Scope",
                width   : "40%",
                icon    : "debugger/genericvariable_obj.gif",
                tree    : "true"
            }, {
                caption : "Value",
                value   : "value",
                width   : "60%",
                editor  : "textbox" 
            }, {
                caption : "Type",
                value   : "type",
                width   : "50"
            }];
            
            
            model.getChildren = function(node) {
                if (node.status === "pending" || node.status === "loading")
                    return null;
                
                var children = node.variables || node.properties || node.items;
                if (!children)
                    node.status = "pending";
                var ch = children && children[0] && children[0];
                if (ch) {
                    var d = (node.$depth + 1) || 0;
                    children.forEach(function(n) {
                        n.$depth = d;
                        n.parent = node;
                    });
                }
        
                if (this.$sortNodes && !node.$sorted) {
                    children && this.sort(children);
                }
                return children;
            };
            
            model.hasChildren = function(node) {
                return node.children || node.tagName == "scope";
            };
            
            model.getCaptionHTML = function(node) {
                if (node.tagName == "scope")
                    return node.name || "Scope";
                return node.name || ""
            }
            
            model.sort = function(children) {
                var compare = TreeData.alphanumCompare;
                return children.sort(function(a, b) {
                    var aIsSpecial = a.tagName == "scope";
                    var bIsSpecial = b.tagName == "scope";
                    if (aIsSpecial && !bIsSpecial) return 1;
                    if (!aIsSpecial && bIsSpecial) return -1;
                    if (aIsSpecial && bIsSpecial) return a.index - b.index;
                    
                    return compare(a.name || "", b.name || "");
                });
            };
            
            model.getChildrenAsync = function(node, callback) {
                emit("expand", {
                    node: node,
                    expand: callback
                });
            };

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
            
            callstack.on("scopeUpdate", function(e){
                updateScope(e.scope, e.variables);
            });
            callstack.on("framesLoad", function(e){
                // Clear the cached states of the variable datagrid
                clearCache();
            });
            
            // When clicking on a frame in the call stack show it 
            // in the variables datagrid
            callstack.on("frameActivate", function(e){
                // @todo reload the clicked frame recursively + keep state
                loadFrame(e.frame);
            }, plugin);
            
            // Variables
            plugin.on("expand", function(e){
                if (e.node.tagName != "scope") {
                    //<a:insert match="[item[@children='true']]" get="{adbg.loadObject(dbg, %[.])}" />
                    dbg.getProperties(e.node, function(err, properties){
                        if (err) return console.error(err);
                        
                        //updateVariable(e.node, properties);
                        e.expand();
                    });
                }
                // Local scope
                // else if (e.scope.type == 1) {
                //     //updateScope(e.scope);
                //     e.expand();
                // }
                // Other scopes
                else {
                    dbg.getScope(model.frame/*debug.activeFrame*/, e.node, function(err, vars){
                        if (err) return console.error(err);
                        
                        //updateScope(e.node, vars);
                        e.expand();
                    });
                }
            }, plugin);
        }

        var drawn;
        function draw(options){
            if (drawn) return;
            drawn = true;
            
            // Create UI elements
            ui.insertMarkup(options.aml, markup, plugin);
        
            datagrid = plugin.getElement("datagrid");
            
            var datagridEl = plugin.getElement("datagrid");
            datagrid = new Tree(datagridEl.$ext);
            datagrid.renderer.setTheme({cssClass: "blackdg"});
            datagrid.setOption("maxLines", 200);
            model.rowHeight = 18;
            datagrid.setDataProvider(model);
            
            datagrid.on("contextmenu", function(){
                return false;
            });
            /*
            
            datagrid.on("afterchange", function(e){
                var node  = e.xmlNode;
                var value = node.getAttribute("value");
                
                var parents    = [];
                var variable   = activeFrame.findVariable(node, null, parents);
                var oldValue   = variable.value;
                
                variable.value = value;
                
                function undo(){
                    variable.value = oldValue;
                    apf.xmldb.setAttribute(node, "value", oldValue);
                }
                
                // Set new value
                dbg.setVariable(variable, parents, 
                  value, debug.activeFrame, function(err){
                    if (err) 
                        return e.undo();
                        
                    // Reload properties of the variable
                    // dbg.getProperties(variable, function(err, properties){
                        updateVariable(variable, variable.properties, node);
                        
                        emit("variableEdit", {
                            value    : value,
                            oldValue : oldValue,
                            node     : node,
                            variable : variable,
                            frame    : activeFrame,
                            parents  : parents
                        });
                    // });
                });
            });
            
            datagrid.on("before.edit", function(e){
                if (!plugin.enabled)
                    return false;
                
                // Don't allow setting the value of scopes
                if (datagrid.selected.localName == "scope")
                    return false;
                
                // Don't allow setting "this"
                if (datagrid.selected.getAttribute("name") == "this")
                    return false;
            });
            
            datagrid.on("editor.create", function(e){
                var tb = e.editor;
            });
            */
        }
        
        /***** Methods *****/
        
        function loadFrame(frame){
            if (frame == activeFrame)
                return;
            
            model.frame = frame;

            if (!frame) {
                model.setRoot({});
            }
            else {
                if (cached[frame.id])
                    model.setRoot(cached[frame.id]);
                else {
                    model.setRoot([].concat(frame.variables, frame.scopes));
                    cached[frame.id] = model.root;
                }
            }
            
            activeFrame = frame;
        }
        
        function updateNode(node, variable, oldVar){
            var isOpen = node.isOpen;
            model.close(node, null, false);
            if (isOpen)
                model.open(node, null, false);
        }
        
        function updateScope(scope, variables){
            updateNode(scope);
        }
        
        function updateVariable(variable, properties, node){
            updateNode(variable);
        }
        
        function clearCache(){
            cached = {};
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
            plugin.once("draw", draw);
        });
        plugin.on("enable", function(){
            drawn && datagrid.enable();
        });
        plugin.on("disable", function(){
            drawn && datagrid.disable();
        });
        plugin.on("unload", function(){
            loaded = false;
            drawn  = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * The local variables and scopes panel for the 
         * {@link debugger Cloud9 debugger}.
         * 
         * This panel displays the local variables and scopes to the user. A
         * user can expand variables and scopes to inspect properties and 
         * variables and edit them.
         * 
         * @singleton
         * @extends DebugPanel
         **/
        plugin.freezePublicAPI({
            /**
             * Sets the frame that the variables and scopes are displayed for.
             * @param {debugger.Frame} frame  The frame to display the variables and scopes from.
             */
            loadFrame : loadFrame,
            
            /**
             * Clears the variable/scope cache
             */
            clearCache : clearCache
        });
        
        register(null, {
            variables: plugin
        });
    }
});