#!/usr/bin/env node
/**
 * Tokens
 * Check all token statuses, then refresh expired OAuth tokens (excluding Google Calendar).
 * For Google Calendar tokens that need refresh, run yarn tokens:setup manually.
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

const GOOGLE_SERVICE_KEYS = ["googlePersonal", "googleWork"];

function isGoogleService(serviceKey) {
  return GOOGLE_SERVICE_KEYS.includes(serviceKey);
}

async function isConfigured(serviceKey) {
  const serviceConfig = tokenConfig.getService(serviceKey);
  const envVars = serviceConfig.envVars;
  for (const key in envVars) {
    const envVarName = envVars[key];
    if (process.env[envVarName]) {
      return true;
    }
  }
  return false;
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
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  }
  fs.writeFileSync(envPath, envContent);
}

async function main() {
  console.log("\n🔑 Brickomations - Tokens (check & refresh)\n");

  try {
    const tokenService = new TokenService();
    const results = [];
    const serviceKeys = tokenConfig.getAllServiceKeys();

    // --- Check phase ---
    for (const serviceKey of serviceKeys) {
      const serviceConfig = tokenConfig.getService(serviceKey);
      showInfo(`Checking ${serviceConfig.name}...`);

      try {
        const status = await tokenService.checkServiceByKey(serviceKey);
        const configured = await isConfigured(serviceKey);
        results.push({
          serviceKey,
          service: serviceConfig.name,
          configured,
          valid: status.valid,
          message: status.message,
          needsRefresh: status.needsRefresh,
        });
      } catch (error) {
        results.push({
          serviceKey,
          service: serviceConfig.name,
          configured: false,
          valid: false,
          message: `Error: ${error.message}`,
          needsRefresh: false,
        });
      }
    }

    // --- Print check summary ---
    console.log("\n");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔑 Token Status Summary");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    results.forEach((result) => {
      const icon = result.valid ? "✅" : result.configured ? "⚠️ " : "❌";
      console.log(`${icon} ${result.service}: ${result.message}`);
      if (result.needsRefresh) {
        console.log(`   Needs refresh`);
      }
    });

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // --- Refresh phase: only non-Google ---
    const refreshableKeys = tokenConfig.getRefreshableServices();
    const needingRefresh = results.filter(
      (r) => refreshableKeys.includes(r.serviceKey) && r.needsRefresh
    );
    const googleNeedingRefresh = needingRefresh.filter((r) =>
      isGoogleService(r.serviceKey)
    );
    const nonGoogleToRefresh = needingRefresh.filter(
      (r) => !isGoogleService(r.serviceKey)
    );

    if (googleNeedingRefresh.length > 0) {
      showInfo(
        "Google Calendar token(s) need attention. Run 'yarn tokens:setup' manually."
      );
      console.log("");
    }

    if (nonGoogleToRefresh.length === 0) {
      if (needingRefresh.length === 0) {
        showSuccess("All tokens are valid - no refresh needed!");
      }
      console.log("\n");
      process.exit(0);
    }

    console.log(
      `Tokens to refresh: ${nonGoogleToRefresh
        .map((r) => r.service)
        .join(", ")}\n`
    );

    const confirmed = await confirmOperation(
      `Ready to refresh ${nonGoogleToRefresh.length} token(s)?`
    );

    if (!confirmed) {
      console.log("\n❌ Operation cancelled\n");
      process.exit(0);
    }

    const refreshResults = [];
    for (const { serviceKey } of nonGoogleToRefresh) {
      const serviceConfig = tokenConfig.getService(serviceKey);
      showInfo(`Refreshing ${serviceConfig.name}...`);

      try {
        const result = await tokenService.refreshServiceByKey(serviceKey);
        updateEnvFile(result.envUpdates);
        refreshResults.push({
          service: serviceConfig.name,
          success: true,
          message: "Refreshed successfully",
          details: result.envUpdates
            ? Object.entries(result.envUpdates).map(
                ([key]) => `${key} updated`
              )
            : [],
        });
      } catch (error) {
        const isInvalidGrant =
          error.message?.includes("invalid_grant") ||
          error.message?.includes("invalid_grant:") ||
          error.response?.data?.error === "invalid_grant";
        const isInvalidRefreshToken =
          error.message?.includes("invalid refresh_token") ||
          error.message?.includes("Invalid Params: invalid refresh_token") ||
          error.message?.includes("Invalid refresh_token");

        if (isInvalidGrant || isInvalidRefreshToken) {
          refreshResults.push({
            service: serviceConfig.name,
            success: false,
            message: "Refresh token expired or revoked",
            details: [
              "❌ This refresh token is no longer valid and cannot be refreshed.",
              "💡 Run 'yarn tokens:setup' to re-authenticate and get new tokens.",
            ],
          });
        } else {
          refreshResults.push({
            service: serviceConfig.name,
            success: false,
            message: `Failed: ${error.message}`,
            details: [],
          });
        }
      }
    }

    // --- Refresh summary ---
    console.log("\n");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔄 Token Refresh Summary");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    refreshResults.forEach((result) => {
      const icon = result.success ? "✅" : "❌";
      console.log(`${icon} ${result.service}: ${result.message}`);
      if (result.details && result.details.length > 0) {
        result.details.forEach((detail) => console.log(`   ${detail}`));
      }
    });

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const successCount = refreshResults.filter((r) => r.success).length;
    const failureCount = refreshResults.filter((r) => !r.success).length;
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
      const failedServices = refreshResults.filter((r) => !r.success);
      const needsReauth = failedServices.filter(
        (r) => r.message === "Refresh token expired or revoked"
      );
      if (needsReauth.length > 0) {
        console.log("\n💡 To fix:");
        console.log(
          "   Run 'yarn tokens:setup' and select the following services to re-authenticate:"
        );
        needsReauth.forEach((r) => console.log(`   - ${r.service}`));
        if (needsReauth.length < failedServices.length) {
          console.log("\n   Other failures listed above may need different fixes.");
        }
      } else {
        console.log("\n💡 Tip: Check the error messages above for details.");
        console.log("   If tokens can't be refreshed, try: yarn tokens:setup");
      }
    }

    console.log("\n");
  } catch (error) {
    showError("Fatal error", error);
    process.exit(1);
  }
}

main().catch((error) => {
  showError("Unhandled error", error);
  process.exit(1);
});
