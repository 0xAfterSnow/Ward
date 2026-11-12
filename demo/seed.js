import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openFamilyWallets } from '../firewall/family-wallets.js';
import { createWalletApi } from '../firewall/wallet-api.js';
import { dollarsToAtomic } from '../mama-wallet/server.js';
import { formatNear } from './fixture.js';

// Deliberately no chain adapter, network calls, environment credentials or signing.
export async function seedDemo(filename = '.ward/demo-seed.sqlite') {
  if (filename !== ':memory:') mkdirSync(dirname(filename), {recursive:true});
  const wallets = openFamilyWallets(filename);
  const origin = 'http://127.0.0.1:4173';
  const api = createWalletApi({wallets, origin, toAtomic:dollarsToAtomic, format:formatNear});
  async function request(path, data, cookie) {
    const req=Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    req.method=data === undefined ? 'GET':'POST';
    req.headers={cookie,origin,'content-type':'application/json'};
    const response={};
    await api(req,{writeHead(status,headers){Object.assign(response,{status,headers});},end(body){response.body=JSON.parse(body);}},'/api/'+path);
    if(response.status>=400)throw new Error(`${path}: ${response.body.error}`);
    return response;
  }
  const cookieOf=r=>r.headers['Set-Cookie'].split(';')[0];
  try {
    const family=cookieOf(await request('onboarding',{childName:'Chinedu',parentName:'Mama',dailyCap:'50',perTxCeiling:'15',approvalThreshold:'5',places:[{id:'pharmacy.test',label:'Oak Street Pharmacy'},{id:'groceries.test',label:'Groceries'},{id:'tailor.test',label:'Aso Tailor'}]}));
    const quote=(await request('funding-quote',{source:'base',dollars:'125'},family)).body;
    await request('funding-confirm',{id:quote.id},family);
    const invite=(await request('invites',{},family)).body;
    const code=new URLSearchParams(new URL(invite.link).hash.slice(1)).get('pair');
    const elder=cookieOf(await request('pair',{code}));
    for(const [payee,dollars,asked,memo] of [['pharmacy.test','3','no',''],['groceries.test','4.50','no',''],['tailor.test','2','no',''],['safe-account.test','25','yes','A caller claiming to be my bank said to move money to a safe account.'],['pharmacy.test','7','no','']]) {
      await request('payments',{id:randomUUID(),payee,dollars,asked,memo},elder);
    }
    await request('unpair',{},family);
    const signIn=(await request('family-sign-in-code',{},family)).body;
    const wallet=(await request('wallet',undefined,family)).body;
    return {code:signIn.code,wallet};
  } finally {wallets.close();}
}
if(process.argv[1] === fileURLToPath(import.meta.url)) {
  if(process.argv.length>2)throw new Error('demo:seed is mock-only and accepts no testnet mode or arguments.');
  const {code,wallet}=await seedDemo();
  console.log(`Mock demo created: ${wallet.name}, $${wallet.balance}, ${wallet.pending.length} held payment, ${wallet.blockedAlerts.length} stopped payment.\nStart: WARD_WALLET_DB=.ward/demo-seed.sqlite npm run dev\nOpen http://127.0.0.1:4173/family and choose Sign in to an existing family.\nFamily sign-in code: ${code}\nUse Mama → Create pairing link to connect a separate browser. Demo only; no real money moves.`);
}
