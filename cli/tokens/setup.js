#!/usr/bin/env node
/**
 * Setup OAuth
 * Interactive OAuth setup for all services
 */

require("dotenv").config();
const {
  selectSources,
  confirmOperation,
  showSuccess,
  showError,
  showInfo,
} = require("../../src/utils/cli");
const TokenService = require("../../src/services/TokenService");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const OAUTH_SERVICES = [
  "Personal Google Calendar",
  "Work Google Calendar",
  "Strava",
  "Withings",
];

async function main() {
  console.log("\n🔧 Brickomations - OAuth Setup Wizard\n");

  try {
    // 1. Select services to setup
    const selectedServices = await selectSources(OAUTH_SERVICES);

    if (selectedServices.length === 0) {
      console.log("\n❌ No services selected\n");
      process.exit(0);
    }

    // 2. Confirm operation
    const confirmed = await confirmOperation(
      `\nReady to setup OAuth for ${selectedServices.length} service(s)?`
    );

    if (!confirmed) {
      console.log("\n❌ Operation cancelled\n");
      process.exit(0);
    }

    // 3. Setup each service
    const tokenService = new TokenService();

    for (const service of selectedServices) {
      console.log("\n");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`Setting up ${service}...`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      try {
        await setupService(service, tokenService);
        showSuccess(`${service} setup completed!`);
      } catch (error) {
        showError(`${service} setup failed`, error);
      }
    }

    console.log("\n");
    showSuccess("OAuth setup wizard completed!");
    console.log(
      "\n💡 Tip: Run 'yarn tokens' to verify all tokens are working\n"
    );
  } catch (error) {
    showError("Fatal error", error);
    process.exit(1);
  }
}

async function setupService(service, tokenService) {
  // Normalize service name to handle both capitalized and lowercase versions
  const normalizedService = service.toLowerCase();

  switch (normalizedService) {
    case "personal google calendar":
      await setupGooglePersonalCalendar(tokenService);
      break;

    case "work google calendar":
      await setupGoogleWorkCalendar(tokenService);
      break;

    case "strava":
      await setupStrava(tokenService);
      break;

    case "withings":
      await setupWithings(tokenService);
      break;

    default:
      throw new Error(`Unknown service: ${service}`);
  }
}

async function setupGooglePersonalCalendar(tokenService) {
  console.log("Personal Google Calendar OAuth Setup\n");

  // Check if credentials already exist
  const clientId = process.env.PERSONAL_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.PERSONAL_GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log("⚠️  Google OAuth credentials not found in .env file.\n");
    console.log("To setup Personal Google Calendar OAuth:");
    console.log("1. Go to https://console.cloud.google.com/");
    console.log("2. Create a new project or select an existing one");
    console.log("3. Enable the Google Calendar API");
    console.log("4. Create OAuth 2.0 credentials (Desktop app)");
    console.log("5. Add these to your .env file:");
    console.log("   - PERSONAL_GOOGLE_CLIENT_ID");
    console.log("   - PERSONAL_GOOGLE_CLIENT_SECRET\n");

    const hasCredentials = await askYesNo(
      "Have you added the credentials to .env?"
    );

    if (!hasCredentials) {
      throw new Error("Please add credentials to .env and run setup again");
    }

    // Reload .env
    require("dotenv").config();
  }

  // Generate auth URL
  showInfo("Generating authorization URL...");
  const authUrl = await tokenService.getGoogleAuthUrl("personal");

  console.log("\n📋 Authorization URL:\n");
  console.log(authUrl);
  console.log("\n1. Open this URL in your browser");
  console.log("2. Authorize the application");
  console.log("3. Copy the authorization code from the redirect URL\n");

  const codeInput = await askQuestion("Enter the authorization code: ");
  const code = extractCodeFromInput(codeInput.trim());

  // Exchange code for tokens
  showInfo("Exchanging code for tokens...");
  const tokens = await tokenService.exchangeGoogleCode(code, "personal");

  // Update .env file
  updateEnvFile({
    PERSONAL_GOOGLE_REFRESH_TOKEN: tokens.refreshToken,
  });

  showSuccess("Personal Google Calendar OAuth setup completed!");
}

async function setupGoogleWorkCalendar(tokenService) {
  console.log("Work Google Calendar OAuth Setup\n");

  // Check if credentials already exist
  const clientId = process.env.WORK_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.WORK_GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log("⚠️  Google OAuth credentials not found in .env file.\n");
    console.log("To setup Work Google Calendar OAuth:");
    console.log("1. Go to https://console.cloud.google.com/");
    console.log("2. Create a new project or select an existing one");
    console.log("3. Enable the Google Calendar API");
    console.log("4. Create OAuth 2.0 credentials (Desktop app)");
    console.log("5. Add these to your .env file:");
    console.log("   - WORK_GOOGLE_CLIENT_ID");
    console.log("   - WORK_GOOGLE_CLIENT_SECRET\n");

    const hasCredentials = await askYesNo(
      "Have you added the credentials to .env?"
    );

    if (!hasCredentials) {
      throw new Error("Please add credentials to .env and run setup again");
    }

    // Reload .env
    require("dotenv").config();
  }

  // Generate auth URL
  showInfo("Generating authorization URL...");
  const authUrl = await tokenService.getGoogleAuthUrl("work");

  console.log("\n📋 Authorization URL:\n");
  console.log(authUrl);
  console.log("\n1. Open this URL in your browser");
  console.log("2. Authorize the application");
  console.log("3. Copy the authorization code from the redirect URL\n");

  const codeInput = await askQuestion("Enter the authorization code: ");
  const code = extractCodeFromInput(codeInput.trim());

  // Exchange code for tokens
  showInfo("Exchanging code for tokens...");
  const tokens = await tokenService.exchangeGoogleCode(code, "work");

  // Update .env file
  updateEnvFile({
    WORK_GOOGLE_REFRESH_TOKEN: tokens.refreshToken,
  });

  showSuccess("Work Google Calendar OAuth setup completed!");
}

async function setupStrava(tokenService) {
  console.log("Strava OAuth Setup\n");

  // Check if credentials already exist
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log("⚠️  Strava OAuth credentials not found in .env file.\n");
    console.log("To setup Strava OAuth:");
    console.log("1. Go to https://www.strava.com/settings/api");
    console.log("2. Create a new application");
    console.log("3. Set Authorization Callback Domain to 'localhost'");
    console.log("4. Add these to your .env file:");
    console.log("   - STRAVA_CLIENT_ID");
    console.log("   - STRAVA_CLIENT_SECRET\n");

    const hasCredentials = await askYesNo(
      "Have you added the credentials to .env?"
    );

    if (!hasCredentials) {
      throw new Error("Please add credentials to .env and run setup again");
    }

    // Reload .env
    require("dotenv").config();
  }

  // Generate auth URL
  showInfo("Generating authorization URL...");
  const authUrl = await tokenService.getStravaAuthUrl();

  console.log("\n📋 Authorization URL:\n");
  console.log(authUrl);
  console.log("\n1. Open this URL in your browser");
  console.log("2. Authorize the application");
  console.log("3. Copy the authorization code from the redirect URL\n");

  const codeInput = await askQuestion("Enter the authorization code: ");
  const code = extractCodeFromInput(codeInput.trim());

  // Exchange code for tokens
  showInfo("Exchanging code for tokens...");
  const tokens = await tokenService.exchangeStravaCode(code);

  // Update .env file
  updateEnvFile({
    STRAVA_ACCESS_TOKEN: tokens.accessToken,
    STRAVA_REFRESH_TOKEN: tokens.refreshToken,
    STRAVA_TOKEN_EXPIRY: tokens.expiresAt,
  });

  showSuccess("Strava OAuth setup completed!");
}

async function setupWithings(tokenService) {
  console.log("Withings OAuth Setup\n");

  // Check if credentials already exist
  const clientId = process.env.WITHINGS_CLIENT_ID;
  const clientSecret = process.env.WITHINGS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log("⚠️  Withings OAuth credentials not found in .env file.\n");
    console.log("To setup Withings OAuth:");
    console.log("1. Go to https://developer.withings.com/");
    console.log("2. Create a new application");
    console.log("3. Set Redirect URI to 'http://localhost:3000/callback'");
    console.log("4. Add these to your .env file:");
    console.log("   - WITHINGS_CLIENT_ID");
    console.log("   - WITHINGS_CLIENT_SECRET\n");

    const hasCredentials = await askYesNo(
      "Have you added the credentials to .env?"
    );

    if (!hasCredentials) {
      throw new Error("Please add credentials to .env and run setup again");
    }

    // Reload .env
    require("dotenv").config();
  }

  // Generate auth URL
  showInfo("Generating authorization URL...");
  const authUrl = await tokenService.getWithingsAuthUrl();

  console.log("\n📋 Authorization URL:\n");
  console.log(authUrl);
  console.log("\n1. Open this URL in your browser");
  console.log("2. Authorize the application");
  console.log("3. Copy the authorization code from the redirect URL\n");

  const codeInput = await askQuestion("Enter the authorization code: ");
  const code = extractCodeFromInput(codeInput.trim());

  // Exchange code for tokens
  showInfo("Exchanging code for tokens...");
  const tokens = await tokenService.exchangeWithingsCode(code);

  // Update .env file
  updateEnvFile({
    WITHINGS_ACCESS_TOKEN: tokens.accessToken,
    WITHINGS_REFRESH_TOKEN: tokens.refreshToken,
    WITHINGS_TOKEN_EXPIRY: tokens.expiresAt,
    WITHINGS_USER_ID: tokens.userId,
  });

  showSuccess("Withings OAuth setup completed!");
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function extractCodeFromInput(input) {
  if (input.startsWith("http")) {
    try {
      const url = new URL(input);
      return url.searchParams.get("code") || input;
    } catch (error) {
      return input;
    }
  }
  return input;
}

async function askYesNo(query) {
  const answer = await askQuestion(`${query} (y/n): `);
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

function updateEnvFile(updates) {
  const envPath = path.join(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    throw new Error(".env file not found");
  }

  let envContent = fs.readFileSync(envPath, "utf-8");

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, "m");

    if (regex.test(envContent)) {
      // Update existing line
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      // Add new line
      envContent += `\n${key}=${value}`;
    }
  }

  fs.writeFileSync(envPath, envContent);
}

// Run main function
main().catch((error) => {
  showError("Unhandled error", error);
  process.exit(1);
});
