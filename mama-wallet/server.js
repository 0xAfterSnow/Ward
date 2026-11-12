import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { formatNear } from "../demo/fixture.js";
import { previewFunding } from "../firewall/funding.js";
import { openFamilyWallets } from "../firewall/family-wallets.js";
import { createWalletApi } from "../firewall/wallet-api.js";
import { formatUsdc, usdcToAtomic } from "../firewall/testnet-usdc.js";
import { createNearAiScreener } from "../firewall/screening.js";

const assets = new Map(Object.entries({
  "/illustrations/family-connect.webp": ["illustrations/family-connect.webp", "image/webp"],
  "/illustrations/family-help.webp": ["illustrations/family-help.webp", "image/webp"],
  "/illustrations/wallet-care.webp": ["illustrations/wallet-care.webp", "image/webp"],
  "/illustrations/family-ready.webp": ["illustrations/family-ready.webp", "image/webp"],
  "/brand/mama-wallet-logo.webp": ["brand/mama-wallet-logo.webp", "image/webp"],
  "/favicon.ico": ["favicon.ico", "image/x-icon"],
  "/favicon-32.png": ["favicon-32.png", "image/png"],
  "/apple-touch-icon.png": ["apple-touch-icon.png", "image/png"],

  "/illustrations/family-ready.png": ["illustrations/family-ready.png", "image/png"],
  "/": ["index.html", "text/html; charset=utf-8"],
  "/elder": ["index.html", "text/html; charset=utf-8"],
  "/family": ["index.html", "text/html; charset=utf-8"],
  "/testnet.js": ["testnet.js", "text/javascript; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/views.js": ["views.js", "text/javascript; charset=utf-8"],
  "/components.js": ["components.js", "text/javascript; charset=utf-8"],
  "/router.js": ["router.js", "text/javascript; charset=utf-8"],
  "/api.js": ["api.js", "text/javascript; charset=utf-8"],
  "/fonts/manrope-variable.woff2": ["fonts/manrope-variable.woff2", "font/woff2"],
  "/fonts/OFL.txt": ["fonts/OFL.txt", "text/plain"],
  "/icons-LICENSE.txt": ["icons-LICENSE.txt", "text/plain"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
  "/sw.js": ["sw.js", "text/javascript; charset=utf-8"],
  "/icon-192.png": ["icon-192.png", "image/png"],
  "/icon-512.png": ["icon-512.png", "image/png"],
}));

export function dollarsToAtomic(value) {
  if (typeof value !== "string" || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) return null;
  const [dollars, cents = ""] = value.split(".");
  return String(BigInt(dollars) * 10n ** 24n + BigInt(cents.padEnd(2, "0")) * 10n ** 22n);
}

export function startWallet({
  port = 4173, host = "127.0.0.1", publicOrigin, filename = ".ward/families.sqlite", cloudScreen, quoteFunding, chain, clock,
} = {}) {
  if (chain && (host !== "127.0.0.1" || publicOrigin)) throw new Error("Testnet sponsorship currently requires loopback");
  const publicUrl = publicOrigin && new URL(publicOrigin);
  if (publicUrl && (publicUrl.protocol !== "https:" || publicUrl.origin !== publicOrigin)) {
    throw new Error("WARD_WALLET_ORIGIN must be an HTTPS origin without a path or trailing slash");
  }
  if (host !== "127.0.0.1" && !publicUrl) throw new Error("A non-loopback bind requires WARD_WALLET_ORIGIN");
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const wallets = openFamilyWallets(filename, { clock, cloudScreen });
  let api;
  let origin;
  const server = createServer((req, res) => {
    if (req.headers.host !== new URL(origin).host) {
      res.writeHead(421).end();
      return;
    }
    const pathname = req.url.split("?")[0];
    const connect = chain ? " connect-src 'self' https://test.rpc.fastnear.com;" : "";
    res.setHeader("Content-Security-Policy", `default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self';${connect}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (pathname.startsWith("/api/")) {
      void api(req, res, pathname);
      return;
    }
    const asset = req.method === "GET" && assets.get(pathname);
    if (!asset) {
      res.writeHead(404).end("Page unavailable");
      return;
    }
    const [name, type] = asset;
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(readFileSync(new URL(`./public/${name}`, import.meta.url)));
  });
  server.on("close", () => wallets.close());
  return new Promise((resolve, reject) => {
    const onError = error => {
      wallets.close();
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      origin = publicUrl?.origin ?? `http://127.0.0.1:${server.address().port}`;
      api = createWalletApi({
        wallets, origin, format: chain?.asset === "usdc" ? formatUsdc : formatNear,
        toAtomic: chain?.asset === "usdc" ? usdcToAtomic : dollarsToAtomic, quoteFunding, chain, clock,
      });
      resolve({ server, origin });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const usdc = process.argv.includes("--testnet");
  const testnet = usdc || process.argv.includes("--testnet-native");
  let chain;
  if (testnet) {
    try { loadEnvFile(); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const { openBrowserTestnet } = await import("../firewall/vault/sandbox/browser-testnet.js");
    chain = await openBrowserTestnet({
      parent: process.env.WARD_TESTNET_PARENT, keyPath: process.env.WARD_TESTNET_SPONSOR_KEY, asset: usdc ? "usdc" : "near",
    });
  }
  const cloudScreen = process.env.WARD_SCREENING === "near-ai"
    ? createNearAiScreener(process.env.NEAR_AI_API_KEY)
    : undefined;
  const { WARD_QUOTE_RECIPIENT: recipient, WARD_QUOTE_REFUND_TO: refundTo, ONE_CLICK_JWT: jwt } = process.env;
  const quoteFunding = recipient && refundTo ? async ({ source, amount }) => {
    const quote = await previewFunding({ source, amount: String(BigInt(amount) / 10n ** 18n), recipient, refundTo, jwt });
    return { output: formatNear(quote.amountOut) };
  } : undefined;
  const { origin } = await startWallet({
    port: Number(process.env.PORT ?? 4173),
    filename: usdc ? process.env.WARD_TESTNET_USDC_DB ?? ".ward/testnet-usdc-families.sqlite"
      : testnet ? process.env.WARD_TESTNET_WALLET_DB ?? ".ward/testnet-families.sqlite" : process.env.WARD_WALLET_DB,
    host: process.env.WARD_WALLET_HOST,
    publicOrigin: process.env.WARD_WALLET_ORIGIN,
    cloudScreen, quoteFunding, chain,
  });
  if (testnet) console.log(`Mama Wallet on NEAR testnet (${usdc ? "USDC" : "native NEAR"}): ${origin}/family`);
  else {
    console.log(`Mama Wallet local demo: ${origin}`);
    console.log(`Create a demo family wallet: ${origin}/family`);
  }
}
