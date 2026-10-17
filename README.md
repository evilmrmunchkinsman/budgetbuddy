# BudgetBuddy

**An agentic AI personal finance assistant that turns the bank, UPI and receipt alerts you already receive into automatic expense tracking, budget warnings and monthly reports.**

> Current state: prototype, running on sample alert data.

---

## The problem

People get financial alerts all day (bank SMS, UPI notifications, receipt emails), but:

- **Alerts are scattered** across SMS and email, so there is no single view of spending.
- **Manual logging doesn't last.** Most people stop tracking within a few weeks.
- **Feedback comes too late.** Overspending is discovered after the money is gone.
- **Duplicate or unusual charges go unnoticed.**

The data already exists. What is missing is something that acts on it automatically.

## The solution

BudgetBuddy reads each transaction alert, understands it, and acts, with no manual entry. It:

1. **Reads** bank/UPI alerts and receipt emails
2. **Extracts** merchant, amount and date
3. **Categorises** every expense (Food, Travel, Shopping, ...)
4. **Monitors** spending against category budgets and flags duplicate or unusual charges
5. **Reports** with instant alerts when a budget is crossed and a monthly spending summary

### Why it is "agentic"

BudgetBuddy does not follow a hardcoded sequence of steps. An LLM agent is given a set of **tools** and decides which to call, in what order, by looking at each result before choosing the next action (decide, act, observe, repeat). This is the Collect → Understand → Analyse → Act loop.

---

## Architecture

```
Transaction alert (SMS / email text)
        │
        ▼
  Express API  ── POST /process-alert
        │
        ▼
   AI Agent (LLM + tool-use loop)  ◄──►  Tools + SQLite
        │                                  ├─ extractTransaction
        ▼                                  ├─ categorizeExpense
 Alerts + Monthly report                   ├─ checkBudget
                                           ├─ flagAnomaly
                                           ├─ saveTransaction
                                           └─ sendAlert
```

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (18+) |
| API | Express |
| AI agent | LLM with tool use (Claude API via `@anthropic-ai/sdk`) |
| Database | SQLite (`better-sqlite3`) |
| Config | `dotenv` |
| Data (prototype) | JSON file of sample alerts |

---

## Project structure

```
budgetbuddy/
├── data/
│   └── sample-alerts.json     # sample bank/UPI alert messages
├── src/
│   ├── db.js                  # SQLite setup (transactions, budgets)
│   ├── tools.js               # the six tools the agent can call
│   ├── agent.js               # the agent loop (tool use)
│   ├── report.js              # spending report logic
│   └── server.js              # Express app and routes
├── test-runner.js             # sends all sample alerts to the API, prints PASS/FAIL
├── mock-server.js             # stand-in API for testing without the full backend
├── .env                       # your API key (never commit this)
└── package.json
```

---

## Getting started

### Prerequisites

- Node.js 18 or higher
- Git
- An Anthropic API key

### Install

```bash
git clone <repo-url>
cd <repo-name>
npm install
```

### Configure

Create a `.env` file in the project root:

```
ANTHROPIC_API_KEY=your_key_here
PORT=3000
```

Never commit `.env`. Make sure it is listed in `.gitignore`.

### Run

```bash
node src/server.js
```

The API starts on `http://localhost:3000`.

---

## API

### `POST /process-alert`

Send a raw alert, get back the structured result.

**Request**
```json
{ "text": "Rs.450.00 debited from A/c XX1234 at ZOMATO on 12-Aug-25." }
```

**Response**
```json
{
  "transaction": {
    "merchant": "ZOMATO",
    "amount": 450,
    "date": "12-Aug-25",
    "category": "Food",
    "flagged": false
  },
  "budgetStatus": { "overBudget": false, "spent": 450, "limit": 5000 },
  "alertSent": false
}
```

### `GET /report`

Returns spending totals by category and the list of flagged transactions.

---

## Agent tools

| Tool | Input | Returns |
|---|---|---|
| `extractTransaction(text)` | raw alert text | `{ merchant, amount, date }` |
| `categorizeExpense(merchant)` | merchant name | category string, e.g. `"Food"` |
| `checkBudget(category, amount)` | category, amount | `{ overBudget, spent, limit }` |
| `flagAnomaly(transaction)` | transaction object | `{ flagged, reason }` |
| `saveTransaction(data)` | transaction object | `{ id }` |
| `sendAlert(message)` | alert text | `{ sent }` |

**Detection rules**
- **Duplicate:** same merchant and amount within a short time window
- **Unusual:** amount far above the category's average spend

---

## Testing

Start the server, then in a second terminal run:

```bash
node test-runner.js
```

This sends every alert in `data/sample-alerts.json` to `POST /process-alert`, checks that the response has the expected fields, prints PASS or FAIL for each alert, and finishes with the `/report` output.

To test without the full backend:

```bash
node mock-server.js        # terminal 1: stand-in API
node test-runner.js        # terminal 2
```

If your server runs on another port:

```bash
API_URL=http://localhost:4000 node test-runner.js
```

---

## Roadmap

- [ ] Read real Gmail and SMS instead of sample data
- [ ] Dashboard for budgets and reports
- [ ] Scheduled monthly report
- [ ] Conversational agent for questions like "how much did I spend on food this month?"
- [ ] Shared / family budgets

## Privacy and security

The prototype uses sample data only. A real deployment would use read-only access to messages and email, keep API keys in environment variables, encrypt stored data, and require explicit user consent.
