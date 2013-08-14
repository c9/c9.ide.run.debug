define(function(require, exports, module) {
    
    var Data = require("./data");
    
    function Scope(options){
        this.data    = options || {};
        this.tagName = "scope";
    }

    Scope.prototype = new Data(
        ["index", "frameIndex", "type"],
        ["variables"]
    );
    
    Scope.prototype.findVariable = function(ref, name, parents){
        if (ref && typeof ref == "object")
            ref = ref.getAttribute("ref");
        
        var vars = this.data.variables || [];
        for (var i = 0, l = vars.length; i < l; i++) {
            if (vars[i].ref == ref || vars[i].name == name)
                return vars[i];
            else if (vars[i].properties) {
                var result = vars[i].findVariable(ref, name, parents);
                if (result) {
                    parents && parents.push(vars[i]);
                    return result;
                }
            }
        }
        
        return false;
    }
        
    Scope.prototype.equals = function(scope){
        if (!scope) return false;
        return this.data.index == scope.index 
          && this.data.frameIndex == scope.frameIndex;
    };
    
    module.exports = Scope;
    
});