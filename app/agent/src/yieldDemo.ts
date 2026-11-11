import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runYieldAgent } from "./yield/agent.js";

const dir = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.YIELD_UI_PORT || 3333);

function loadLocalEnv(): void {
  const path = join(dir, "../../../.studio/.env.local");
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnv();

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const html = await readFileAsync(join(dir, "../public/yield.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/agent") {
    try {
      const raw = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const amountUsd = Number(raw.amountUsd ?? 1000);
      const riskProfile = String(raw.riskProfile ?? "low");
      const assets = Array.isArray(raw.assets) ? raw.assets.join(", ") : "USDC, USDT";
      const note = typeof raw.note === "string" ? raw.note.trim() : "";
      const min = raw.minLiquidityUsd === "" || raw.minLiquidityUsd == null
        ? ""
        : ` liquidité min ${String(raw.minLiquidityUsd)} USD.`;
      const wallet =
        typeof raw.walletAddress === "string" ? raw.walletAddress.trim() : "";
      const prompt = wallet
        ? `Profil ${riskProfile}. Assets ${assets}.${min}` +
          ` Wallet ${wallet}. Utilise les soldes on-chain, pas un montant fictif.` +
          (note ? ` ${note}` : "")
        : `Montant ${amountUsd} USD, assets ${assets}, profil ${riskProfile}.${min}` +
          (note ? ` ${note}` : "");
      const result = await runYieldAgent(prompt);
      json(res, 200, result);
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`yield ui → http://127.0.0.1:${port}`);
});
