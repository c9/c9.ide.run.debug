/**
 * variables for Cloud9 IDE
 *
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "settings", "ui", "layout", "util"
    ];
    main.provides = ["variables"];
    return main;

    function main(options, imports, register) {
        var Plugin   = imports.Plugin;
        var settings = imports.settings;
        var ui       = imports.ui;
        var layout   = imports.layout;
        var util     = imports.util;
        
        var markup   = require("text!./variables.xml");
        var Variable = require("./data/variable");
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit   = plugin.getEmitter();
        
        var activeFrame, cached = {};
        var model, datagrid; // UI Elements
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            model = new ui.model();
            
            plugin.addElement(model);
            
            // restore the variables from the IDE settings
            settings.on("read", function (e) {
                settings.setDefaults("user/variables", [["show", "false"]]);
                
                if (settings.getBool("user/variables/@show"))
                    show();
            });
            
            settings.on("write", function (e) {
                
            });
        }

        var drawn;
        function draw(options){
            if (drawn) return;
            drawn = true;
            
            // Create UI elements
            ui.insertMarkup(options.container, markup, plugin);
        
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
                if (node.localName == "scope") {
                    event.scope = activeFrame.findScope(node);
                }
                else if (node.localName == "variable") {
                    var parent = node.parentNode;
                    while (parent && parent.localName != "scope") {
                        parent = parent.parentNode;
                    }
                    
                    var scope = parent 
                        ? activeFrame.findScope(parent) 
                        : activeFrame;
                    event.variable = scope.findVariable(node);
                }

                emit("expand", event);
                return false;
            });
            
            datagrid.on("afterchange", function(e){
                var node  = e.xmlNode;
                var value = node.getAttribute("value");
                
                var parents    = [];
                var variable   = activeFrame.findVariable(node, null, parents);
                var oldValue   = variable.value;
                
                variable.value = value;
                
                emit("variableEdit", {
                    value    : value,
                    oldValue : oldValue,
                    node     : node,
                    variable : variable,
                    frame    : activeFrame,
                    parents  : parents,
                    undo     : function(){
                        variable.value = oldValue;
                        apf.xmldb.setAttribute(node, "value", oldValue);
                    }
                });
            });
            
            datagrid.on("beforeEdit", function(e){
                // Don't allow setting the value of scopes
                if (datagrid.selected.localName == "scope")
                    return false;
                
                // Don't allow setting "this"
                if (datagrid.selected.getAttribute("name") == "this")
                    return false;
            });
            
            datagrid.on("editorCreate", function(e){
                var tb = e.editor;
            });
            
            emit("draw");
        }
        
        /***** Methods *****/
        
        function show(){
            draw();
            datagrid.show();
        }
        
        function hide(){
            datagrid.hide();
        }
        
        function loadFrame(frame){
            if (frame == activeFrame)
                return;

            if (!frame)
                model.clear();
            else {
                if (cached[frame.id])
                    model.load(cached[frame.id]);
                else {
                    model.load(frame.xml);
                    cached[frame.id] = model.data;
                }
            }
                
            activeFrame = frame;
        }
        
        function findVariableXml(variable){
            return model.queryNode("//variable[@ref=" 
                + util.escapeXpathString(String(variable.ref)) + "]");
        }
        
        function findScopeXml(scope){
            return model.queryNode("//scope[@index=" 
                + util.escapeXpathString(String(scope.index)) + "]");
        }
        
        function updateVariableXml(node, variable, oldVar){
            node.setAttribute("value", oldVar.value = variable.value);
            node.setAttribute("type",  oldVar.type  = variable.type);
            node.setAttribute("ref",   oldVar.ref   = variable.ref);
            if (variable.children && !oldVar.children) {
                datagrid.$setLoadStatus(node, "potential");
                datagrid.$fixItem(node, ui.xmldb.findHtmlNode(node, datagrid));
            }
            apf.xmldb.setAttribute(node, "children", oldVar.children = variable.children);
        }
        
        function updateScope(scope, variables){
            var update = scope.equals(activeFrame);
            var node   = update ? model.data : findScopeXml(scope);
            if (!node) return;
            
            if (update || node.childNodes.length
              && node.childNodes.length == scope.variables.length) {
                var vars = node.selectNodes("variable");
                
                variables.forEach(function(variable, i){
                    var oldVar = (update ? activeFrame : scope).findVariable(null, variable.name);
                    if (vars[i])
                        updateVariableXml(vars[i], variable, oldVar);
                    else
                        debugger; //This shouldn't happen, but it does
                    
                    if (oldVar.properties) {
                        emit("expand", {
                            node     : vars[i],
                            variable : oldVar,
                            expand   : function(){}
                        });
                    }
                });
            }
            else {
                apf.mergeXml(apf.getXml("<p>" + variables.join("") + "</p>"), 
                    node, {clearContents : true});
                apf.xmldb.applyChanges("insert", node);
                //model.appendXml(variables.join(""), node);
            }
        }
        
        function updateVariable(variable, properties, node){
            // Pass node for recursive trees
            if (!node)
                node = findVariableXml(variable);
            if (!node || !node.parentNode)
                return;
            
            // Update xml node
            node.setAttribute("ref", variable.ref);
            node.setAttribute("value", variable.value);
            apf.xmldb.setAttribute(node, "type", variable.type);
            
            if (node.childNodes.length 
              && node.childNodes.length == variable.properties.length) {
                var vars = node.selectNodes("variable");
                
                properties.forEach(function(prop, i){
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
        
        function clearCache(){
            cached = {};
            datagrid && datagrid.clearAllCache();
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
            loadFrame : loadFrame,
            
            /**
             * 
             */
            updateScope : updateScope,
            
            /**
             * 
             */
            updateVariable : updateVariable,
            
            /**
             * 
             */
            clearCache : clearCache
        });
        
        register(null, {
            variables: plugin
        });
    }
});