define(function(require, exports, module) {
    
    function Data(props, sets){
        this.$props = props || [];
        this.$sets  = sets || [];
        
        var _self = this;
        this.$props.concat(this.$sets).forEach(function(prop){
            _self.__defineGetter__(prop, function(){ 
                return this.data[prop];
            });
            _self.__defineSetter__(prop, function(v){ 
                this.data[prop] = v;
//                throw new Error("Cannot set property of " 
//                    + this.tagName.uCaseFirst())
            });
        })
    }
    Data.prototype = {
        get xml(){
            var str = "<" + this.tagName;

            var _self = this;
            this.$props.forEach(function(prop){
                if (_self.data[prop] !== undefined)
                    str += " " + (prop + '="' 
                        + apf.escapeXML(_self.data[prop]) + '"');
            });
            
            if (this.$sets.length) {
                str += ">";
                this.$sets.forEach(function(prop){
                    if (_self.data[prop])
                        str += _self.data[prop].join("");
                });
                str += "</" + this.tagName + ">";
            }
            else {
                 str += " />";
            }
            
            return str;
        },
        set xml(v){
            if (this.$sets.length)
                throw new Error("Sets not yet supported");
            
            var _self = this;
            this.$props.forEach(function(prop){
               _self.data = {};
               _self.data[prop] = v.getAttribute(prop);
            });
        },
        get json(){
            return this.data;
        },
        set json(v){
            this.data = v;
        },
        toString : function(){
            return this.xml;
        }
    };

    module.exports = Data;
    
});