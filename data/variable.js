define(function(require, exports, module) {
    
    var Data = require("./data");
    
    function Variable(options){
        this.data    = options || {};
        this.tagName = "variable";
    }
    
    Variable.prototype = new Data(
        ["name", "value", "type", "ref", "scope", "children", "error"],
        ["properties"]
    );
    
    Variable.prototype.findVariable = function(ref, name, parents){
        if (ref && typeof ref == "object")
            ref = ref.getAttribute("ref");
        
        var vars = this.data.properties || [];
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
        
    Variable.prototype.equals = function(variable){
        if (!variable) return false;
        return this.data.id == variable.id;
    };
    
    module.exports = Variable;
    
});