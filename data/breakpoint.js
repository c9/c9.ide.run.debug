define(function(require, exports, module) {
    
    var Data = require("./data");
    
    //var location = bp.script_name + "|" + bp.line + ":" + (bp.column || 0);
    function Breakpoint(options){
        this.data    = options || {};
        this.tagName = "breakpoint";
    }
    
    Breakpoint.prototype = new Data([
        "id", "path", "text", "line", "column", "serverOnly", "actual",
        "content", "enabled", "sourcemap", "condition"
    ]);
        
    Breakpoint.prototype.equals = function(breakpoint){
        if (!breakpoint) return false;
        
        if (this.data.id && this.data.id === breakpoint.id) 
            return true;
        
        if (this.data.line === breakpoint.line && this.data.path === breakpoint.path)
            return true;
        
        var sm = this.data.sourcemap;
        if (sm && sm.line === breakpoint.line && sm.source === breakpoint.path)
            return true;
            
        var smo = breakpoint.sourcemap;
        if (smo && this.data.line === smo.line && this.data.path === smo.source)
            return true;
            
        if (sm && smo && sm.line === smo.line && sm.source === smo.source)
            return true;
        
        return false;
    };
    
    module.exports = Breakpoint;
    
});