define(function(require, exports, module) {
    
    var Data = require("./data");
    
    function Source(options){
        this.data    = options || {};
        this.tagName = "source";
    }
    
    Source.prototype = new Data([
        "id", "name", "path", "text", "lineOffset", "debug"
    ]);
        
    Source.prototype.equals = function(source){
        if (!source) return false;
        return this.data.ref == source.ref;
    };
    
    module.exports = Source;
    
});