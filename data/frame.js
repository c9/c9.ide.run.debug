define(function(require, exports, module) {
    
    var Data  = require("./data");
    var Scope = require("./scope");
    
    function Frame(options){
        this.data    = options || {};
        this.tagName = "frame";
    }
    
    Frame.prototype = new Data(
        [
            "id", "index", "name", "column", "ref", "line", 
            "path", "sourceId", "sourcemap"
        ], 
        ["variables", "scopes"]
    );
    
    Frame.prototype.findScope = function(index){
        if (typeof index == "object")
            index = index.getAttribute("index");
        
        var scopes = this.data.scopes || [];
        for (var i = 0, l = scopes.length; i < l; i++) {
            if (scopes[i].index == index)
                return scopes[i];
        }
        
        return false;
    }
        
    Frame.prototype.findVariable = function(ref, name, parents){
        var result = Scope.prototype.findVariable.apply(this, arguments);
        if (result)
            return result;
            
        var scopes = this.scopes;
        for (var i = 0, l = scopes.length; i < l; i++) {
            if (scopes[i].variables) {
                result = scopes[i].findVariable(ref, name, parents);
                if (result) {
                    parents && parents.push(scopes[i]);
                    return result;
                }
            }
        }
        return false;
    }
    
    // @todo maybe check ref?
    Frame.prototype.equals = function(frame){
        if (!frame) return false;
        return this.data.id == frame.id;// && this.data.path && frame.path;
    };
    
    module.exports = Frame;
    
});