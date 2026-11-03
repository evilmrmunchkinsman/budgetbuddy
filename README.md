# 💸 BudgetBuddy: Agentic AI Personal Finance Assistant

BudgetBuddy is an intelligent personal finance assistant that reads bank SMS alerts, UPI notifications, and receipt emails. Instead of using rigid regex rules, the core of BudgetBuddy is an **Agentic AI loop** (powered by Groq/Llama 3) that decides which tools to call, in what order, to extract data, categorize expenses, detect anomalies, and alert the user.

## 🧠 Architecture: How the Agent Works
The core of this project is the **Agentic Loop** (`agent.js`). When a text alert is received, the LLM does not just return a JSON response. It uses **Tool Calling** to reason step-by-step:
1. **Decide:** The AI reads the alert and decides what to do first.
2. **Act:** The AI calls a tool (e.g., `extractTransaction`).
3. **Observe:** The AI sees the result and decides the next step (e.g., `categorizeExpense`).
4. **Repeat:** It loops until the transaction is saved and alerts are sent (Max 10 steps to prevent infinite loops).

## 🛠️ Tech Stack
* **Backend:** Node.js, Express
* **Database:** SQLite (`better-sqlite3`)
* **AI Agent:** Groq API (Llama 3 - `openai/gpt-oss-120b` for fast, free tool calling)
* **Integrations:** Gmail API (OAuth 2.0), Telegram Bot API
* **Testing:** Custom Node.js test runner (`testRunner.js`)

## 🚀 Getting Started (Local Setup)

### 1. Prerequisites
* Node.js (v18 or higher)
* A Groq API Key (Free at [console.groq.com](https://console.groq.com))
* A Telegram Bot Token (via `@BotFather`)

### 2. Installation
```bash
git clone https://github.com/evilmrmunchkinsman/budgetbuddy.git
cd budgetbuddy
npm install