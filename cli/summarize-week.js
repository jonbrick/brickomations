#!/usr/bin/env node

/**
 * Summarize Week CLI
 * Command-line interface for summarizing calendar events and database records into Work and Personal Summary databases
 *
 * Data Sources:
 * Personal Summary:
 * - Google Calendar: Sleep, Drinking Days, Workout, Reading, Coding, Art, Video Games,
 *   Meditation, Music, Body Weight, Personal Calendar, Personal PRs
 * - Notion Database: Personal Tasks (TASKS_DATABASE_ID)
 *
 * Work Summary:
 * - Google Calendar: Work Calendar (meetings, design, coding, critique, whiteboarding,
 *   research, personal, rituals, qa, hiring, workAdmin, marketing), Work PRs
 * - Notion Database: Work Tasks (TASKS_DATABASE_ID, filtered by Category = "💼 Work")
 */

require("dotenv").config();
const inquirer = require("inquirer");
const { selectDateRange, createSpinner, parseDateRangeFromArgv } = require("../src/utils/cli");
const {
  displaySourceData,
  collectSourceData,
} = require("../src/utils/data-display");
const {
  getSummarizer,
  getSummarizerIds,
  getAllSummarizersByBucket,
} = require("../src/summarizers");
const { SUMMARY_GROUPS } = require("../src/config/unified-sources");
const output = require("../src/utils/output");
const {
  formatCalendarSummaryResult,
  formatTaskSummaryResult,
  formatErrors,
} = require("../src/utils/workflow-output");

const dryRun = process.argv.includes("--dry-run");
const autoMode = process.argv.includes("--auto");

const { range: cliDateRange, error: cliDateRangeError } = parseDateRangeFromArgv(process.argv);
if (cliDateRangeError) {
  console.error(cliDateRangeError);
  process.exit(1);
}

/**
 * Select action type (display only or update)
 * @param {Object} sourceTypes - Object indicating which source types are selected
 * @param {boolean} sourceTypes.hasWork - Whether work sources are selected
 * @param {boolean} sourceTypes.hasPersonal - Whether personal sources are selected
 * @returns {Promise<string>} Selected action ("display" or "update")
 */
async function selectAction(
  sourceTypes = { hasWork: false, hasPersonal: false }
) {
  const { hasWork, hasPersonal } = sourceTypes;

  // Generate dynamic prompt message based on selected source types
  let updateMessage;
  if (hasWork && hasPersonal) {
    updateMessage = "Update Work and Personal Summary databases";
  } else if (hasWork) {
    updateMessage = "Update Work Summary database";
  } else if (hasPersonal) {
    updateMessage = "Update Personal Summary database";
  } else {
    updateMessage = "Update Summary database";
  }

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { name: updateMessage, value: "update" },
        { name: "Display only (debug)", value: "display" },
      ],
    },
  ]);

  return action;
}

/**
 * Select which calendars and databases to include in the summary
 * Note: Most sources come from Google Calendar API, except Tasks which come from Notion Database API
 * Merges work and personal recap sources into a single selection list
 * @returns {Promise<string>} Selected calendar/database key
 */
async function selectCalendarsAndDatabases() {
  const availableIds = getSummarizerIds();

  if (availableIds.length === 0) {
    throw new Error(
      "No calendars or databases are configured. Please set calendar IDs or database IDs in your .env file."
    );
  }

  // Map available sources to inquirer choices using SUMMARY_GROUPS for display names
  const availableSources = availableIds
    .map((id) => {
      const group = SUMMARY_GROUPS[id];
      if (!group) return null;
      return {
        name: group.name, // No emoji
        value: id,
        description: `Summarize ${group.name.toLowerCase()}`,
      };
    })
    .filter(Boolean);

  // Sort sources alphabetically by name
  availableSources.sort((a, b) => a.name.localeCompare(b.name));

  // Add "All Sources" option at the top
  const choices = [
    { name: "All Sources (Calendars + Databases)", value: "all" },
    ...availableSources,
  ];

  const { source } = await inquirer.prompt([
    {
      type: "list",
      name: "source",
      message:
        "Select source to summarize (Google Calendar or Notion Database):",
      choices: choices,
      pageSize: choices.length,
    },
  ]);

  return source;
}

/**
 * Process a single week - returns data only, no output
 * @param {number} weekNumber - Week number
 * @param {number} year - Year
 * @param {Object} buckets - Source buckets
 * @param {string[]} buckets.workCalendars - Work calendar source IDs
 * @param {string[]} buckets.workNotionSources - Work Notion source IDs
 * @param {string[]} buckets.personalCalendars - Personal calendar source IDs
 * @param {string[]} buckets.personalNotionSources - Personal Notion source IDs
 * @param {boolean} displayOnly - If true, don't write to Notion
 * @returns {Promise<Object>} Week result with { weekNumber, year, work, personal, success }
 */
async function processWeek(weekNumber, year, buckets, displayOnly) {
  const {
    workCalendars,
    workNotionSources,
    personalCalendars,
    personalNotionSources,
  } = buckets;

  const weekResult = {
    weekNumber,
    year,
    work: null,
    personal: null,
    success: false,
  };

  // Run work workflows
  if (workCalendars.length > 0 || workNotionSources.length > 0) {
    try {
      const workPromises = [];

      if (workCalendars.length > 0) {
        const workflow = getSummarizer(workCalendars[0]).workflow;
        workPromises.push(
          workflow(weekNumber, year, {
            accountType: "work",
            displayOnly,
            calendars: workCalendars,
          })
        );
      }

      if (workNotionSources.length > 0) {
        const workflow = getSummarizer(workNotionSources[0]).workflow;
        workPromises.push(
          workflow(weekNumber, year, {
            displayOnly,
            sources: workNotionSources,
          })
        );
      }

      const workResults = await Promise.all(workPromises);

      // Merge work results
      if (workResults.length === 1) {
        // Single result - tag with source type for formatter detection
        const result = workResults[0];
        if (workCalendars.length > 0) {
          result.sourceType = "calendar";
        } else if (workNotionSources.length > 0) {
          result.sourceType = "tasks";
        }
        weekResult.work = result;
      } else if (workResults.length > 1) {
        // Two results: calendar + task - identify which is which
        const calendarResult = workResults.find(
          (r) => r.selectedCalendars !== undefined
        );
        const taskResult = workResults.find(
          (r) => r.selectedSources !== undefined
        );

        // Tag results with source type
        if (calendarResult) calendarResult.sourceType = "calendar";
        if (taskResult) taskResult.sourceType = "tasks";

        // Combine errors arrays
        const errors = [
          ...(calendarResult?.errors || []),
          ...(taskResult?.errors || []),
        ];
        const fatalErrors = [
          calendarResult?.error,
          taskResult?.error,
        ].filter(Boolean);

        // Merge into combined result (use calendar result as base)
        weekResult.work = {
          ...(calendarResult || taskResult),
          weekNumber,
          year,
          summary: {
            ...(calendarResult?.summary || {}),
            ...(taskResult?.summary || {}),
          },
          updated: (calendarResult?.updated || false) || (taskResult?.updated || false),
          error: fatalErrors.length > 0 ? fatalErrors.join("; ") : null,
          // Preserve task data separately for formatter
          taskData: taskResult?.data,
          taskCounts: taskResult?.counts,
          taskSelectedSources: taskResult?.selectedSources,
          // Combine errors arrays
          errors: errors,
        };
      }
    } catch (error) {
      weekResult.work = {
        weekNumber,
        year,
        summary: null,
        updated: false,
        error: error.message || "Unknown error",
      };
    }
  }

  // Run personal workflows
  if (personalCalendars.length > 0 || personalNotionSources.length > 0) {
    try {
      const personalPromises = [];

      if (personalCalendars.length > 0) {
        const workflow = getSummarizer(personalCalendars[0]).workflow;
        personalPromises.push(
          workflow(weekNumber, year, {
            accountType: "personal",
            displayOnly,
            calendars: personalCalendars,
          })
        );
      }

      if (personalNotionSources.length > 0) {
        const workflow = getSummarizer(personalNotionSources[0]).workflow;
        personalPromises.push(
          workflow(weekNumber, year, {
            displayOnly,
            sources: personalNotionSources,
          })
        );
      }

      const personalResults = await Promise.all(personalPromises);

      // Merge personal results
      if (personalResults.length === 1) {
        // Single result - tag with source type for formatter detection
        const result = personalResults[0];
        if (personalCalendars.length > 0) {
          result.sourceType = "calendar";
        } else if (personalNotionSources.length > 0) {
          result.sourceType = "tasks";
        }
        weekResult.personal = result;
      } else if (personalResults.length > 1) {
        // Two results: calendar + task - identify which is which
        const calendarResult = personalResults.find(
          (r) => r.selectedCalendars !== undefined
        );
        const taskResult = personalResults.find(
          (r) => r.selectedSources !== undefined
        );

        // Tag results with source type
        if (calendarResult) calendarResult.sourceType = "calendar";
        if (taskResult) taskResult.sourceType = "tasks";

        // Combine errors arrays
        const errors = [
          ...(calendarResult?.errors || []),
          ...(taskResult?.errors || []),
        ];
        const fatalErrors = [
          calendarResult?.error,
          taskResult?.error,
        ].filter(Boolean);

        // Merge into combined result (use calendar result as base)
        weekResult.personal = {
          ...(calendarResult || taskResult),
          weekNumber,
          year,
          summary: {
            ...(calendarResult?.summary || {}),
            ...(taskResult?.summary || {}),
          },
          updated: (calendarResult?.updated || false) || (taskResult?.updated || false),
          error: fatalErrors.length > 0 ? fatalErrors.join("; ") : null,
          // Preserve task data separately for formatter
          taskData: taskResult?.data,
          taskCounts: taskResult?.counts,
          taskSelectedSources: taskResult?.selectedSources,
          // Combine errors arrays
          errors: errors,
        };
      }
    } catch (error) {
      weekResult.personal = {
        weekNumber,
        year,
        summary: null,
        updated: false,
        error: error.message || "Unknown error",
      };
    }
  }

  // Determine overall success for this week
  const hasWorkSuccess = weekResult.work && !weekResult.work.error;
  const hasPersonalSuccess = weekResult.personal && !weekResult.personal.error;
  const hasAnySuccess = hasWorkSuccess || hasPersonalSuccess;
  const hasAnySource =
    workCalendars.length > 0 ||
    workNotionSources.length > 0 ||
    personalCalendars.length > 0 ||
    personalNotionSources.length > 0;

  weekResult.success = hasAnySource && hasAnySuccess;

  return weekResult;
}

/**
 * Main CLI function
 */
async function main() {
  try {
    output.header("Summary Generation");
    console.log(
      "Summarizes data from Google Calendar events and Notion database records\n"
    );

    // Get all summarizers organized by bucket
    const buckets = getAllSummarizersByBucket();
    const {
      personalCalendars: allPersonalCalendars,
      personalTasks: allPersonalTasks,
      workCalendars: allWorkCalendars,
      workTasks: allWorkTasks,
    } = buckets;

    let personalCalendars = [];
    let personalNotionSources = [];
    let workCalendars = [];
    let workNotionSources = [];
    let displayOnly;
    let weeks;

    if (autoMode) {
      // Auto mode: all sources, update.
      // Default: current week + previous 3 weeks.
      // --date/--from/--to override → iterate the unique weeks the range covers
      // (deduped by the helper, so a multi-day range within one week summarizes once).
      personalCalendars = allPersonalCalendars;
      personalNotionSources = allPersonalTasks;
      workCalendars = allWorkCalendars;
      workNotionSources = allWorkTasks;
      displayOnly = false;

      if (cliDateRange) {
        weeks = cliDateRange.weeks;
        const weekDesc = weeks.map((w) => `W${w.weekNumber}/${w.year}`).join(", ");
        console.log(`Auto mode: all sources, ${weekDesc}\n`);
      } else {
        const { getWeekNumber } = require("../src/utils/date");
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentWeek = getWeekNumber(today, currentYear);

        weeks = [];
        for (let i = 3; i >= 0; i--) {
          let wk = currentWeek - i;
          let yr = currentYear;
          if (wk < 1) {
            yr--;
            wk += 52;
          }
          weeks.push({ weekNumber: wk, year: yr });
        }

        const weekRange = weeks.map((w) => `W${w.weekNumber}`).join(", ");
        console.log(`Auto mode: all sources, ${weekRange} (${currentYear})\n`);
      }
    } else {
      // Interactive mode: select source, action, and weeks
      const selectedSource = await selectCalendarsAndDatabases();

      if (selectedSource === "all") {
        personalCalendars = allPersonalCalendars;
        personalNotionSources = allPersonalTasks;
        workCalendars = allWorkCalendars;
        workNotionSources = allWorkTasks;
      } else {
        const summarizer = getSummarizer(selectedSource);
        if (!summarizer) {
          throw new Error(`Unknown source: ${selectedSource}`);
        }
        if (summarizer.recapType === "personal") {
          if (summarizer.sourceOrigin === "calendar") {
            personalCalendars = [selectedSource];
          } else {
            personalNotionSources = [selectedSource];
          }
        } else {
          if (summarizer.sourceOrigin === "calendar") {
            workCalendars = [selectedSource];
          } else {
            workNotionSources = [selectedSource];
          }
        }
      }

      const sourceTypes = {
        hasWork: workCalendars.length > 0 || workNotionSources.length > 0,
        hasPersonal:
          personalCalendars.length > 0 || personalNotionSources.length > 0,
      };

      const action = dryRun ? "display" : await selectAction(sourceTypes);
      displayOnly = action === "display";
      if (dryRun) {
        console.log("ℹ️ Dry run: results will not be saved to Notion\n");
      }

      // --from/--to passed without --auto: honor the flags, skip the prompt.
      if (cliDateRange) {
        weeks = cliDateRange.weeks;
        const weekDesc = weeks.map((w) => `W${w.weekNumber}/${w.year}`).join(", ");
        console.log(`Weeks from flags: ${weekDesc}\n`);
      } else {
        const dateResult = await selectDateRange({ minGranularity: "week" });
        weeks = dateResult.weeks;
        if (dateResult.displayText) console.log(dateResult.displayText);
      }
    }

    if (displayOnly && !dryRun) {
      console.log("ℹ️ Display mode: Results will not be saved to Notion\n");
    }

    // Process each week
    const weekResults = [];
    let workSuccessCount = 0;
    let workFailureCount = 0;
    let personalSuccessCount = 0;
    let personalFailureCount = 0;

    for (let i = 0; i < weeks.length; i++) {
      const { weekNumber, year } = weeks[i];

      // Phase indicator
      output.phase(i + 1, weeks.length, `Week ${weekNumber}, ${year}`);

      const buckets = {
        workCalendars,
        workNotionSources,
        personalCalendars,
        personalNotionSources,
      };

      const spinner = createSpinner(`Processing Week ${weekNumber}, ${year}...`);
      spinner.start();
      let weekResult;
      try {
        weekResult = await processWeek(
          weekNumber,
          year,
          buckets,
          displayOnly
        );
      } finally {
        spinner.stop();
      }
      weekResults.push(weekResult);

      // Debug logging - check summary immediately after processWeek
      if (process.env.DEBUG || displayOnly) {
        console.log(`\n[DEBUG cli] After processWeek - Week ${weekNumber}, ${year}`);
        if (weekResult.work) {
          console.log(`[DEBUG cli] weekResult.work.summary exists:`, !!weekResult.work.summary);
          console.log(`[DEBUG cli] weekResult.work.summary keys:`, weekResult.work.summary ? Object.keys(weekResult.work.summary) : 'N/A');
          console.log(`[DEBUG cli] weekResult.work.summary count:`, weekResult.work.summary ? Object.keys(weekResult.work.summary).length : 0);
        } else {
          console.log(`[DEBUG cli] weekResult.work: null`);
        }
        if (weekResult.personal) {
          console.log(`[DEBUG cli] weekResult.personal.summary exists:`, !!weekResult.personal.summary);
          console.log(`[DEBUG cli] weekResult.personal.summary keys:`, weekResult.personal.summary ? Object.keys(weekResult.personal.summary) : 'N/A');
          console.log(`[DEBUG cli] weekResult.personal.summary count:`, weekResult.personal.summary ? Object.keys(weekResult.personal.summary).length : 0);
        } else {
          console.log(`[DEBUG cli] weekResult.personal: null`);
        }
      }

      // Update counts
      if (weekResult.work) {
        if (weekResult.work.error) {
          workFailureCount++;
        } else {
          workSuccessCount++;
        }
      }
      if (weekResult.personal) {
        if (weekResult.personal.error) {
          personalFailureCount++;
        } else {
          personalSuccessCount++;
        }
      }

      // Show inline result - format and display using formatters
      if (!displayOnly) {
        // Update mode: Show formatted success output
        if (weekResult.work && !weekResult.work.error) {
          // Format calendar result if present
          if (weekResult.work.sourceType === "calendar" || weekResult.work.selectedCalendars) {
            const calendarFormatted = formatCalendarSummaryResult(weekResult.work, "work");
            console.log(`✅ Work Calendar:`);
            calendarFormatted.successLines.forEach((line) => console.log(line));
            if (calendarFormatted.warnings.length > 0) {
              calendarFormatted.warnings.forEach((w) => console.log(w));
            }
          }
          // Format task result if present
          if (weekResult.work.taskData || weekResult.work.sourceType === "tasks") {
            const taskResult = weekResult.work.taskData
              ? {
                  weekNumber: weekResult.work.weekNumber,
                  year: weekResult.work.year,
                  data: weekResult.work.taskData,
                  counts: weekResult.work.taskCounts,
                  selectedSources: weekResult.work.taskSelectedSources,
                  errors: [],
                }
              : weekResult.work;
            const taskFormatted = formatTaskSummaryResult(taskResult, "work");
            console.log(`✅ Work Tasks:`);
            taskFormatted.successLines.forEach((line) => console.log(line));
            if (taskFormatted.warnings.length > 0) {
              taskFormatted.warnings.forEach((w) => console.log(w));
            }
          }
          // Show combined warnings if any
          if (weekResult.work.errors?.length > 0) {
            formatErrors(weekResult.work.errors).forEach((w) => console.log(w));
          }
        } else if (weekResult.work && weekResult.work.error) {
          console.log(`❌ Work: ${weekResult.work.error}`);
        }

        if (weekResult.personal && !weekResult.personal.error) {
          // Format calendar result if present
          if (weekResult.personal.sourceType === "calendar" || weekResult.personal.selectedCalendars) {
            const calendarFormatted = formatCalendarSummaryResult(weekResult.personal, "personal");
            console.log(`✅ Personal Calendar:`);
            calendarFormatted.successLines.forEach((line) => console.log(line));
            if (calendarFormatted.warnings.length > 0) {
              calendarFormatted.warnings.forEach((w) => console.log(w));
            }
          }
          // Format task result if present
          if (weekResult.personal.taskData || weekResult.personal.sourceType === "tasks") {
            const taskResult = weekResult.personal.taskData
              ? {
                  weekNumber: weekResult.personal.weekNumber,
                  year: weekResult.personal.year,
                  data: weekResult.personal.taskData,
                  counts: weekResult.personal.taskCounts,
                  selectedSources: weekResult.personal.taskSelectedSources,
                  errors: [],
                }
              : weekResult.personal;
            const taskFormatted = formatTaskSummaryResult(taskResult, "personal");
            console.log(`✅ Personal Tasks:`);
            taskFormatted.successLines.forEach((line) => console.log(line));
            if (taskFormatted.warnings.length > 0) {
              taskFormatted.warnings.forEach((w) => console.log(w));
            }
          }
          // Show combined warnings if any
          if (weekResult.personal.errors?.length > 0) {
            formatErrors(weekResult.personal.errors).forEach((w) => console.log(w));
          }
        } else if (weekResult.personal && weekResult.personal.error) {
          console.log(`❌ Personal: ${weekResult.personal.error}`);
        }
        console.log(); // Add spacing
      } else {
        // Display mode: Show simple status (detailed output shown later)
        const statuses = [];
        if (weekResult.work) {
          if (weekResult.work.error) {
            statuses.push(`❌ Work: ${weekResult.work.error}`);
          }
        }
        if (weekResult.personal) {
          if (weekResult.personal.error) {
            statuses.push(`❌ Personal: ${weekResult.personal.error}`);
          }
        }
        if (statuses.length > 0) {
          console.log(statuses.join(" | ") + "\n");
        }
      }
    }

    // Display mode: Show detailed results
    if (displayOnly) {
      output.header("DETAILED RESULTS");

      for (const weekResult of weekResults) {
        const { weekNumber, year } = weekResult;

        // Display work results
        if (weekResult.work) {
          if (weekResult.work.summary) {
            // Debug logging - check summary before displaySourceData
            if (process.env.DEBUG || displayOnly) {
              console.log(`\n[DEBUG cli] Before displaySourceData (work) - Week ${weekNumber}, ${year}`);
              console.log(`[DEBUG cli] weekResult.work keys:`, Object.keys(weekResult.work));
              console.log(`[DEBUG cli] weekResult.work.summary keys:`, Object.keys(weekResult.work.summary || {}));
              console.log(`[DEBUG cli] weekResult.work.summary count:`, Object.keys(weekResult.work.summary || {}).length);
              const summarySample = {};
              const summaryKeys = Object.keys(weekResult.work.summary || {});
              summaryKeys.slice(0, 5).forEach(key => {
                summarySample[key] = weekResult.work.summary[key];
              });
              console.log(`[DEBUG cli] weekResult.work.summary sample (first 5):`, JSON.stringify(summarySample, null, 2));
            }
            output.sectionHeader(`Work Summary - Week ${weekNumber}, ${year}`);
            displaySourceData(weekResult.work, "all");
            if (weekResult.work.error) {
              console.log(`⚠️ Warning: ${weekResult.work.error}\n`);
            }
            // Display warnings from errors array
            if (weekResult.work.errors?.length > 0) {
              formatErrors(weekResult.work.errors).forEach((w) => console.log(w));
              console.log(); // Add spacing
            }
          } else if (weekResult.work.error) {
            console.log(`❌ Work Summary error: ${weekResult.work.error}\n`);
          }
        }

        // Display personal results
        if (weekResult.personal) {
          if (weekResult.personal.summary) {
            // Debug logging - check summary before displaySourceData
            if (process.env.DEBUG || displayOnly) {
              console.log(`\n[DEBUG cli] Before displaySourceData (personal) - Week ${weekNumber}, ${year}`);
              console.log(`[DEBUG cli] weekResult.personal keys:`, Object.keys(weekResult.personal));
              console.log(`[DEBUG cli] weekResult.personal.summary keys:`, Object.keys(weekResult.personal.summary || {}));
              console.log(`[DEBUG cli] weekResult.personal.summary count:`, Object.keys(weekResult.personal.summary || {}).length);
              const summarySample = {};
              const summaryKeys = Object.keys(weekResult.personal.summary || {});
              summaryKeys.slice(0, 5).forEach(key => {
                summarySample[key] = weekResult.personal.summary[key];
              });
              console.log(`[DEBUG cli] weekResult.personal.summary sample (first 5):`, JSON.stringify(summarySample, null, 2));
            }
            output.sectionHeader(
              `Personal Summary - Week ${weekNumber}, ${year}`
            );
            displaySourceData(weekResult.personal, "all");
            if (weekResult.personal.error) {
              console.log(`⚠️ Warning: ${weekResult.personal.error}\n`);
            }
            // Display warnings from errors array
            if (weekResult.personal.errors?.length > 0) {
              formatErrors(weekResult.personal.errors).forEach((w) => console.log(w));
              console.log(); // Add spacing
            }
          } else if (weekResult.personal.error) {
            console.log(
              `❌ Personal Summary error: ${weekResult.personal.error}\n`
            );
          }
        }

        // Show error if no results at all
        if (!weekResult.work && !weekResult.personal) {
          console.log(`❌ Week ${weekNumber}, ${year}: No sources processed\n`);
        }
      }
    }

    // Update mode: Show any remaining errors that weren't displayed inline
    if (!displayOnly) {
      for (const weekResult of weekResults) {
        const { weekNumber, year } = weekResult;

        // Show fatal errors that prevented updates
        if (
          weekResult.work &&
          weekResult.work.error &&
          !weekResult.work.updated
        ) {
          console.log(
            `❌ Work Summary Week ${weekNumber}, ${year}: ${weekResult.work.error}`
          );
        }

        if (
          weekResult.personal &&
          weekResult.personal.error &&
          !weekResult.personal.updated
        ) {
          console.log(
            `❌ Personal Summary Week ${weekNumber}, ${year}: ${weekResult.personal.error}`
          );
        }
      }
    }

    // Final summary
    console.log(output.divider());

    const totalSuccess = workSuccessCount + personalSuccessCount;
    const totalFailure = workFailureCount + personalFailureCount;

    if (totalFailure === 0 && totalSuccess > 0) {
      const parts = [];
      if (workSuccessCount > 0) {
        parts.push(
          `${workSuccessCount} work week${workSuccessCount !== 1 ? "s" : ""}`
        );
      }
      if (personalSuccessCount > 0) {
        parts.push(
          `${personalSuccessCount} personal week${
            personalSuccessCount !== 1 ? "s" : ""
          }`
        );
      }
      output.done(`${parts.join(" and ")} completed successfully`);
    } else if (totalSuccess > 0 && totalFailure > 0) {
      const successParts = [];
      const failureParts = [];
      if (workSuccessCount > 0) {
        successParts.push(
          `${workSuccessCount} work week${workSuccessCount !== 1 ? "s" : ""}`
        );
      }
      if (personalSuccessCount > 0) {
        successParts.push(
          `${personalSuccessCount} personal week${
            personalSuccessCount !== 1 ? "s" : ""
          }`
        );
      }
      if (workFailureCount > 0) {
        failureParts.push(
          `${workFailureCount} work week${workFailureCount !== 1 ? "s" : ""}`
        );
      }
      if (personalFailureCount > 0) {
        failureParts.push(
          `${personalFailureCount} personal week${
            personalFailureCount !== 1 ? "s" : ""
          }`
        );
      }
      console.log(
        `⚠️ ${successParts.join(
          " and "
        )} completed successfully, ${failureParts.join(" and ")} failed.`
      );
      process.exit(1);
    } else if (totalFailure > 0 && totalSuccess === 0) {
      console.log(
        `❌ All ${totalFailure} week${totalFailure !== 1 ? "s" : ""} failed.`
      );
      process.exit(1);
    } else {
      console.log("ℹ️ No sources were processed");
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main };
