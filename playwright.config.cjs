const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:'./test/browser',fullyParallel:false,workers:1,retries:0,timeout:45000,
 reporter:[['list'],['json',{outputFile:'reports/browser.json'}]],outputDir:'data/browser-artifacts',
 use:{baseURL:'http://127.0.0.1:4320',viewport:{width:1440,height:1000},trace:'off',screenshot:'only-on-failure'},
 webServer:{command:'node scripts/browser-server.cjs',url:'http://127.0.0.1:4320/api/system/ready',reuseExistingServer:false,timeout:60000,gracefulShutdown:{signal:'SIGTERM',timeout:5000}}
});
