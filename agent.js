'use strict';
require('dotenv').config();
const Groq = require('groq-sdk');
const agentTools = require('./agentTools');

if (!process.env.GROQ_API_KEY) {
  console.error('FATAL: GROQ_API_KEY is missing in .env');
  process.exit(1);
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Groq uses OpenAI-style tool schemas
const toolsSchema = [
  {
    type: "function",
    function: {
      name: "extractTransaction",
      description: "Extracts merchant, amount, and date from the alert text.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "categorizeExpense",
      description: "Categorizes a merchant into a spending category.",
      parameters: {
        type: "object",
        properties: { merchant: { type: "string" } },
        required: ["merchant"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "checkBudget",
      description: "Checks if a transaction amount exceeds the budget.",
      parameters: {
        type: "object",
        properties: { category: { type: "string" }, amount: { type: "number" } },
        required: ["category", "amount"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "flagAnomaly",
      description: "Checks if a transaction is a duplicate or unusually large.",
      parameters: {
        type: "object",
        properties: { 
          merchant: { type: "string" }, 
          amount: { type: "number" }, 
          date: { type: "string" }, 
          category: { type: "string" } 
        },
        required: ["merchant", "amount", "date", "category"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "saveTransaction",
      description: "Saves a transaction to the database.",
      parameters: {
        type: "object",
        properties: { 
          merchant: { type: "string" }, 
          amount: { type: "number" }, 
          date: { type: "string" }, 
          category: { type: "string" }, 
          flagged: { type: "boolean" } 
        },
        required: ["merchant", "amount", "date", "category", "flagged"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "sendAlert",
      description: "Sends an alert message to the user.",
      parameters: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"]
      }
    }
  }
];

const SYSTEM_PROMPT = `You are BudgetBuddy, an AI financial assistant.
Process raw bank/UPI alert text step-by-step:
1. extractTransaction. If the text is not a transaction, STOP and say "Not a transaction".
2. categorizeExpense. Use the merchant name.
3. checkBudget.
4. flagAnomaly.
5. saveTransaction. 
   CRITICAL: You must ALWAYS format the "date" field as YYYY-MM-DD. 
   For example, "12-Aug-25" must become "2025-08-12".
6. If budget exceeded OR flagged, sendAlert.
7. Return a final text summary.`;

async function processAlert(alertText) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: alertText }
  ];

  let step = 0;
  const MAX_STEPS = 10;
  let lastTransaction = null, lastBudget = null, lastAnomaly = null, lastCategory = "Other", alertSent = false;

  while (step < MAX_STEPS) {
    step++;
    console.log(`\n[Agent] Step ${step}...`);

    const response = await groq.chat.completions.create({
      model:  "openai/gpt-oss-120b", // Extremely fast and smart
      messages: messages,
      tools: toolsSchema,
      tool_choice: "auto",
      temperature: 0
    });

    const responseMessage = response.choices[0].message;
    messages.push(responseMessage);

    const toolCalls = responseMessage.tool_calls;
    
    if (!toolCalls || toolCalls.length === 0) {
      console.log(`[Agent] Finished. Final text: "${responseMessage.content}"`);
      if (responseMessage.content.includes("Not a transaction")) {
        return { error: "Not a transaction", text: responseMessage.content };
      }
      break;
    }

    for (const toolCall of toolCalls) {
      const name = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);
      console.log(`[Agent Tool] ${name}(${JSON.stringify(args)})`);
      
      let result;
      try {
        switch (name) {
          case 'extractTransaction':
            result = agentTools.extractTransaction(args.text);
            lastTransaction = { ...result };
            break;
          case 'categorizeExpense': 
            result = agentTools.categorizeExpense(args.merchant); 
            lastCategory = result; 
            break;
          case 'checkBudget': 
            result = agentTools.checkBudget(args.category, args.amount); 
            lastBudget = result; 
            break;
          case 'flagAnomaly': 
            result = agentTools.flagAnomaly(args); 
            lastAnomaly = result; 
            break;
          case 'saveTransaction': 
            result = agentTools.saveTransaction(args); 
            break;
          case 'sendAlert': 
            result = agentTools.sendAlert(args.message); 
            alertSent = true; 
            break;
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      } catch (err) {
        console.log(`[Agent Tool Error] ${err.message}`);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: err.message })
        });
      }
    }
  }

  return {
    transaction: {
      merchant: lastTransaction?.merchant || "Unknown",
      amount: lastTransaction?.amount || 0,
      date: lastTransaction?.date || new Date().toISOString().split('T')[0],
      category: lastCategory,
      flagged: lastAnomaly?.flagged || false
    },
    budgetStatus: lastBudget || { overBudget: false, spent: 0, limit: 0 },
    alertSent: alertSent
  };
}

module.exports = { processAlert };