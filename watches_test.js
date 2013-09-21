/*global describe it before */

require(["lib/architect/architect", "lib/chai/chai", "/vfs-root"], 
  function (architect, chai, baseProc) {
    var expect = chai.expect;
    
    architect.resolveConfig([
        {
            packagePath : "plugins/c9.core/c9",
            startdate   : new Date(),
            debug       : true,
            hosted      : true,
            davPrefix   : "/",
            local       : false,
            projectName : "Test Project"
        },
        "plugins/c9.core/ext",
        "plugins/c9.core/http",
        "plugins/c9.core/util",
        "plugins/c9.core/settings",
        {
            packagePath : "plugins/c9.ide.ui/ui",
            staticPrefix : "plugins/c9.ide.ui"
        },
        "plugins/c9.ide.ui/lib_apf",
        {
            packagePath: "plugins/c9.fs/fs",
            baseProc: baseProc
        },
        {
            packagePath: "plugins/c9.vfs.client/vfs_client",
            smithIo     : {
                "path": "/smith.io/server"
            }
        },
        "plugins/c9.vfs.client/endpoint.standalone",
        "plugins/c9.ide.auth/auth",
        "plugins/c9.ide.run.debug/watches",
        
        //Mock Plugins
        {
            consumes : ["apf", "ui"],
            provides : ["commands", "panels", "tabManager", "layout", "watcher"],
            setup    : expect.html.mocked
        },
        {
            consumes : ["watches"],
            provides : [],
            setup    : main
        }
    ], function (err, config) {
        if (err) throw err;
        var app = architect.createApp(config);
        app.on("service", function(name, plugin){ plugin.name = name; });
    });
    
    function main(options, imports, register) {
        var watches = imports.watches;
        watches.show();
        var datagrid = watches.getElement("datagrid");
        
        function countEvents(count, expected, done){
            if (count == expected) 
                done();
            else
                throw new Error("Wrong Event Count: "
                    + count + " of " + expected);
        }
        
        expect.html.setConstructor(function(node){
            if (node.$ext) return node.$ext;

            return apf.xmldb.getHtmlNode(node, datagrid);
        })
        
        describe('breakpoints', function() {
            before(function(done){
                apf.config.setProperty("allow-select", false);
                apf.config.setProperty("allow-blur", false);
                
                bar.$ext.style.background = "rgba(220, 220, 220, 0.93)";
                bar.$ext.style.position = "fixed";
                bar.$ext.style.top = "75px";
                bar.$ext.style.right = "20px";
                bar.$ext.style.left = "";
                bar.$ext.style.bottom = "20px";
                bar.$ext.style.width = "300px";
                bar.$ext.style.height = "";
                
                done();
            });

            it('should add a frame', function(done) {
                breakpoints.addFrame({
                    
                });
                
                expect.html(datagrid, "Missing caption").text("/file.txt");
                expect.html(datagrid, "Missing content").text("This is the content");
                expect.html(datagrid.getFirstTraverseNode(), "Checked").className("checked");
                
                done();
            });
            
//            describe("unload()", function(){
//                it('should destroy all ui elements when it is unloaded', function(done) {
//                    breakpoints.unload();
//                    expect(datagrid.$amlDestroyed).to.equal(true);
//                    bar.destroy(true, true);
//                    bar = null;
//                    done();
//                });
//            });
        });
        
        onload && onload();
    }
});