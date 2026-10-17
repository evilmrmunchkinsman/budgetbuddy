// BudgetBuddy test runner (Group 4)
// Usage: node test-runner.js            (uses http://localhost:3000)
//        API_URL=http://localhost:4000 node test-runner.js
// Needs Node 18+ (built-in fetch). No npm install required.

const fs = require("fs");
const BASE = process.env.API_URL || "http://localhost:3000";

// Use Group 3's dataset if it exists, else a small built-in set
const FALLBACK = [
  "Rs.450.00 debited from A/c XX1234 at ZOMATO on 12-Aug-25. Avl bal Rs.12,300.",
  "You paid Rs.899 to UBER via UPI on 13-Aug-25.",
  "Rs.2,400 spent at RELIANCE TRENDS using Card XX5678 on 14-Aug-25.",
  "Rs.450.00 debited from A/c XX1234 at ZOMATO on 12-Aug-25. Avl bal Rs.11,850.", // duplicate
  "Rs.48,000 spent at CROMA ELECTRONICS using Card XX5678 on 15-Aug-25.",         // unusually large
];

function loadAlerts() {
  try {
    const data = JSON.parse(fs.readFileSync("./data/sample-alerts.json", "utf8"));
    return data.map((a) => (typeof a === "string" ? a : a.text));
  } catch {
    console.log("(no data/sample-alerts.json found, using built-in alerts)\n");
    return FALLBACK;
  }
}

async function main() {
  const alerts = loadAlerts();
  let pass = 0, fail = 0, flagged = 0, alertsSent = 0;

  console.log(`Testing ${alerts.length} alerts against ${BASE}\n`);

  for (const [i, text] of alerts.entries()) {
    try {
      const res = await fetch(`${BASE}/process-alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const out = await res.json();
      const t = out.transaction || {};

      // A test passes if the server answered OK and returned the agreed fields
      const ok = res.ok && t.merchant && typeof t.amount === "number" && t.category;
      ok ? pass++ : fail++;
      if (t.flagged) flagged++;
      if (out.alertSent) alertsSent++;

      console.log(
        `${ok ? "PASS" : "FAIL"} #${i + 1} | ${String(t.merchant).padEnd(16)} | Rs.${String(t.amount).padEnd(7)} | ${String(t.category).padEnd(10)} | flagged: ${!!t.flagged} | alert: ${!!out.alertSent}`
      );
    } catch (err) {
      fail++;
      console.log(`FAIL #${i + 1} | could not reach server: ${err.message}`);
    }
  }

  console.log(`\nResult: ${pass} passed, ${fail} failed | ${flagged} flagged | ${alertsSent} alerts sent`);

  try {
    const report = await (await fetch(`${BASE}/report`)).json();
    console.log("\n--- GET /report ---");
    console.log(JSON.stringify(report, null, 2));
  } catch {
    console.log("\n(GET /report not available yet)");
  }
}

main();