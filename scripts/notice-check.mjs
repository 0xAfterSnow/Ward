import { chromium, expect } from '@playwright/test';
import { startWallet } from '../mama-wallet/server.js';
const {server,origin}=await startWallet({port:0,filename:':memory:'});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/opt/google/chrome/chrome',args:['--no-sandbox']});
try {
 const page=await browser.newPage();await page.goto(origin+'/family');
 const code=await page.evaluate(async()=>{
  const post=async(path,data)=>fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());
  await post('onboarding',{childName:'Chinedu',parentName:'Mama',dailyCap:'10',perTxCeiling:'3',approvalThreshold:'1',places:[]});
  const {code}=await post('family-sign-in-code',{});await post('family-sign-out',{});return code;
 });
 await page.reload();await page.getByRole('button',{name:'Sign in to an existing family',exact:true}).click();
 await page.clock.install();
 await page.getByLabel('Family sign-in code').fill('invalid-code');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.locator('#notice')).toBeVisible();await page.clock.runFor(15000);await expect(page.locator('#notice')).toBeVisible();
 await page.getByRole('button',{name:'Dismiss message'}).click();await expect(page.locator('#notice')).toBeHidden();
 await page.getByLabel('Family sign-in code').fill(code);await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.locator('#notice')).toContainText('Signed in to Family.');
 await page.clock.runFor(3000);await expect(page.locator('#notice')).toBeVisible();
 await page.clock.runFor(4000);await expect(page.locator('#notice')).toBeHidden();
 console.log('PASS: errors stay dismissible; sign-in confirmation expires after six seconds.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
