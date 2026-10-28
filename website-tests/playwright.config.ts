import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'.',testMatch:'*.spec.ts',timeout:240000,fullyParallel:false,workers:1,retries:0,
 reporter:[['list'],['html',{outputFolder:'playwright-report',open:'never'}]],
 use:{baseURL:'http://127.0.0.1:4327',viewport:{width:1600,height:1000},trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'bun website/serve.ts',env:{DRAFT_WEBSITE_PORT:'4327'},url:'http://127.0.0.1:4327',reuseExistingServer:false},
});
