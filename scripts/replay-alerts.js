'use strict';

/**
 * Posts every alert in sample-alerts.json to a running server, then prints the report.
 *   node scripts/replay-alerts.js [baseUrl]      (default http://localhost:3000, or BASE_URL env)
 */

const path = require('node:path');
const alerts = require(path.join(__dirname, '..', 'sample-alerts.json'));

const baseUrl = (process.argv[2] || process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

async function main() {
  let ok = 0;
  let failed = 0;
  for (const item of alerts) {
    try {
      const res = await fetch(`${baseUrl}/process-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert: item.message }),
      });
      if (res.ok) {
        ok += 1;
      } else {
        failed += 1;
        console.error(`FAILED ${item.id}: HTTP ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      console.error(`Cannot reach ${baseUrl}: ${err.message}`);
      process.exit(1);
    }
  }
  console.log(`Processed ${ok}/${alerts.length} alerts (${failed} failed).`);

  const report = await fetch(`${baseUrl}/report`);
  console.log(JSON.stringify(await report.json(), null, 2));
  process.exit(failed ? 1 : 0);
}

main();
