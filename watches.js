define(function(require, exports, module) {
    main.consumes = [
        "DebugPanel", "settings", "ui", "util", "debugger"
    ];
    main.provides = ["watches"];
    return main;

    function main(options, imports, register) {
        var DebugPanel = imports.DebugPanel;
        var settings   = imports.settings;
        var ui         = imports.ui;
        var debug      = imports.debugger;
        var util       = imports.util;
        
        var markup   = require("text!./watches.xml");
        var Variable = require("./data/variable");
        
        /***** Initialization *****/
        
        var plugin = new DebugPanel("Ajax.org", main.consumes, {
            caption : "Watch Expressions",
            index   : 100
        });
        var emit   = plugin.getEmitter();
        
        var count   = 0;
        var watches = [];
        var dbg;
        var model, datagrid; // UI Elements
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            model = new ui.model();
            
            plugin.addElement(model);
            
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
                    updateAll();
            });
            
            debug.on("framesLoad", function(e){
                // Update Watchers
                updateAll();
            });
            
            // restore the variables from the IDE settings
            settings.on("read", function (e) {
                var watches = settings.getJson("user/watches") || [];
                model.load("<watches>" + watches.join("") 
                    + "<variable new='new' name='' value='' ref='new" + (count++) + "'/></watches>");
            });
        }

        var drawn;
        function draw(options){
            if (drawn) return;
            drawn = true;
            
            // Create UI elements
            ui.insertMarkup(options.aml, markup, plugin);
        
            datagrid = plugin.getElement("datagrid");
            datagrid.setAttribute("model", model);
            
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
                }
                else {
                    variable = findVariable(node, parents);
                    
                    if (changed == "value") {
                        oldValue = variable.value
                        variable.value = value;
                    }
                    else {
                        variable.name = name;
                        isNew = true;
                    }
                }
                
                setWatch(variable, value, isNew, oldValue, node, parents);
            });
            
            datagrid.on("before.edit", function(e){
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
            
            datagrid.on("keyup", function(e){
                if (e.keyCode == 13 && datagrid.$selected && !justEdited)
                    datagrid.$dblclick(datagrid.$selected.firstChild)
            });
        }
        
        /***** Methods *****/
        
        function setWatch(variable, value, isNew, oldValue, node, parents){
            if (!dbg)
                return; // We've apparently already disconnected.
            
            // Editing watches in the current or global frame
            // Execute expression
            if (isNew) {
                dbg.evaluate(variable.name, debug.activeFrame, 
                  !debug.activeFrame, true, function(err, serverVariable){
                    if (err) {
                        variable.value = err.message;
                        updateVariable(variable, [], node, true);
                        return;
                    }
                        
                    variable.json = serverVariable.json;

                    updateVariable(variable, 
                        variable.properties || [], node);
                })
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
                var node = findVariableXml(variable);
                if (!node) return;
                
                setWatch(variable, undefined, true, null, node, []);
                
                // emit("setWatch", {
                //     name     : variable.name,
                //     node     : node,
                //     isNew    : true,
                //     variable : variable,
                //     parents  : [],
                //     error    : function(message){
                //         variable.value      = message;
                //         variable.properties = null;
                        
                //         updateVariable(variable, [], node, true);
                //     },
                //     undo     : function(){}
                // });
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
        
        function findVariableXml(variable){
            return model.queryNode("//variable[@ref=" 
                + util.escapeXpathString(String(variable.ref)) + "]");
        }
        
        function updateVariableXml(node, variable, oldVar){
            node.setAttribute("value", oldVar.value = variable.value);
            node.setAttribute("type",  oldVar.type  = variable.type);
            node.setAttribute("ref",   oldVar.ref   = variable.ref);
            apf.xmldb.setAttribute(node, "children", oldVar.children = variable.children);
        }
        
        function updateVariable(variable, properties, node, error){
            // Pass node for recursive trees
            if (!node)
                node = findVariableXml(variable);
            if (!node || !node.parentNode)
                return;
            
            // Update xml node
            node.setAttribute("ref", variable.ref);
            node.setAttribute("value", variable.value);
            node.setAttribute("error", error ? "1" : "0");
            variable.error = error;
            apf.xmldb.setAttribute(node, "type", variable.type);
            
            var htmlNode = apf.xmldb.findHtmlNode(node, datagrid);
            htmlNode.childNodes[1].setAttribute("title", variable.value);
            
            if (node.childNodes.length && variable.properties
              && node.childNodes.length == variable.properties.length) {
                var vars = node.selectNodes("variable");
                
                variable.properties.forEach(function(prop, i){
                    var oldVar = variable.findVariable(null, prop.name);
                    updateVariableXml(vars[i], prop, oldVar);
                    
                    if (oldVar.properties) {
                        emit("expand", {
                            node     : vars[i],
                            variable : oldVar,
                            expand   : function(){}
                        });
                    }
                })
            }
            else {
                apf.mergeXml(apf.getXml("<p>" + properties.join("") + "</p>"), 
                    node, {clearContents : true});
                apf.xmldb.applyChanges("insert", node);
                //model.appendXml(properties.join(""), node);
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