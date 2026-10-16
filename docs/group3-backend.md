# Group 3 – Backend API + Data + Report

Owner: Group 3. Files: `server.js`, `report.js`, `sample-alerts.json`, `config.js`, `errors.js`,
`integration.js`, `mocks/`, `scripts/`, `test/`, `package.json`, `.env.example`, `.gitignore`.

## Run locally
```bash
npm install
cp .env.example .env          # edit if needed; never commit .env
npm run start:mock            # temporary mocks (works before Groups 1/2 finish)
npm run replay                # in a 2nd terminal: sends all sample alerts, prints report
npm test
```
When `agent.js` and `db.js` exist in the repo root: `npm start` (no mocks).
Until then `npm start` still boots; endpoints respond `503 MODULE_UNAVAILABLE`.

## API
| Route | Description |
|---|---|
| `POST /process-alert` | Body `{"alert": "<raw alert text>"}` (1..`MAX_ALERT_LENGTH` chars). Calls Group 1. 200 `{success, result}` |
| `GET /report` | Reads all transactions from Group 2 and returns category totals + flagged transactions |
| `GET /health` | `{status, mode}` |

Errors always look like `{"success":false,"error":{"code","message","details?"}}`.
Codes: `INVALID_REQUEST`, `INVALID_JSON` (400), `PAYLOAD_TOO_LARGE` (413), `NOT_FOUND` (404),
`MODULE_UNAVAILABLE` (503), `AGENT_ERROR` / `DB_ERROR` / `CONTRACT_MISMATCH` / `MODULE_LOAD_FAILED` / `INTERNAL_ERROR` (500).

## Contracts assumed from other groups (only `integration.js` depends on them)
**Group 1 – `agent.js`**: `processAlert(alertText: string): Promise<object>`
runs the Claude tool-use loop for one alert, persists via Group 2's tools, resolves with a JSON-serialisable summary, throws on failure.

**Group 2 – `db.js`**: `getAllTransactions(): Transaction[] | Promise<Transaction[]>`
```
Transaction = { id, amount (positive number), type?: 'debit'|'credit' (default 'debit'),
                merchant, category (null -> "Uncategorized"), date (ISO-8601) }
```
CommonJS or ESM exports both work. If your signatures differ, tell Group 3 or edit `integration.js`.

## Report rules (`report.js`)
- Only debits count as spending; credits are totalled separately.
- `large_spend`: amount >= `LARGE_SPEND_THRESHOLD` (default 10000).
- `duplicate`: same merchant + amount within `DUPLICATE_WINDOW_MINUTES` (default 10); the later one is flagged, with `duplicateOf`.
- Malformed rows are listed under `skipped` rather than failing the report.

## Mocks
`mocks/` is only used with `--mock` or `USE_MOCKS=true` and is refused when `NODE_ENV=production`.
Delete the folder once Groups 1 and 2 are integrated.
