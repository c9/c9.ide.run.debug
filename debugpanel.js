define(function(require, module, exports) {
    main.consumes = ["Plugin", "ui", "debugger"];
    main.provides = ["DebugPanel"];
    return main;

    function main(options, imports, register) {
        var Plugin    = imports.Plugin;
        var ui        = imports.ui;
        var debug     = imports.debugger;
        
        function DebugPanel(developer, deps, options){
            // Editor extends ext.Plugin
            var plugin = new Plugin(developer, deps);
            var emit   = plugin.getEmitter();
            emit.setMaxListeners(1000);
            
            var caption = options.caption;
            var amlFrame;
            
            plugin.on("load", function(){
                // Draw panel when debugger is drawn
                debug.on("drawPanels", draw, plugin);
                
                
            });
            
            function draw(e){
                amlFrame = ui.frame({ 
                    htmlNode    : e.html,
                    buttons     : "min",
                    activetitle : "min",
                    caption     : caption
                });
                
                emit("draw", { aml: amlFrame, html: amlFrame.$int });
            }
            
            /***** Methods *****/
            
            function show(){
                draw();
                amlFrame.show();
            }
            
            function hide(){
                amlFrame.hide();
            }
            
            /***** Register and define API *****/
            
            plugin.freezePublicAPI.baseclass();
            
            /**
             * 
             * @class DebugPanel
             * @extends Plugin
             */
            /**
             * @constructor
             * Creates a new DebugPanel instance.
             * @param {String}   developer   The name of the developer of the plugin
             * @param {String[]} deps        A list of dependencies for this 
             *   plugin. In most cases it's a reference to `main.consumes`.
             */
            plugin.freezePublicAPI({
                /**
                 * The APF UI element that is presenting the pane in the UI.
                 * This property is here for internal reasons only. *Do not 
                 * depend on this property in your plugin.*
                 * @property {AmlElement} aml
                 * @private
                 * @readonly
                 */
                get aml(){ return amlFrame; },
                
                _events : [
                    
                ],
                    
                /**
                 * 
                 */
                show : show,
                
                /**
                 * 
                 */
                hide : hide
            });
            
            return plugin;
        }
        
        /***** Register and define API *****/
        
        register(null, {
            DebugPanel: DebugPanel
        })
    }
});