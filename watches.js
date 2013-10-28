define(function(require, exports, module) {
    main.consumes = [
        "DebugPanel", "settings", "ui", "util", "debugger", "ace", "commands",
        "menus", "Menu", "MenuItem", "Divider"
    ];
    main.provides = ["watches"];
    return main;

    function main(options, imports, register) {
        var DebugPanel = imports.DebugPanel;
        var settings   = imports.settings;
        var ui         = imports.ui;
        var debug      = imports.debugger;
        var util       = imports.util;
        var menus      = imports.menus;
        var commands   = imports.commands;
        var ace        = imports.ace;
        var Menu       = imports.Menu;
        var MenuItem   = imports.MenuItem;
        var Divider    = imports.Divider;
        
        var keys     = require("ace/lib/keys");
        var markup   = require("text!./watches.xml");
        var Variable = require("./data/variable");
        var Tree     = require("ace_tree/tree");
        var TreeData = require("ace_tree/data_provider");
        
        /***** Initialization *****/
        
        var plugin = new DebugPanel("Ajax.org", main.consumes, {
            caption : "Watch Expressions",
            index   : 100
        });
        var emit   = plugin.getEmitter();
        
        var count   = 0;
        var watches = [];
        var dirty   = false;
        var dbg;
        var model, datagrid; // UI Elements
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            model = new TreeData();
            model.emptyMessage = "Type your expression here...";
            
            model.columns = [{
                caption:"Expression",
                match:"[@name]",
                value:"{[@name]||'Type your expression here...'}",
                width:"60%",
                icon:"debugger/genericvariable_obj.gif",
                tree:"true",
                editor:"textbox"
            }, { 
                caption:"Value",
                value:"[@value]",
                width:"40%",
                editor:"textbox"
            }, { 
                caption:"Type",
                value:"[@type]",
                width:"50"
            }]
            
            // Set and clear the dbg variable
            debug.on("attach", function(e){
                dbg = e.implementation;
                updateAll();
            });
            debug.on("detach", function(e){
                dbg = null;
            });
            debug.on("stateChange", function(e){
                plugin[e.action]();
                if (e.action == "enable")
                    updateAll();
            });
            
            debug.on("framesLoad", function(e){
                // Update Watchers
                updateAll();
            });
            
            // Add Watch hook into ace
            commands.addCommand({
                name        : "addwatchfromselection",
                bindKey     : { mac: "Command-Shift-C", win: "Ctrl-Shift-C" },
                hint        : "Add the selection as a watch expression",
                isAvailable : function(editor){ 
                    var ace = dbg && editor && editor.ace;
                    return ace && !ace.selection.isEmpty();
                },
                exec        : function(editor){ 
                    if (!editor.ace.selection.isEmpty())
                        addWatch(editor.ace.getCopyText());
                }
            }, plugin);
    
            // right click context item in ace
            ace.getElement("menu", function(menu) {
                menus.addItemToMenu(menu, new ui.item({
                    caption : "Add As Watch Expression",
                    command : "addwatchfromselection"
                }), 50, plugin);
            });
            
            // restore the variables from the IDE settings
            settings.on("read", function (e){
                (settings.getJson("state/watches") || []).forEach(function(name){
                    watches.push(new Variable({ 
                        name : name, 
                        ref  : "fromsettings" + count++ 
                    }));
                });
                
                model.setRoot(watches.join(""));
                
                if (dbg)
                    updateAll();
            });
            
            settings.on("write", function (e){
                if (dirty) {
                    settings.setJson("state/watches", watches.map(function(w){ 
                        return w.name;
                    }));
                    dirty = false;
                }
            });
        }

        var drawn;
        function draw(options){
            if (drawn) return;
            drawn = true;
            
            // Create UI elements
            ui.insertMarkup(options.aml, markup, plugin);
        
            var datagridEl = plugin.getElement("datagrid");
            datagrid = new Tree(datagridEl.$ext);
            datagrid.setOption("maxLines", 200);
            datagrid.setDataProvider(model);
            
            var contextMenu = new Menu({
                items : [
                    new MenuItem({ value: "edit1", caption: "Edit Watch Expression" }),
                    new MenuItem({ value: "edit2", caption: "Edit Watch Value" }),
                    new Divider(),
                    new MenuItem({ value: "remove", caption: "Remove Watch Expression" }),
                ]
            }, plugin);
            contextMenu.on("itemclick", function(e){
                if (e.value == "edit1")
                    datagrid.$dblclick(datagrid.$selected.childNodes[0]);
                else if (e.value == "edit2")
                    datagrid.$dblclick(datagrid.$selected.childNodes[1]);
                else if (e.value == "remove")
                    datagrid.remove();
            });
            contextMenu.on("show", function(e) {
                var selected = datagrid.selected;
                var isNew    = selected && selected.getAttribute("new");
                var isProp   = selected.parentNode.localName != "watches";
                contextMenu.items[0].disabled = !selected || isProp;
                contextMenu.items[1].disabled = !selected || !!isNew;
                contextMenu.items[3].disabled = !selected || !!isNew || isProp;
            });
            
            datagridEl.setAttribute("contextmenu", contextMenu.aml);
            
            datagrid.on("beforeinsert", function(e){
                var node = e.xmlNode;

                var event = {
                    node   : node,
                    expand : function(){
                        var htmlNode = apf.xmldb.getHtmlNode(node, datagrid);
                        if (htmlNode)
                            datagrid.slideOpen(null, node, true);
                    }
                };
                event.variable = findVariable(node);

                emit("expand", event);
                return false;
            });
            
            datagrid.on("afterremove", function(e){
                var idx = watches.indexOf(findVariable(e.args[0].args[0]));
                watches.splice(idx, 1);
                
                dirty = true;
                settings.save();
            });
            
            var justEdited = false;
            
            datagrid.on("afterchange", function(e){
                var node    = e.xmlNode;
                var name    = node.getAttribute("name");
                var value   = node.getAttribute("value");
                var isNew   = node.getAttribute("new");
                var changed = e.args[1];
                var parents = [];
                var variable, oldValue;
                
                // Delete a watch by removing the expression
                if (!name) {
                    apf.xmldb.removeNode(node);
                    return;
                }
                
                // If we've filled a new watch remove the new attribute
                if (isNew) {
                    apf.xmldb.removeAttribute(node, "new");
                    
                    var newNode = apf.getXml("<variable new='new' name='' "
                        + "value='' ref='new" + (count++) + "' />");
                        newNode = ui.xmldb.appendChild(model.data, newNode, model.data.firstChild);
                    model.appendXml(newNode); //apf hack
                    
                    variable = new Variable({
                        name  : name,
                        value : value,
                        ref   : node.getAttribute("ref")
                    });
                    watches.push(variable);
                    
                    dirty = true;
                    settings.save();
                }
                else {
                    variable = findVariable(node, parents);
                    
                    if (changed == "value") {
                        oldValue = variable.value
                        variable.value = value;
                        
                        dirty = true;
                        settings.save();
                    }
                    else {
                        variable.name = name;
                        isNew = true;
                    }
                }
                
                setWatch(variable, value, isNew, oldValue, node, parents);
            });
            
            datagrid.on("before.edit", function(e){
                if (!plugin.enabled)
                    return false;
                
                // Don't allow setting the value of new variables
                if (e.heading.caption == "Value" 
                  && datagrid.selected.getAttribute("ref").substr(0,3) == "new") {
                    datagrid.$dblclick(datagrid.$selected.firstChild)
                    return false;
                }
                
                // When editing a property name, always force editing the value
                if (e.heading.caption == "Expression"
                  && datagrid.selected.parentNode.localName != "watches") {
                    datagrid.$dblclick(datagrid.$selected.childNodes[1])
                    return false;
                }
            });
            
            datagrid.on("editor.create", function(e){
                var tb = e.editor;
                
                tb.on("keydown", function(e){
                    if (e.keyCode == 13) {
                        justEdited = true;
                        setTimeout(function(){ justEdited = false }, 500);
                    }
                });
            });
            
            datagrid.on("keydown", function(e){
                if (keys[e.keyCode] && keys[e.keyCode].length == 1
                  && datagrid.$selected && !justEdited)
                    datagrid.$dblclick(datagrid.$selected.firstChild)
            });
            
            datagrid.on("keyup", function(e){
                if (e.keyCode == 13 && datagrid.$selected && !justEdited)
                    datagrid.$dblclick(datagrid.$selected.firstChild)
            });
        }
        
        /***** Methods *****/
        
        function addWatch(expression){
            var variable = new Variable({
                name  : expression,
                value : "",
                ref   : ""
            });
            watches.push(variable);
            
            var newNode;
            
            dirty = true;
            settings.save();
            
            setWatch(variable, null, true, null, newNode, []);
        }
        
        function setWatch(variable, value, isNew, oldValue, node, parents){
            if (!dbg)
                return; // We've apparently already disconnected.
            
            // Editing watches in the current or global frame
            // Execute expression
            if (isNew) {
                dbg.evaluate(variable.name, debug.activeFrame, 
                  !debug.activeFrame, true, function(err, serverVariable){
                    if (err) {
                        variable.value      = err.message;
                        variable.properties = null;
                        updateVariable(variable, [], node, true);
                        return;
                    }
                        
                    variable.json = serverVariable.json;

                    updateVariable(variable, 
                        variable.properties || [], node);
                });
            }
            // Set new value of a property
            else {
                dbg.setVariable(variable, parents, 
                  value, debug.activeFrame, function(err){
                    if (err) {
                        variable.value = oldValue;
                        apf.xmldb.setAttribute(node, "value", oldValue);
                        return;
                    }
                        
                    // Reload properties of the variable
                    dbg.getProperties(variable, function(err, properties){
                        updateVariable(variable, properties, node);
                    });
                });
            }
            
            emit("setWatch", {
                name     : name,
                value    : value,
                node     : node,
                isNew    : isNew,
                variable : variable,
                parents  : parents
            });
        }
        
        function updateAll(){
            watches.forEach(function(variable){
                var node = findVariableNode(variable);
                if (!node) return;
                
                setWatch(variable, undefined, true, null, node, []);
            });
        }
        
        function findVariable(ref, parents){
            if (typeof ref == "object")
                ref = ref.getAttribute("ref");
            
            var result;
            for (var i = 0, l = watches.length; i < l; i++) {
                if (watches[i].ref == ref)
                    return watches[i];
                
                result = watches[i].findVariable(ref, null, parents);
                if (result) return result;
            }
        }
        
        function findVariableNode(variable){
            return variable;
        }
        
        function updateVariableNode(node, variable, oldVar){
            model._signal("change", node);
        }
        
        function updateVariable(variable, properties, node, error){
            // Pass node for recursive trees
            if (!node)
                node = findVariableNode(variable);
            if (!node || !node.parentNode)
                return;
            
            // Update ace_tree node
            model._signal("change", variable);
            
            if (node.childNodes.length && variable.properties
              && node.childNodes.length == variable.properties.length) {
                var vars = node.selectNodes("variable");
                
                variable.properties.forEach(function(prop, i){
                    var oldVar = variable.findVariable(null, prop.name);
                    updateVariableNode(vars[i], prop, oldVar);
                    
                    if (oldVar.properties) {
                        emit("expand", {
                            node     : vars[i],
                            variable : oldVar,
                            expand   : function(){}
                        });
                    }
                });
            }
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
            plugin.once("draw", draw);
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
         * The watch expression panel for the {@link debugger Cloud9 debugger}.
         * 
         * This panel allows a user to add small expressions that are evaluated
         * continuously, displaying the result of the expression in the UI. This
         * allows a user to monitor what is going on while stepping through the
         * code.
         * 
         * @singleton
         * @extends DebugPanel
         **/
        plugin.freezePublicAPI({
            /**
             * A list of variables that are watched.
             * @param {debugger.Variable[]} watches  The list of variables watched.
             */
            get watches(){ return watches; },
            
            /**
             * Re-evaluate all watch expressions.
             */
            updateAll : updateAll
        });
        
        register(null, {
            watches: plugin
        });
    }
});