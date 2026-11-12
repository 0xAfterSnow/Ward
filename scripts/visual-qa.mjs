import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startWallet } from '../mama-wallet/server.js';
import { mkdir, writeFile } from 'node:fs/promises';
const {server, origin} = await startWallet({ port: 0, filename: ':memory:' });
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
const family = await browser.newContext({ viewport:{width:390,height:844} });
const elder = await browser.newContext({ viewport:{width:390,height:844} });
const fp=await family.newPage(), ep=await elder.newPage();
const report={screens:[],errors:[],flows:[],accessibility:[]};
for(const p of [fp,ep]) p.on('pageerror',e=>report.errors.push(e.message));
const round=process.env.QA_ROUND;
const sizes=round ? [[390,844]] : [[360,800],[390,844],[430,932],[1280,800]];
await mkdir('docs/screenshots/qa',{recursive:true});
async function snap(page,name){
 for(const [width,height] of sizes){
  await page.setViewportSize({width,height}); await page.waitForTimeout(420);
  const path=round ? `docs/screenshots/qa/${name}-round-${round}.png` : `docs/screenshots/${name}-${width}.png`;
  await page.screenshot({path});
  const overflow=await page.evaluate(()=>({body:document.body.scrollWidth>innerWidth,dialog:[...document.querySelectorAll('dialog[open]')].some(e=>e.scrollWidth>e.clientWidth+1)}));
  expect(overflow,`${name} ${width}: horizontal overflow`).toEqual({body:false,dialog:false});
 }
 await page.setViewportSize({width:390,height:844});
 const axe=await new AxeBuilder({page}).analyze();
 const violations=axe.violations.filter(x=>['critical','serious'].includes(x.impact));
 report.accessibility.push({screen:name,violations:violations.map(x=>({id:x.id,impact:x.impact,targets:x.nodes.map(n=>n.target)}))});
 report.screens.push(name); console.log(`Captured ${name}${violations.length ? ' AXE: '+JSON.stringify(report.accessibility.at(-1)) : ''}`);
}
const click=async(page,name)=>{const scope=await page.locator('dialog[open]').count()?page.locator('dialog[open]'):page;await scope.getByRole('button',{name,exact:true}).click();};
async function tabTo(page,locator){
 for(let n=0;n<120;n++){
  if(await locator.evaluate(e=>e===document.activeElement))return;
  await page.keyboard.press('Tab');
 }
 throw new Error('Keyboard could not reach '+await locator.textContent());
}
async function keyboardClick(page,name){const target=page.getByRole('button',{name,exact:true});await tabTo(page,target);await page.keyboard.press('Enter');}
async function pay(amount,answer='No',keyboard=false,capture=false){
 const action=keyboard ? keyboardClick : click;
 await action(ep,'Oak Street Pharmacy'); if(capture)await snap(ep,'pay-amount');
 const input=ep.getByLabel('Amount in dollars');
 if(keyboard){await tabTo(ep,input);await ep.keyboard.type(amount);}else await input.fill(amount);
 await action(ep,'Continue'); if(capture)await snap(ep,'pay-question');
 const radio=ep.getByRole('radio',{name:answer,exact:true});
 if(keyboard){await tabTo(ep,ep.getByRole('radio',{name:'Yes',exact:true}));await ep.keyboard.press('ArrowRight');await expect(radio).toBeChecked();}else await radio.check();
 if(answer!=='No')await ep.getByLabel('What did they say?').fill('Pay now. Your account will be frozen.');
 await action(ep,'Review payment');if(capture)await snap(ep,'pay-review');
 await action(ep,'Confirm payment');await ep.locator('.result-screen').waitFor();
}
try{
 await fp.goto(origin+'/family');await fp.getByRole('button',{name:'Create family wallet',exact:true}).waitFor();await snap(fp,'welcome');
 await click(fp,'Create family wallet');await snap(fp,'about-you');
 await fp.getByLabel('Your name',{exact:true}).fill('Chinedu');await fp.getByLabel('Parent’s name',{exact:true}).fill('Mama');await click(fp,'Continue');await snap(fp,'starting-rules');
 await fp.getByRole('radio',{name:/Custom/}).check();await click(fp,'Add approved place');await fp.getByLabel('Place name',{exact:true}).fill('Oak Street Pharmacy');await fp.getByLabel('Account ID',{exact:true}).fill('pharmacy.test');await snap(fp,'custom-rules');
 await click(fp,'Create family wallet');await fp.getByRole('heading',{name:'Your family wallet is ready'}).waitFor();await snap(fp,'wallet-created');report.flows.push('onboard');
 await click(fp,'Invite Mama');await snap(fp,'invite');await click(fp,'Generate pairing link');await snap(fp,'invite-waiting');
 const url=await fp.getByLabel('Elder pairing link').inputValue();await ep.goto(url);await snap(ep,'parent-landing');await click(ep,'Set up my wallet');await ep.getByRole('button',{name:'Pay',exact:true}).waitFor();
 await expect(fp.getByRole('status').filter({hasText:'Mama is connected'})).toBeVisible({timeout:10000});await snap(fp,'invite-connected');await click(fp,'Done');report.flows.push('pair');
 await snap(ep,'elder-empty');await snap(fp,'family-empty');
 await click(fp,'Add money');await snap(fp,'add-money');await fp.getByLabel('Amount in dollars').fill('50.25');await click(fp,'Preview quote');await snap(fp,'funding-review');await click(fp,'Confirm demo transfer');await snap(fp,'funding-success');await click(fp,'Done');report.flows.push('add money');
 await ep.reload();await ep.getByRole('button',{name:'Pay',exact:true}).waitFor();await snap(ep,'elder-home');await snap(fp,'family-home');
 await pay('1','No',true,true);await expect(ep.getByRole('heading',{name:'Sent',exact:true})).toBeVisible();await snap(ep,'pay-sent');await keyboardClick(ep,'Done');report.flows.push('keyboard-only Elder pay');
 await pay('1','Not sure');await snap(ep,'pay-waiting');await click(ep,'Done');await fp.reload();await fp.getByRole('button',{name:'Approve',exact:true}).waitFor();await snap(fp,'family-needs-you');await click(fp,'Approve');await expect(fp.getByRole('button',{name:'Approve',exact:true})).toHaveCount(0);report.flows.push('hold + approve');
 await pay('2');await click(ep,'Done');await fp.reload();await fp.getByRole('button',{name:'Reject',exact:true}).waitFor();await click(fp,'Reject');await expect(fp.getByRole('button',{name:'Reject',exact:true})).toHaveCount(0);report.flows.push('reject');
 await click(ep,'Pay someone new');await snap(ep,'new-payee');await ep.getByLabel('Name (optional)',{exact:true}).fill('Aso Tailor');await ep.getByLabel('Recipient account ID',{exact:true}).fill('tailor.test');await click(ep,'Continue to payment');await ep.getByLabel('Amount in dollars').fill('1');await click(ep,'Continue');await ep.getByRole('radio',{name:'No',exact:true}).check();await click(ep,'Review payment');await click(ep,'Confirm payment');await expect(ep.getByRole('heading',{name:'Sent',exact:true})).toBeVisible();await click(ep,'Done');report.flows.push('new payee payment');
 await click(ep,'Pay someone new');await click(ep,'Ask family to save a place');await snap(ep,'save-place');await ep.getByLabel('Name of the place or person').fill('Aso Tailor');await ep.getByLabel('Account ID',{exact:true}).fill('tailor.test');await click(ep,'Send to family');await snap(ep,'request-success');await click(ep,'Done');await fp.reload();await click(fp,'Approve');report.flows.push('save place + approve');
 await click(ep,'Help');await snap(ep,'help');await click(ep,'I got a strange call');await snap(ep,'ask-family');await click(ep,'Send to family');await click(ep,'Done');await fp.reload();await click(fp,'Mark as read');report.flows.push('ask family');
 await click(fp,'Protection');await snap(fp,'protection');await click(fp,'Edit protection rules');await snap(fp,'edit-rules');await click(fp,'Save rules');await click(fp,'Done');
 await click(fp,'Freeze wallet');await snap(fp,'freeze-confirm');await click(fp,'Freeze wallet');await snap(fp,'freeze-success');await click(fp,'Done');await click(ep,'Home');await ep.reload();await pay('1');await expect(ep.getByRole('heading',{name:'Stopped to keep you safe',exact:true})).toBeVisible();await snap(ep,'pay-stopped');await click(ep,'Done');await click(fp,'Unfreeze wallet');await click(fp,'Unfreeze wallet');await click(fp,'Done');report.flows.push('freeze + stopped + unfreeze');
 await click(fp,'Activity');await snap(fp,'family-activity');await click(fp,'Held');await snap(fp,'activity-held');await click(fp,'Stopped');await snap(fp,'activity-stopped');
 await click(ep,'Activity');await snap(ep,'elder-activity');await click(ep,'Bigger text');await snap(ep,'elder-bigger-text');await click(ep,'Bigger text');
 await click(fp,'Mama');await snap(fp,'mama');await click(fp,'Create sign-in code');await snap(fp,'sign-in-code-confirm');await click(fp,'Generate code');const signInCode=await fp.getByLabel('Family sign-in code',{exact:true}).inputValue();await snap(fp,'sign-in-code');await click(fp,'Done');
 await click(fp,'Replace device');await snap(fp,'replace-device');await click(fp,'Disconnect and create link');const replacement=await fp.getByLabel('Elder pairing link').inputValue();await click(fp,'Done');const third=await browser.newContext();const tp=await third.newPage();await tp.goto(replacement);await click(tp,'Set up my wallet');await fp.reload();await click(fp,'Unpair device');await snap(fp,'unpair-device');await click(fp,'Disconnect device');await click(fp,'Done');report.flows.push('replace + unpair device');
 await click(fp,'Sign out');await click(fp,'Sign out');await snap(fp,'sign-in');await fp.getByLabel('Family sign-in code').fill(signInCode);await click(fp,'Sign in');report.flows.push('family sign-in');
 // Read-only network faults exercise error, offline and loading UI without changing API semantics.
 await family.setOffline(true);await snap(fp,'offline');await family.setOffline(false);
 await fp.route('**/api/funding-quote',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'The connection is unavailable. Try again.'})}));
 await click(fp,'Home');await click(fp,'Add money');await fp.getByLabel('Amount in dollars').fill('10');await click(fp,'Preview quote');await fp.getByRole('alert').waitFor();await snap(fp,'funding-error');await click(fp,'Cancel');await fp.unroute('**/api/funding-quote');
 const loadingContext=await browser.newContext({serviceWorkers:'block'});const lp=await loadingContext.newPage();await lp.route('**/api/mode',async route=>{await new Promise(r=>setTimeout(r,15000));await route.continue().catch(()=>{});});await lp.goto(origin+'/family',{waitUntil:'domcontentloaded'});await snap(lp,'loading');await loadingContext.close();
 const fails=report.accessibility.filter(x=>x.violations.length);expect(report.errors).toEqual([]);expect(fails,'serious/critical axe issues').toEqual([]);
 console.log('Full UI flow passed.');
}finally{
 await writeFile('docs/screenshots/qa/report.json',JSON.stringify(report,null,2)+'\n');
 await browser.close();await new Promise(r=>server.close(r));
}
