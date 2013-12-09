var net  = require('net');
var port = parseInt("{PORT}", 10);

var buffer = [];
var browserClient, debugClient;

var server = net.createServer(function(client) {
    if (browserClient)
        browserClient.destroy(); // Client is probably unloaded because a new client is connecting
    
    browserClient = client;
    
    browserClient.on('end', function() {
        browserClient = null;
    });
    
    browserClient.on("data", function(data){
        debugClient.write(data);
    });
    
    if (buffer.length) {
        buffer.forEach(function(data){
            browserClient.write(data);
        });
        buffer = [];
    }
});

// Start listening for browser clients
server.listen(port + 1, function(){
    console.log("1");
});

// Handle errors
server.on("error", function(){ process.exit(0); });

// Connect to the debugger
debugClient = net.connect(port);

var gotData;
debugClient.on("data", function(data){
    if (browserClient)
        browserClient.write(data);
    else
        buffer.push(data);
    
    gotData = true;
});

function errHandler(e){
    if (!gotData) {
        console.error("-1");
    }
    process.exit(0);
}

debugClient.on("error", errHandler);

debugClient.on("end", function(data){
    server.close();
});