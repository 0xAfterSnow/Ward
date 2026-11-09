import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { amount, demoClock, demoPolicy, formatNear, labels } from "../demo/fixture.js";
import { openMockWard } from "../firewall/mock-ward.js";
import { createWalletApi } from "../firewall/wallet-api.js";

const assets = new Map(Object.entries({
  "/": ["index.html", "text/html; charset=utf-8"],
  "/elder": ["index.html", "text/html; charset=utf-8"],
  "/family": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
  "/sw.js": ["sw.js", "text/javascript; charset=utf-8"],
  "/icon-192.png": ["icon-192.png", "image/png"],
  "/icon-512.png": ["icon-512.png", "image/png"],
}));

export function startWallet({ port = 4173, filename = ".ward/wallet.sqlite" } = {}) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const ward = openMockWard(filename, { policy: demoPolicy, clock: demoClock });
  const familyCode = randomBytes(32).toString("base64url");
  let api;
  let origin;
  const server = createServer((req, res) => {
    if (req.headers.host !== new URL(origin).host) {
      res.writeHead(421).end();
      return;
    }
    const pathname = req.url.split("?")[0];
    res.setHeader("Content-Security-Policy", "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
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
  server.on("close", () => ward.close());
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      api = createWalletApi({
        ward, origin, familyCode, format: formatNear, fundingAmount: amount(10),
        toAtomic: credits => typeof credits === "string" && /^\d{1,8}$/.test(credits) ? amount(credits) : null,
        payees: demoPolicy.payees.map(id => ({ id, label: labels[id] })),
      });
      resolve({ server, origin, familyLink: `${origin}/family#family=${familyCode}` });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { origin, familyLink } = await startWallet({
    port: Number(process.env.PORT ?? 4173),
    filename: process.env.WARD_WALLET_DB,
  });
  console.log(`Mama Wallet local demo: ${origin}`);
  console.log(`Private family setup link: ${familyLink}`);
}
