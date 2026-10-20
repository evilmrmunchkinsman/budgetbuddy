// Fake BudgetBuddy server (Group 4 only, for testing your script before the real API exists)
// Usage: node mockServer.js     then in a second terminal: node testRunner.js
// Needs Node 18+. No npm install required.
const http = require("http");
const fs = require("fs"); 

const seen = new Set();
const totals = {};

const CATEGORIES = {
  zomato: "Food", swiggy: "Food", uber: "Travel", ola: "Travel",
  reliance: "Shopping", croma: "Shopping", amazon: "Shopping",
};

// Very rough stand-in for the real agent: regex + keyword lookup
function fakeProcess(text) {
  const amt = text.match(/Rs\.?\s?([\d,]+(?:\.\d+)?)/i);
  const amount = amt ? parseFloat(amt[1].replace(/,/g, "")) : 0;
  const merchantMatch = text.match(/(?:at|to)\s+([A-Z][A-Z0-9 ]+?)(?:\s+(?:on|via|using)|\.|$)/);
  const merchant = merchantMatch ? merchantMatch[1].trim() : "UNKNOWN";
  const date = (text.match(/\d{1,2}-[A-Za-z]{3}-\d{2}/) || [""])[0];

  const key = `${merchant}|${amount}|${date}`;
  const duplicate = seen.has(key);
  seen.add(key);

  const category = CATEGORIES[merchant.split(" ")[0].toLowerCase()] || "Other";
  totals[category] = (totals[category] || 0) + amount;
  const large = amount > 20000;
  const overBudget = totals[category] > 5000;

  return {
    transaction: { merchant, amount, date, category, flagged: duplicate || large },
    budgetStatus: { overBudget, spent: totals[category], limit: 5000 },
    alertSent: overBudget || duplicate || large,
  };
}

http.createServer((req, res) => {
  
  // 1. Serve the Dashboard HTML
  if (req.method === "GET" && req.url === "/") {
    fs.readFile("dashboard.html", (err, data) => {
      if (err) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain");
        res.end("Error loading dashboard.html. Did you create it?");
      } else {
        res.setHeader("Content-Type", "text/html");
        res.end(data);
      }
    });
    return; // Stop processing further routes
  }

  // Set JSON header for all API routes below this
  res.setHeader("Content-Type", "application/json");

  // 2. POST /process-alert
  if (req.method === "POST" && req.url === "/process-alert") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { text } = JSON.parse(body);
        res.end(JSON.stringify(fakeProcess(text)));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "bad request" }));
      }
    });
  } 
  // 3. GET /report
  else if (req.method === "GET" && req.url === "/report") {
    res.end(JSON.stringify({ spendByCategory: totals }));
  } 
  // 4. GET /transactions
  else if (req.method === "GET" && req.url === "/transactions") {
    res.end(JSON.stringify([
      { id: 1, merchant: "ZOMATO", amount: 450, date: "12-Aug-25", category: "Food", flagged: false },
      { id: 2, merchant: "UBER", amount: 899, date: "12-Aug-25", category: "Travel", flagged: false },
      { id: 3, merchant: "RELIANCE TRENDS", amount: 2400, date: "12-Aug-25", category: "Shopping", flagged: false },
      { id: 4, merchant: "ZOMATO", amount: 450, date: "12-Aug-25", category: "Food", flagged: true },
      { id: 5, merchant: "CROMA ELECTRONICS", amount: 48000, date: "12-Aug-25", category: "Shopping", flagged: true }
    ]));
  } 
  // 5. GET /summary
  else if (req.method === "GET" && req.url === "/summary") {
    res.end(JSON.stringify({
      totalSpent: 52199,
      spendByCategory: {
        "Food": 900,
        "Travel": 899,
        "Shopping": 50400
      },
      budgets: {
        "Food": 4000,
        "Travel": 2000,
        "Shopping": 10000
      }
    }));
  } 
  // 6. PUT /budgets
  else if (req.method === "PUT" && req.url === "/budgets") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { category, limit } = JSON.parse(body);
        res.end(JSON.stringify({ success: true, message: `Budget for ${category} updated to ${limit}` }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "bad request" }));
      }
    });
  } 
  // 7. Catch-all for 404
  else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  }
}).listen(3000, () => console.log("Mock BudgetBuddy server running on http://localhost:3000"));