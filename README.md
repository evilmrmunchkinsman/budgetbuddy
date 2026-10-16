# BudgetBuddy — Group 2: Tools + Database

This folder is a standalone Node.js module for the BudgetBuddy project. It contains only the database layer and six deterministic tools. It does not implement the agent, API server, frontend, reporting module, or actual SMS/email delivery.

## Requirements and setup

- Node.js 18 or newer
- npm

From this folder, install the dependency and initialize the database:

```bash
npm install
npm run init-db
```

The default database file is `budgetbuddy.sqlite` beside these files. To put it elsewhere, set `BUDGETBUDDY_DB_PATH` before running Node:

```bash
BUDGETBUDDY_DB_PATH=/path/to/budgetbuddy.sqlite node your-entry-point.js
```

Initialization uses `CREATE TABLE IF NOT EXISTS`; it creates missing schema objects and does not delete or reset existing records. The database is initialized lazily the first time a database-backed function runs, so calling `initDatabase()` explicitly is optional except when you want to initialize it during application startup.

## Exports

Import the six required tools from `tools.js`:

```js
const {
  extractTransaction,
  categorizeExpense,
  checkBudget,
  flagAnomaly,
  saveTransaction,
  sendAlert,
} = require('./tools');
```

All tools return objects with an `ok` boolean. Invalid input or a database failure returns:

```js
{ ok: false, error: { code: 'INVALID_INPUT', message: '...' } }
```

### `extractTransaction(text)`

Parses common English-language bank and UPI alerts without a paid model/API.

- Argument: non-empty alert text (`string`)
- Success: `{ ok: true, transaction, missingFields }`
- `transaction`: `{ merchant, amount, category, transactionDate, paymentMode, rawAlertText }`
- `merchant` and `transactionDate` can be `null` if the alert does not contain them. `missingFields` lists those fields. A successful parse requires an amount.
- Dates in `DD/MM/YYYY` or `DD-MM-YYYY` are interpreted as day/month/year; ISO `YYYY-MM-DD` is also accepted.
- Example:

```js
const parsed = extractTransaction(
  'Rs. 450.00 debited to SWIGGY on 16/10/2026 via UPI'
);
if (parsed.ok) {
  console.log(parsed.transaction);
  // merchant: "SWIGGY", amount: 450, category: "Food",
  // transactionDate: "2026-10-16", paymentMode: "UPI", ...
}
```

### `categorizeExpense(merchant)`

Maps recognizable merchant text to `Food`, `Travel`, `Shopping`, `Bills`, `Healthcare`, or `Other`.

- Argument: non-empty merchant name (`string`)
- Success: `{ ok: true, category }`
- Categorization is keyword-based; unrecognized merchants return `Other`.

### `checkBudget(category, amount, periodMonth?)`

Adds the proposed expense to recorded spending for the category and month.

- Arguments: valid category, positive amount, and optional month as `YYYY-MM` (defaults to the current UTC month)
- Success: `{ ok, category, periodMonth, spent, amount, projected, budgetLimit, remaining, exceedsBudget, budgetSet }`
- When no budget exists for that category/month, `budgetSet` is `false`; `budgetLimit`, `remaining`, and `exceedsBudget` are `null`.
- Budgets are inserted or updated with the database helper `setBudget` exported from `db.js`.

### `flagAnomaly(transaction)`

Checks for a likely duplicate (same merchant, amount, and calendar date) and an unusually large amount.

- Argument: object with `merchant`, positive `amount`, and valid `transactionDate`; `transaction_date` is accepted as an alias
- Success: `{ ok: true, isAnomaly, flags }`
- The default large-expense threshold is 10,000 amount units. This is a configurable-in-code heuristic, not financial advice.
- A duplicate can be matched by the raw-alert fingerprint during saving or by merchant, amount, and date.

### `saveTransaction(data)`

Validates and saves a transaction. If `category` is omitted it is inferred from the merchant. `paymentMode` / `payment_mode`, `transactionDate` / `transaction_date`, and `rawAlertText` / `raw_alert_text` are accepted.

- Required: `merchant` (string), `amount` (positive number), and `transactionDate` (ISO date or datetime string)
- Optional: `category`, `paymentMode`, `rawAlertText`
- New record: `{ ok: true, inserted: true, transaction, anomaly }`
- Duplicate: `{ ok: true, inserted: false, duplicate: true, transaction, message }`
- An identical normalized raw alert is protected by a unique database fingerprint. Same merchant/amount/date is also treated as a likely duplicate to avoid double-counting.

### `sendAlert(message)`

Validates a non-empty message, writes it to the Node console, and returns `{ ok: true, logged: true, channel: 'console', message, loggedAt }`. It does **not** send SMS, email, push notifications, or any external message.

## Database exports

`db.js` also exports:

- `initDatabase({ filename? })` — create the schema if missing and return the SQLite connection.
- `getDatabase()` — return the initialized connection.
- `insertTransaction(transaction)` — insert a validated record and return `{ inserted, transaction }`.
- `getTransactionById(id)` and `findTransactionByDedupeKey(key)` — look up transaction records.
- `findPotentialDuplicate(transaction)` — find a same-merchant/amount/date record.
- `getMonthlySpend(category, periodMonth)` and `getBudget(category, periodMonth)` — read spending and budget data.
- `setBudget({ category, budgetLimit, periodMonth })` — create or update a category/month budget.
- `closeDatabase()` — close the connection (useful for orderly shutdown and scripts).
- `CATEGORIES` — the allowed category names.

Tables:

- `transactions`: `id`, `merchant`, `amount`, `category`, `transaction_date`, `payment_mode`, `raw_alert_text`, `dedupe_key`, and `created_at`.
- `budgets`: `id`, `category`, `budget_limit`, and `period_month` (`YYYY-MM`).

The schema applies positive-amount constraints, allowed-category constraints, a unique raw-alert fingerprint, and a unique budget per category/month. Queries use prepared statements.

## Teammate integration

1. Copy this folder into the main project, or copy its files into a dedicated module directory such as `src/budgetbuddy-group2/`.
2. Install `better-sqlite3` in the main project's package:

   ```bash
   npm install better-sqlite3
   ```

3. Update import paths to match where the folder was placed. For example:

   ```js
   const tools = require('./BudgetBuddy-Group2/tools');
   const { initDatabase, setBudget, closeDatabase } =
     require('./BudgetBuddy-Group2/db');

   initDatabase(); // optional; tools initialize the database on first use
   const parsed = tools.extractTransaction(bankAlertText);
   if (parsed.ok && parsed.transaction.merchant && parsed.transaction.transactionDate) {
     const saved = tools.saveTransaction(parsed.transaction);
     console.log(saved);
   }
   ```

4. Set `BUDGETBUDDY_DB_PATH` if the main app should keep the SQLite file outside this module directory. Use the same path for every process that should share this database.
5. Set budgets using `setBudget({ category: 'Food', budgetLimit: 12000, periodMonth: '2026-10' })`. The amount values use the same currency units as transaction alerts.
6. Call `closeDatabase()` when the application is shutting down if the main app needs explicit connection cleanup.

If the backend uses ES modules, import the CommonJS module through Node's CommonJS interoperability or keep this folder's `require()` interface unchanged and wrap it in the backend.
