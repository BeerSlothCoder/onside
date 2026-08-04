// Repeatable functional check for @onside/var-events — not a unit test
// framework (none is set up in this repo), just a runnable script that
// exercises both event sources end to end and asserts on the result.
// Run: npm run smoke -w packages/var-events
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  AdminVarEventSource,
  DemoLedger,
  ReplayVarEventSource,
  VarEvent,
  VarMarketSession,
  VAR_OUTCOME_OPTIONS,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const sampleEvents = JSON.parse(
  readFileSync(resolve(HERE, "../sample-events/france-england-var-events.json"), "utf8")
) as VarEvent[];

async function testReplay(): Promise<boolean> {
  console.log("\n--- REPLAY path (packages/var-events/sample-events) ---");
  const ledger = new DemoLedger();
  const speed = 300;
  const source = new ReplayVarEventSource(sampleEvents, { speedMultiplier: speed });
  const session = new VarMarketSession(source, ledger);

  const results: string[] = [];
  let remaining = sampleEvents.length;

  await new Promise<void>((resolveAll) => {
    session.onChange((markets) => {
      for (const m of markets) {
        const snap = m.snapshot();
        if (snap.state === "OPEN" && snap.predictions.length === 0) {
          m.predict("alice", snap.trigger.outcomeOptions[0], 25);
        }
      }
    });
    const check = setInterval(() => {
      for (const m of session.markets()) {
        const snap = m.snapshot();
        if (snap.state === "RESOLVED" && !results.some((r) => r.includes(snap.trigger.timestamp))) {
          const picked = snap.trigger.outcomeOptions[0];
          results.push(`${snap.trigger.timestamp} ${snap.trigger.varType}: picked=${picked} official=${snap.resolvedOutcome} won=${snap.resolvedOutcome === picked}`);
          remaining--;
        }
      }
      if (remaining <= 0) {
        clearInterval(check);
        resolveAll();
      }
    }, 50);
  });

  console.log(results.join("\n"));
  const exported = session.toVarEvents();
  const ok = exported.length === sampleEvents.length;
  console.log(`${ok ? "PASS" : "FAIL"} exported ${exported.length}/${sampleEvents.length} resolved markets as VarEvent[]`);
  session.dispose();
  return ok;
}

async function testAdmin(): Promise<boolean> {
  console.log("\n--- ADMIN path (manual trigger + resolve, exact timestamps) ---");
  const ledger = new DemoLedger();
  const source = new AdminVarEventSource();
  const session = new VarMarketSession(source, ledger);

  let sawOpenBeforeResolve = false;
  session.onChange((markets) => {
    for (const m of markets) {
      if (m.snapshot().state === "OPEN" && m.snapshot().resolvedOutcome === undefined) sawOpenBeforeResolve = true;
    }
  });

  const trigger = source.triggerVar({
    matchId: "Czech Fortuna Liga: Slavia vs Sparta",
    timestamp: "71:32",
    varType: "PENALTY_REVIEW",
    context: "Handball check in the box",
    outcomeOptions: VAR_OUTCOME_OPTIONS.PENALTY_REVIEW,
  });

  const market = session.markets().find((m) => m.trigger.id === trigger.id)!;
  const openedBeforeResolve = market.snapshot().state === "OPEN";
  const predicted = market.predict("bob", "PENALTY_AWARDED", 40);

  source.resolveVar(trigger.id, "PENALTY_AWARDED", "73:05");

  const final = session.markets().find((m) => m.trigger.id === trigger.id)!.snapshot();
  const checks: [string, boolean][] = [
    ["market opened on trigger, outcome unknown at trigger time", sawOpenBeforeResolve],
    ["market was OPEN before resolve() was called", openedBeforeResolve],
    ["prediction accepted while open", predicted],
    ["resolved outcome matches reported decision", final.resolvedOutcome === "PENALTY_AWARDED"],
    ["resolved timestamp is the announce time, distinct from the trigger time", final.resolvedTimestamp === "73:05" && final.trigger.timestamp === "71:32"],
    ["winning stake paid out (1000 - 40 + 40*1.9 = 1036)", ledger.balanceOf("bob") === 1000 - 40 + 40 * 1.9],
  ];

  for (const [desc, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${desc}`);
  session.dispose();
  return checks.every(([, ok]) => ok);
}

async function main() {
  const replayOk = await testReplay();
  const adminOk = await testAdmin();
  if (!replayOk || !adminOk) {
    console.error("\nSMOKE TEST FAILED");
    process.exit(1);
  }
  console.log("\nSMOKE TEST OK");
}

main();
