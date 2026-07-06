/**
 * Onside crank — permissionless market lifecycle driver.
 *
 * Responsibilities (built up across the hackathon):
 *  1. Publish fixtures/markets from the TxLINE schedule (create_market).
 *  2. Watch the scores SSE stream; lock markets at kickoff / phase change.
 *  3. At full time, fetch /api/scores/stat-validation proofs and call settle().
 *  4. Serve a thin read proxy for the extension (markets + scores),
 *     keeping the TxLINE apiToken server-side per the data licence.
 *
 * Anyone can run this — settlement correctness is enforced on-chain,
 * not by whoever operates the crank.
 */
import "dotenv/config";
import { credentialsFromEnv, TxlineDataClient } from "@onside/txline-client";

async function main() {
  const creds = credentialsFromEnv(process.env);
  if (!creds) {
    console.error(
      "No TxLINE credentials in .env — run `npm run activate -w crank` first (subscribe + activate)."
    );
    process.exit(1);
  }

  const txline = new TxlineDataClient(creds);
  console.log("Onside crank starting — streaming scores from TxLINE…");

  const abort = new AbortController();
  process.on("SIGINT", () => abort.abort());

  await txline.streamScores((event, data) => {
    // TODO(step: lifecycle): map phase changes → lock_market, FT → settle(proof)
    console.log(`[scores] ${event ?? "message"}`, JSON.stringify(data).slice(0, 200));
  }, abort.signal);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
