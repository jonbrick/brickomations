#!/usr/bin/env node
/**
 * Check Tokens
 * Check the status and validity of all API tokens
 */

require("dotenv").config();
const { showSuccess, showError, showInfo } = require("../../src/utils/cli");
const TokenService = require("../../src/services/TokenService");
const tokenConfig = require("../../src/config/tokens");

async function main() {
  console.log("\n🔑 Brickomations - Token Status Checker\n");

  try {
    const tokenService = new TokenService();
    const results = [];

    // Get all service keys and check each one
    const serviceKeys = tokenConfig.getAllServiceKeys();

    for (const serviceKey of serviceKeys) {
      const serviceConfig = tokenConfig.getService(serviceKey);
      showInfo(`Checking ${serviceConfig.name}...`);

      try {
        const status = await tokenService.checkServiceByKey(serviceKey);
        const configured = await isConfigured(serviceKey);

        results.push({
          service: serviceConfig.name,
          configured,
          valid: status.valid,
          message: status.message,
          needsRefresh: status.needsRefresh,
        });
      } catch (error) {
        results.push({
          service: serviceConfig.name,
          configured: false,
          valid: false,
          message: `Error: ${error.message}`,
          needsRefresh: false,
        });
      }
    }

    // Display results
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

    const allValid = results.every((r) => r.valid);
    const someInvalid = results.some((r) => !r.valid && r.configured);

    if (allValid) {
      showSuccess("All tokens are valid and configured correctly!");
    } else if (someInvalid) {
      showInfo(
        "Some tokens need attention. Run 'yarn tokens:refresh' to refresh expired tokens."
      );
    } else {
      showInfo(
        "Some services are not configured. Check your .env file or run 'yarn tokens:setup'."
      );
    }

    console.log("\n");
  } catch (error) {
    showError("Fatal error", error);
    process.exit(1);
  }
}

/**
 * Check if a service is configured
 * @param {string} serviceKey - Service key
 * @returns {Promise<boolean>} True if configured
 */
async function isConfigured(serviceKey) {
  const serviceConfig = tokenConfig.getService(serviceKey);
  const envVars = serviceConfig.envVars;

  // Check if required env vars are set
  for (const key in envVars) {
    const envVarName = envVars[key];
    if (process.env[envVarName]) {
      return true;
    }
  }

  return false;
}

// Run main function
main().catch((error) => {
  showError("Unhandled error", error);
  process.exit(1);
});
