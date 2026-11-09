import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { previewFunding } from "../firewall/funding.js";
import { openMockWard } from "../firewall/mock-ward.js";

const near = 10n ** 24n;
const amount = whole => String(BigInt(whole) * near);

function formatNear(value) {
  const integer = BigInt(value);
  const fractional = String(integer % near).padStart(24, "0").replace(/0+$/, "");
  return fractional ? `${integer / near}.${fractional}` : String(integer / near);
}

async function main(command) {
  if (command === "quote") {
    const quote = await previewFunding({
      amount: process.env.WARD_QUOTE_USDC_ATOMIC ?? "1000000",
      recipient: process.env.WARD_QUOTE_RECIPIENT,
      refundTo: process.env.WARD_QUOTE_REFUND_TO,
      jwt: process.env.ONE_CLICK_JWT,
    });
    console.log(`DRY QUOTE | in=${quote.amountIn} USDC atomic units | out=${quote.amountOut} wNEAR atomic units`);
    return;
  }

  const filename = process.env.WARD_DEMO_DB ?? ".ward/demo.sqlite";
  mkdirSync(dirname(filename), { recursive: true });
  const ward = openMockWard(filename, {
    policy: {
      dailyCap: amount(5),
      perTxCeiling: amount(3),
      approvalThreshold: amount(1),
      payees: ["pharmacy.test"],
      timeWindows: [{ startMinute: 480, endMinute: 1200 }],
    },
    clock: () => Date.parse("2026-11-09T12:00:00Z"),
  });
  try {
    switch (command) {
      case "fund": {
        const balance = ward.creditMockFunding({ id: "family-funding", amount: amount(10) });
        console.log(`MOCK FUNDING | fixture=10 NEAR | balance=${formatNear(balance)} NEAR`);
        break;
      }
      case "pay-pharmacy": {
        const result = ward.requestPayment({ id: "pharmacy-payment", payee: "pharmacy.test", amount: amount(1) });
        console.log(`${result.decision} | ${result.ruleId} | ${result.reason} | balance=${formatNear(ward.balance())} NEAR`);
        break;
      }
      case "audit":
        for (const row of ward.audit()) {
          console.log(`${row.decision} | ${row.id} | ${row.ruleId} | ${row.reason}`);
        }
        break;
      default:
        throw new Error("Unknown demo command");
    }
  } finally {
    ward.close();
  }
}

try {
  await main(process.argv[2]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
