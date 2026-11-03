// gmail.js
const { google } = require("googleapis");
const fs = require("fs");

const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost:3000/auth/callback"
);
const TOKEN_FILE = "tokens.json";
const SEEN_FILE = "processed.json";

const load = (f, d) => { try { return JSON.parse(fs.readFileSync(f)); } catch { return d; } };
const save = (f, v) => fs.writeFileSync(f, JSON.stringify(v));

function authUrl() {
  return oauth2.generateAuthUrl({
    access_type: "offline", prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/gmail.send"]
  });
}
async function handleCallback(code) {
  const { tokens } = await oauth2.getToken(code);
  save(TOKEN_FILE, tokens);
}

function bodyText(msg) {
  // Safe guard: check if payload exists
  if (!msg || !msg.payload) return msg?.snippet || "";
  
  const parts = msg.payload.parts || [msg.payload];
  const plain = parts.find(p => p.mimeType === "text/plain" && p.body?.data);
  const data = plain?.body?.data || msg.payload.body?.data;
  
  return data ? Buffer.from(data, "base64url").toString("utf8") : (msg.snippet || "");
}
async function fetchNewAlerts() {
  oauth2.setCredentials(load(TOKEN_FILE, {}));
  const gmail = google.gmail({ version: "v1", auth: oauth2 });
  const seen = new Set(load(SEEN_FILE, []));

  const list = await gmail.users.messages.list({
    userId: "me", maxResults: 20,
    q: 'newer_than:7d (debited OR credited OR "UPI" OR "spent" OR receipt)',
  });

  const out = [];
  for (const { id } of list.data.messages || []) {
    if (seen.has(id)) continue;
    const msg = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    out.push({ id, text: bodyText(msg).slice(0, 1500) });
    seen.add(id);
  }
  save(SEEN_FILE, [...seen]);
  return out;
}
async function sendEmail(subject, body) {
  // 1. Load the token from the file
  const tokens = load(TOKEN_FILE, {});
  
  // 2. Check if the token is actually there
  if (!tokens || !tokens.access_token) {
    throw new Error("No tokens found. Please re-authenticate at /auth");
  }
  
  // 3. Set the credentials
  oauth2.setCredentials(tokens);
  
  const gmail = google.gmail({ version: "v1", auth: oauth2 });
  
   const emailLines = [
    'To: gigglesglue0@gmail.com',
    'From: gigglesglue0@gmail.com', 
    'Subject: ' + subject,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body
  ];
  const email = emailLines.join('\n');
  const base64EncodedEmail = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: base64EncodedEmail }
  });
  console.log(`[Gmail] Sent email: ${subject}`);
}
module.exports = { authUrl, handleCallback, fetchNewAlerts,sendEmail };