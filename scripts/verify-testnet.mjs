import { readFile } from 'node:fs/promises';

const vault = 'vault.aftersnow.testnet';
const elder = 'elder.aftersnow.testnet';
// Public providers: https://docs.near.org/api/rpc/providers (2026-11-14).
const endpoints = [...new Set([
  process.env.WARD_TESTNET_RPC,
  'https://rpc.testnet.near.org',
  'https://test.rpc.fastnear.com',
  'https://archival-rpc.testnet.near.org',
].filter(Boolean))];
let failed = false;
function check(ok, message) {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${message}`);
  if (!ok) failed = true;
}
async function rpc(method, params) {
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(JSON.stringify(body.error));
      if (!body.result) throw new Error('Missing RPC result');
      console.log(`RPC | ${method} | ${endpoint}`);
      return body.result;
    } catch (error) {
      console.log(`RPC unavailable | ${endpoint} | ${error.message}${error.cause?.code ? ` (${error.cause.code})` : ''}`);
    }
  }
  throw new Error(`No RPC endpoint returned ${method}; UNVERIFIED`);
}

try {
  const { keys } = await rpc('query', {
    request_type: 'view_access_key_list', finality: 'final', account_id: elder,
  });
  if (!Array.isArray(keys)) throw new Error('Missing access-key list');
  for (const key of keys) console.log(`KEY | ${key.public_key} | ${JSON.stringify(key.access_key?.permission)}`);
  check(keys.length > 0 && keys.every(key => {
    const permission = key.access_key?.permission?.FunctionCall;
    return permission?.receiver_id === vault
      && JSON.stringify(permission.method_names) === '["request_payment"]';
  }), `${elder}: no full-access keys; all keys scoped to ${vault} / ["request_payment"]`);
} catch (error) { check(false, error.message); }

try {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const section = readme.split('## Verify on NEAR testnet\n')[1]?.split('\n## ')[0] ?? '';
  const rows = section.split('\n').filter(line => line.startsWith('|') && line.includes('/txns/'));
  const expected = new Map([
    ['Deploy and initialize', [vault, vault]],
    ['Rotate elder key', [elder, elder]],
    ['Request 1 test NEAR', [elder, vault, 'ALLOW', '1', 'policy_pass', 'SETTLED']],
    ['Request 2 test NEAR', [elder, vault, 'HOLD', '2', 'approval_threshold']],
    ['Approve as family', ['family.aftersnow.testnet', vault, 'ALLOW', '2', 'policy_pass', 'SETTLED']],
    ['Request payment to an unapproved recipient', [elder, vault, 'BLOCK', null, 'payee_allowlist']],
  ]);
  const labels = rows.map(row => row.split('|')[1].trim());
  if (rows.length !== 6 || new Set(labels).size !== 6 || labels.some(label => !expected.has(label))) {
    throw new Error('README proof table must contain the six expected steps');
  }
  for (const row of rows) {
    const label = row.split('|')[1].trim();
    const hash = row.match(/https:\/\/testnet\.nearblocks\.io\/txns\/([1-9A-HJ-NP-Za-km-z]+)/)?.[1];
    const [signer, receiver, decision, requestId, rule, settlement] = expected.get(label);
    try {
      if (!hash) throw new Error('Missing transaction hash');
      const result = await rpc('EXPERIMENTAL_tx_status', {
        tx_hash: hash, sender_account_id: signer, wait_until: 'FINAL',
      });
      const success = status => status && (Object.hasOwn(status, 'SuccessValue') || Object.hasOwn(status, 'SuccessReceiptId'));
      check(result.transaction?.hash === hash && result.transaction.signer_id === signer
        && result.transaction.receiver_id === receiver && result.final_execution_status === 'FINAL'
        && success(result.status) && success(result.transaction_outcome?.outcome?.status)
        && Array.isArray(result.receipts_outcome) && result.receipts_outcome.every(r => success(r.outcome?.status)),
      `${label} | ${hash} | FINAL and SUCCESS | expected ${signer} -> ${receiver}`);
      if (!decision) continue;
      const events = (result.receipts_outcome ?? []).filter(r => r.outcome.executor_id === vault)
        .flatMap(r => r.outcome.logs ?? []).flatMap(log => {
          try { return [JSON.parse(log)]; } catch { return []; }
        });
      const decisions = events.filter(e => e?.event === 'payment_decision');
      const settlements = events.filter(e => e?.event === 'payment_settlement' && e.requestId === requestId);
      if (!decisions.length || (settlement && !settlements.length)) {
        console.log(`SKIP | ${label}: required vault receipt logs unavailable; state UNVERIFIED`);
        continue;
      }
      check(decisions.some(e => e.result?.decision === decision && e.result?.ruleId === rule && e.requestId === requestId)
        && (!settlement || settlements.every(e => e.status === settlement)),
      `${label} | receipt logs: ${decision}${settlement ? `/${settlement}` : ''} | requestId=${requestId} | ${rule}`);
    } catch (error) {
      check(false, `${label} | ${hash} | ${error.message}`);
      if (decision) console.log(`SKIP | ${label}: receipt logs not read; state UNVERIFIED`);
    }
  }
} catch (error) { check(false, error.message); }
process.exitCode = failed ? 1 : 0;
