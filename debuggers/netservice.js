module.exports = function (vfs, register) { 
    var net    = require("net");
    var Stream = require("stream")
    var client, stream;
    
    register(null, {
        connect: function (port, callback) {
            if (stream) 
                return callback(null, { stream: stream });
            
            // Create the stream
            stream = new Stream();
            stream.readable = true;
            
            // Connect to the debugger
            client = net.connect({ port: port });
            client.setEncoding("utf8")
            
            client.on("data", function(data){
                stream.emit("data", data);
            });
            
            client.on("error", function(err){
                client.end();
                stream.emit("end");
                stream = null;
            });
            
            client.on("end", function(data){
                stream.emit("end");
                stream = null;
            });
            
            callback(null, { stream: stream });
        },
        
        write : function(data){
            client.write(data, "utf8");
        },
        
        close : function(){
            client.end();
            stream.emit("end");
            stream = null;
        }
    });
};