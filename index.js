const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const path = require("path");
const dns = require("dns");
const validator = require("validator");
const { SMTPClient } = require("smtp-client");

const app = express();
const PORT = process.env.PORT || 3000;

// views
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function validateEmail(email) {
  const result = {
    syntax: false,
    mailServer: false,
    mailbox: false,
    catchAll: false,
  };

  // Syntax check
  if (!validator.isEmail(email)) {
    return { valid: false, reason: "Invalid syntax", ...result };
  }
  result.syntax = true;

  // Extract domain
  const domain = email.split("@")[1];

  // Check mail server (MX records)
  let mxRecords;
  try {
    mxRecords = await dns.promises.resolveMx(domain);
  } catch (err) {
    console.error(`DNS lookup error: ${err.message}`);
    return { valid: false, reason: "Domain has no MX records", ...result };
  }

  if (mxRecords.length === 0) {
    return { valid: false, reason: "Domain has no MX records", ...result };
  }

  result.mailServer = true;

  // Sort MX records by priority
  mxRecords.sort((a, b) => a.priority - b.priority);

  // Check connection
  let connected = false;
  for (const mxRecord of mxRecords) {
    const client = new SMTPClient({
      host: mxRecord.exchange,
      port: 25,
      timeout: 5000,
    });

    try {
      await client.connect();
      await client.greet({ hostname: "localhost" });
      await client.mail({ from: "test@example.com" });
      await client.rcpt({ to: email });
      await client.quit();
      connected = true;
      break;
    } catch (err) {
      console.error(
        `SMTP connection error to ${mxRecord.exchange}: ${err.message}`
      );
      continue;
    }
  }

  if (!connected) {
    return { valid: false, reason: "Cannot connect to mail server", ...result };
  }

  result.mailbox = true;

  // Check Catch-All
  try {
    const client = new SMTPClient({
      host: mxRecords[0].exchange,
      port: 25,
      timeout: 5000,
    });

    await client.connect();
    await client.greet({ hostname: "localhost" });
    await client.mail({ from: "test@example.com" });
    const catchAllResult = await client.rcpt({
      to: "random_address@" + domain,
    });
    await client.quit();

    if (catchAllResult.code === 250) {
      return { valid: false, reason: "Domain is catch-all", ...result };
    }
  } catch (err) {
    console.error(`Catch-all check error: ${err.message}`);
  }

  result.catchAll = true;
  return { valid: true, reason: "Valid email address", ...result };
}

// routes
app.get("/", (req, res) => {
  res.render("form", { result: null, details: {} });
});

app.post("/validate-email", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.render("form", { result: "Email is required", details: {} });
  }

  try {
    const validationResult = await validateEmail(email);
    res.render("form", {
      result: `Email ${email} is ${validationResult.reason}`,
      details: validationResult,
    });
  } catch (err) {
    console.error(`Error validating email: ${err.message}`);
    res
      .status(500)
      .render("form", { result: "Internal Server Error", details: {} });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
