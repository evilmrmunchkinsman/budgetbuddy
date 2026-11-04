# 💸 BudgetBuddy: Agentic AI Personal Finance Assistant

BudgetBuddy is an intelligent personal finance assistant that reads bank SMS alerts, UPI notifications, and receipt emails. Unlike traditional budgeting apps that use rigid regex rules, the core of BudgetBuddy is an **Agentic AI loop** powered by Groq (Llama 3). The AI decides which tools to call, in what order, to extract data, categorize expenses, detect anomalies, and alert the user.

## 🧠 How the Agent Works
When a text alert is received, the LLM does not just return JSON. It uses **Tool Calling** to reason step-by-step:
1. **Decide:** Reads the alert and decides what to do first.
2. **Act:** Calls a tool (e.g., `extractTransaction`).
3. **Observe:** Sees the result and decides the next step (e.g., `categorizeExpense`).
4. **Repeat:** Loops until the transaction is saved and alerts are sent (Max 10 steps to prevent infinite loops).

## 🛠️ Tech Stack
* **Backend:** Node.js, Express
* **Database:** SQLite
* **AI Agent:** Groq API (Llama 3)
* **Integrations:** Gmail API (OAuth 2.0), Telegram Bot API
* **Dashboard:** Vanilla HTML/JS with Chart.js

## 🚀 How to Run Locally
1. `npm install`
2. Copy `.env.example` to `.env` and add your API keys (Groq, Telegram, Google).
3. `node server.js`
4. `node testRunner.js` (to run the Agent test suite).
5. Open `http://localhost:3000` for the dashboard.

## 🔒 Security
All secrets are stored in `.env` (ignored by Git). Tokens are dynamically generated and never committed.
