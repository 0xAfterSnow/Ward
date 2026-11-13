import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openFamilyWallets } from "./family-wallets.js";

test("wallet sessions and invitations survive a restart, and revocation persists", t => {
  const dir = mkdtempSync(join(tmpdir(), "ward-family-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "wallet.sqlite");
  const initial = openFamilyWallets(file);
  const owner = initial.create({
    childName: "Chinedu", parentName: "Mama", dailyCap: "100", perTxCeiling: "50", approvalThreshold: "20", places: [],
  });
  const other = initial.create({childName: "Other", parentName: "Parent", dailyCap: "100", perTxCeiling: "50", approvalThreshold: "20", places: []});
  initial.saveReviewMessage(owner.id, "chain", "6", {asked: "unsure", memo: "Private family context"});
  initial.saveReviewMessage(owner.id, "chain", "6", {asked: "yes", memo: "Retry must not replace"});
  assert.equal(initial.reviewMessage(other.id, "chain", "6"), undefined);
  assert.equal(initial.reviewMessage(owner.id, "mock", "6"), undefined);
  const invite = initial.invite(owner.id, false);
  initial.ward(owner.id).creditMockFunding({ id: "fund", amount: "75" });
  initial.close();

  const restarted = openFamilyWallets(file);
  assert.deepEqual({ ...restarted.session(owner.session) }, { family_id: owner.id, role: "family" });
  assert.deepEqual(restarted.previewInvite(invite), { childName: "Chinedu" });
  const elder = restarted.acceptInvite(invite);
  assert.equal(restarted.ward(elder.id).balance(), "75");
  assert.equal(restarted.connected(owner.id), true);
  restarted.unpair(owner.id);
  const pending = restarted.invite(owner.id, false);
  restarted.unpair(owner.id);
  restarted.close();

  const reopened = openFamilyWallets(file);
  t.after(() => reopened.close());
  assert.equal(reopened.connected(owner.id), false);
  assert.equal(reopened.session(elder.session), undefined);
  assert.throws(() => reopened.acceptInvite(invite), /already used/);
  assert.throws(() => reopened.acceptInvite(pending), /already used/);
  assert.equal(reopened.ward(owner.id).balance(), "75");
  assert.deepEqual({...reopened.reviewMessage(owner.id, "chain", "6")}, {asked: "unsure", message: "Private family context"});
});
