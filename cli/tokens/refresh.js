#!/usr/bin/env node
/**
 * Refresh Tokens
 * Refresh expired OAuth tokens for all services
 */

require("dotenv").config();
const {
  confirmOperation,
  showSuccess,
  showError,
  showInfo,
  showSummary,
} = require("../../src/utils/cli");
const TokenService = require("../../src/services/TokenService");
const tokenConfig = require("../../src/config/tokens");
const fs = require("fs");
const path = require("path");

const autoMode = process.argv.includes("--auto");

async function main() {
  console.log("\n🔄 Brickomations - Token Refresher\n");
  console.log("This command refreshes OAuth2 tokens for services that support token refresh.");
  console.log("Note: API key services (Notion, Oura) don't expire and don't need refresh.\n");

  try {
    const tokenService = new TokenService();
    const results = [];

    const refreshableServices = tokenConfig.getRefreshableServices();
    const tokensToRefresh = refreshableServices.filter(
      (key) => tokenConfig.getService(key).getCredentials?.()
    );

    if (tokensToRefresh.length === 0) {
      showSuccess("No refreshable tokens configured!");
      console.log("\n");
      process.exit(0);
    }

    console.log(
      `\nRefreshing: ${tokensToRefresh
        .map((key) => tokenConfig.getService(key).name)
        .join(", ")}\n`
    );

    // Confirm operation (skip in auto mode)
    if (!autoMode) {
      const confirmed = await confirmOperation(
        `Ready to refresh ${tokensToRefresh.length} token(s)?`
      );

      if (!confirmed) {
        console.log("\n❌ Operation cancelled\n");
        process.exit(0);
      }
    }

    // Refresh tokens
    for (const serviceKey of tokensToRefresh) {
      const serviceConfig = tokenConfig.getService(serviceKey);
      showInfo(`Refreshing ${serviceConfig.name}...`);

      try {
        const result = await tokenService.refreshServiceByKey(serviceKey);

        // Update .env file
        updateEnvFile(result.envUpdates);

        results.push({
          service: serviceConfig.name,
          success: true,
          message: "Refreshed successfully",
         Details: result.envUpdates
            ? Object.entries(result.envUpdates).map(
                ([key, value]) => `${key} updated`
              )
            : [],
        });
      } catch (error) {
        // Check for invalid_grant error (refresh token expired/revoked)
        const isInvalidGrant = 
          error.message?.includes("invalid_grant") ||
          error.message?.includes("invalid_grant:") ||
          error.response?.data?.error === "invalid_grant";
        
        // Check for Withings invalid refresh_token error (treated same as invalid_grant)
        const isInvalidRefreshToken = 
          error.message?.includes("invalid refresh_token") ||
          error.message?.includes("Invalid Params: invalid refresh_token") ||
          error.message?.includes("Invalid refresh_token");
        
        if (isInvalidGrant || isInvalidRefreshToken) {
          results.push({
            service: serviceConfig.name,
            success: false,
            message: "Refresh token expired or revoked",
           Details: [
              "❌ This refresh token is no longer valid and cannot be refreshed.",
              "💡 Run 'yarn tokens:setup' to re-authenticate and get new tokens."
            ],
          });
        } else {
          results.push({
            service: serviceConfig.name,
            success: false,
            message: `Failed: ${error.message}`,
          });
        }
      }
    }

    // Display results
    console.log("\n");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔄 Token Refresh Summary");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    results.forEach((result) => {
      const icon = result.success ? "✅" : "❌";
      console.log(`${icon} ${result.service}: ${result.message}`);

      if (result.details) {
        result.details.forEach((detail) => {
          console.log(`   ${detail}`);
        });
      }
    });

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    showSummary({
      "Tokens Refreshed": successCount,
      Failed: failureCount,
    });

    if (successCount > 0) {
      showSuccess(
        `${successCount} token(s) refreshed successfully! Updated .env file.`
      );
    }

    if (failureCount > 0) {
      const failedServices = results.filter(r => !r.success);
      const needsReauth = failedServices.filter(r => 
        r.message === "Refresh token expired or revoked"
      );
      
      if (needsReauth.length > 0) {
        console.log("\n💡 To fix:");
        console.log("   Run 'yarn tokens:setup' and select the following services to re-authenticate:");
        needsReauth.forEach(r => {
          console.log(`   - ${r.service}`);
        });
        if (needsReauth.length < failedServices.length) {
          console.log("\n   Other failures listed above may need different fixes.");
        }
      } else {
        console.log("\n💡 Tip: Check the error messages above for details.");
        console.log("   If tokens can't be refreshed, try: yarn tokens:setup");
      }
    }

    console.log("\n");

    // In auto mode, exit non-zero if any tokens failed to refresh
    if (autoMode && failureCount > 0) {
      process.exit(1);
    }
  } catch (error) {
    showError("Fatal error", error);
    process.exit(1);
  }
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
