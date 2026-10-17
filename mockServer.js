// Fake BudgetBuddy server (Group 4 only, for testing your script before the real API exists)
// Usage: node mock-server.js     then in a second terminal: node test-runner.js
// Needs Node 18+. No npm install required.

const http = require("http");

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
  res.setHeader("Content-Type", "application/json");

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
  } else if (req.method === "GET" && req.url === "/report") {
    res.end(JSON.stringify({ spendByCategory: totals }));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  }
}).listen(3000, () => console.log("Mock BudgetBuddy server running on http://localhost:3000"));