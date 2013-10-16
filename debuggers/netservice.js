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
            stream.writable = true;
            
            // Connect to the debugger
            client = net.connect({port: port});
            
            client.on("data", function(data){
                stream.write(data);
            });
            
            client.on("error", function(err){
                client.end();
            });
            
            client.on("end", function(data){
                stream.end();
            });
            
            stream.on("data", function(data){
                client.write(data);
            });
            
            stream.on("end", function(data){
                stream = null;
            });
            
            callback(null, { stream: stream });
        }
    });
};