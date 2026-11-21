/**
 * CLI Utilities
 * Standardized CLI interactions and user prompts
 */

const inquirer = require("inquirer");
const {
  formatDate,
  formatDateLong,
  parseDate,
  getToday,
  getYesterday,
  parseWeekNumber,
  getWeekNumber,
  getWeekStart,
  getWeekEnd,
  getMonthStart,
  getMonthEnd,
  getDaysInMonth,
  daysDifference,
} = require("./date");
const {
  deriveWeeksFromDateRange,
  formatWeekDisplay,
  getWeeksForMonthFromNotion,
} = require("./date-pickers");

/** Month choices for list prompts (1 = January .. 12 = December) */
const MONTH_CHOICES = [
  { name: "January", value: 1 },
  { name: "February", value: 2 },
  { name: "March", value: 3 },
  { name: "April", value: 4 },
  { name: "May", value: 5 },
  { name: "June", value: 6 },
  { name: "July", value: 7 },
  { name: "August", value: 8 },
  { name: "September", value: 9 },
  { name: "October", value: 10 },
  { name: "November", value: 11 },
  { name: "December", value: 12 },
];

/**
 * Inquirer question config for year input (2000-2100)
 * @param {number} currentYear - Default year value
 * @returns {Object} Inquirer question object
 */
function getYearPromptConfig(currentYear) {
  return {
    type: "input",
    name: "year",
    message: "Year:",
    default: currentYear.toString(),
    validate: (input) => {
      const yearNum = parseInt(input);
      if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
        return "Please enter a valid year (2000-2100)";
      }
      return true;
    },
  };
}

/**
 * Universal date range selector with context-aware options
 * Subtractive design: all options by default, filtered by minGranularity
 *
 * @param {Object} options - Configuration options
 * @param {string} options.minGranularity - "day" (default) | "week" | "month" - minimum selection unit
 * @param {boolean} options.allowFuture - Allow future dates (default: true)
 * @returns {Promise<{startDate: Date, endDate: Date, weeks?: Array, months?: Array, displayText?: string}>} Selected date range with optional weeks/months metadata and display text
 */
async function selectDateRange(options = {}) {
  const { minGranularity = "day", allowFuture = true } = options;

  // Build choices based on granularity (order: weeks, months, days)
  const allChoices = [];

  if (minGranularity === "day" || minGranularity === "week") {
    // Week-level options
    allChoices.push(
      { name: "This week (Sun-Sat)", value: "week" },
      { name: "Last week (Sun-Sat)", value: "lastWeek" },
      { name: "Week Picker", value: "singleWeek" },
      { name: "Week Range (start to end)", value: "weekRange" },
    );

    allChoices.push(new inquirer.Separator());
  }

  if (
    minGranularity === "day" ||
    minGranularity === "week" ||
    minGranularity === "month"
  ) {
    // Month-level options
    allChoices.push(
      { name: "This Month", value: "thisMonth" },
      { name: "Last Month", value: "lastMonth" },
      { name: "Month Picker (all weeks in month)", value: "monthPicker" },
      { name: "Month Range (start to end)", value: "monthRange" },
    );

    allChoices.push(new inquirer.Separator());
  }

  if (minGranularity === "day") {
    // Day-level options
    allChoices.push(
      { name: "Today", value: "today" },
      { name: "Yesterday", value: "yesterday" },
      { name: "Last 30 days", value: "last30" },
      { name: "Day Picker", value: "dayPicker" },
      { name: "Day Range", value: "custom" },
      { name: "+/- 3 days", value: "plusMinus3" },
      new inquirer.Separator(),
    );
  }

  const { rangeType } = await inquirer.prompt([
    {
      type: "list",
      name: "rangeType",
      message: "Select date range:",
      choices: allChoices,
      pageSize: 20, // Show all options without scrolling
    },
  ]);

  let startDate, endDate, weeks, months, displayText;

  // Handle each selection type
  switch (rangeType) {
    case "today":
      startDate = getToday();
      endDate = getToday();
      endDate.setHours(23, 59, 59, 999);
      break;

    case "yesterday":
      startDate = getYesterday();
      endDate = getYesterday();
      endDate.setHours(23, 59, 59, 999);
      break;

    case "last30": {
      startDate = new Date(getToday());
      startDate.setDate(startDate.getDate() - 29); // 29 days ago
      endDate = getToday();
      endDate.setHours(23, 59, 59, 999);
      break;
    }

    case "plusMinus3": {
      const today = getToday();
      startDate = new Date(today);
      startDate.setDate(today.getDate() - 3);
      endDate = new Date(today);
      endDate.setDate(today.getDate() + 3);
      endDate.setHours(23, 59, 59, 999);
      displayText = `\n✅ Selected: ${formatDateLong(startDate)} to ${formatDateLong(endDate)} (7 days)\n`;
      break;
    }

    case "dayPicker": {
      const today = getToday();
      const defaultDate = formatDate(today);

      const answers = await inquirer.prompt([
        {
          type: "input",
          name: "date",
          message: "Date (YYYY-MM-DD):",
          default: defaultDate,
          validate: (input) => {
            try {
              parseDate(input);
              return true;
            } catch (e) {
              return "Invalid date format";
            }
          },
        },
      ]);

      startDate = parseDate(answers.date);
      endDate = new Date(startDate);
      endDate.setHours(23, 59, 59, 999);

      displayText = `\n📅 Selected: ${formatDateLong(startDate)}\n`;
      break;
    }

    case "thisMonth": {
      const currentDate = getToday();
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1; // 1-12

      const { weeks: notionWeeks, warning } = await getWeeksForMonthFromNotion(
        year,
        month,
      );

      const monthName = new Date(year, month - 1, 1).toLocaleString("default", {
        month: "long",
      });
      startDate = getMonthStart(new Date(year, month - 1, 1));
      endDate = getMonthEnd(new Date(year, month - 1, 1));

      months = [{ month, year, weeks: notionWeeks, startDate, endDate }];
      weeks = notionWeeks;
      displayText = warning
        ? `⚠️  ${warning}\n${buildMonthDisplayText(
            monthName,
            year,
            notionWeeks,
          )}`
        : buildMonthDisplayText(monthName, year, notionWeeks);
      break;
    }

    case "lastMonth": {
      const currentDate = getToday();
      let year = currentDate.getFullYear();
      let month = currentDate.getMonth(); // 0-11, so current month

      // Handle January → December year rollback
      if (month === 0) {
        month = 12;
        year -= 1;
      }

      const { weeks: notionWeeks, warning } = await getWeeksForMonthFromNotion(
        year,
        month,
      );

      const monthName = new Date(year, month - 1, 1).toLocaleString("default", {
        month: "long",
      });
      startDate = getMonthStart(new Date(year, month - 1, 1));
      endDate = getMonthEnd(new Date(year, month - 1, 1));

      months = [{ month, year, weeks: notionWeeks, startDate, endDate }];
      weeks = notionWeeks;
      displayText = warning
        ? `⚠️  ${warning}\n${buildMonthDisplayText(
            monthName,
            year,
            notionWeeks,
          )}`
        : buildMonthDisplayText(monthName, year, notionWeeks);
      break;
    }

    case "week": {
      const today = getToday();
      startDate = getWeekStart(today); // Sunday 00:00:00
      endDate = getWeekEnd(today); // Saturday 23:59:59

      // Also return week metadata
      const weekNumber = getWeekNumber(today, today.getFullYear());
      weeks = [
        {
          weekNumber,
          year: today.getFullYear(),
          startDate,
          endDate,
        },
      ];

      displayText = `\n✅ Selected: ${formatWeekDisplay(weeks[0])}\n`;
      break;
    }

    case "lastWeek": {
      const today = getToday();
      // Get date from last week
      const lastWeekDate = new Date(today);
      lastWeekDate.setDate(today.getDate() - 7);

      startDate = getWeekStart(lastWeekDate); // Sunday 00:00:00
      endDate = getWeekEnd(lastWeekDate); // Saturday 23:59:59

      // Also return week metadata
      const weekNumber = getWeekNumber(
        lastWeekDate,
        lastWeekDate.getFullYear(),
      );
      weeks = [
        {
          weekNumber,
          year: lastWeekDate.getFullYear(),
          startDate,
          endDate,
        },
      ];

      displayText = `\n✅ Selected: ${formatWeekDisplay(weeks[0])}\n`;
      break;
    }

    case "singleWeek": {
      const currentDate = getToday();
      const currentYear = currentDate.getFullYear();

      const answers = await inquirer.prompt([
        getYearPromptConfig(currentYear),
        {
          type: "input",
          name: "weekNumber",
          message: "Week number (1-53):",
          validate: (input) => {
            const weekNum = parseInt(input);
            if (isNaN(weekNum) || weekNum < 1 || weekNum > 53) {
              return "Please enter a valid week number (1-53)";
            }
            return true;
          },
        },
      ]);

      const weekNumber = parseInt(answers.weekNumber);
      const year = parseInt(answers.year);

      const { startDate: wkStart, endDate: wkEnd } = parseWeekNumber(
        weekNumber,
        year,
      );
      startDate = wkStart;
      endDate = wkEnd;

      weeks = [{ weekNumber, year, startDate, endDate }];

      displayText = `\n✅ Selected: ${formatWeekDisplay(weeks[0])}\n`;
      break;
    }

    case "weekRange": {
      const currentDate = getToday();
      const currentYear = currentDate.getFullYear();

      const answers = await inquirer.prompt([
        getYearPromptConfig(currentYear),
        {
          type: "input",
          name: "startWeek",
          message: "Start week number (1-53):",
          validate: (input) => {
            const weekNum = parseInt(input);
            if (isNaN(weekNum) || weekNum < 1 || weekNum > 53) {
              return "Please enter a valid week number (1-53)";
            }
            return true;
          },
        },
        {
          type: "input",
          name: "endWeek",
          message: "End week number (1-53):",
          validate: (input) => {
            const weekNum = parseInt(input);
            if (isNaN(weekNum) || weekNum < 1 || weekNum > 53) {
              return "Please enter a valid week number (1-53)";
            }
            return true;
          },
        },
      ]);

      const year = parseInt(answers.year);
      let startWeek = parseInt(answers.startWeek);
      let endWeek = parseInt(answers.endWeek);

      let warningText = "";
      if (startWeek > endWeek) {
        warningText = "⚠️  Start week is after end week, swapping...\n";
        [startWeek, endWeek] = [endWeek, startWeek];
      }

      const weekNumbers = [];
      for (let weekNum = startWeek; weekNum <= endWeek; weekNum++) {
        weekNumbers.push(weekNum);
      }

      weeks = weekNumbers.map((wn) => {
        const { startDate: wkStart, endDate: wkEnd } = parseWeekNumber(
          wn,
          year,
        );
        return { weekNumber: wn, year, startDate: wkStart, endDate: wkEnd };
      });

      const allStartDates = weeks.map((w) => w.startDate);
      const allEndDates = weeks.map((w) => w.endDate);
      startDate = new Date(Math.min(...allStartDates.map((d) => d.getTime())));
      endDate = new Date(Math.max(...allEndDates.map((d) => d.getTime())));

      const weekLines = weeks
        .map((week) => `   ${formatWeekDisplay(week)}`)
        .join("\n");
      displayText = `${warningText}\n✅ Selected: Weeks ${weekNumbers[0]}-${
        weekNumbers[weekNumbers.length - 1]
      }, ${year} (${weekNumbers.length} weeks)\n\n${weekLines}\n`;
      break;
    }

    case "monthPicker": {
      const {
        month,
        year,
        weeks: selectedWeeks,
        warning,
        displayText: monthDisplayText,
      } = await selectMonthForWeeks();

      // Calculate month boundaries
      const monthStart = getMonthStart(new Date(year, month - 1, 1));
      const monthEnd = getMonthEnd(new Date(year, month - 1, 1));

      // Return as months array for consistency
      months = [
        {
          month,
          year,
          weeks: selectedWeeks,
          startDate: monthStart,
          endDate: monthEnd,
        },
      ];

      // Set weeks for week granularity mode
      weeks = selectedWeeks;

      // Calculate combined date range
      startDate = monthStart;
      endDate = monthEnd;

      // Use displayText from selectMonthForWeeks, prepend warning if present
      displayText = warning
        ? `⚠️  ${warning}\n${monthDisplayText}`
        : monthDisplayText;
      break;
    }

    case "monthRange": {
      const currentDate = getToday();
      const currentYear = currentDate.getFullYear();

      const answers = await inquirer.prompt([
        getYearPromptConfig(currentYear),
        {
          type: "list",
          name: "startMonth",
          message: "Start month:",
          choices: MONTH_CHOICES,
          pageSize: 12,
        },
        {
          type: "list",
          name: "endMonth",
          message: "End month:",
          choices: MONTH_CHOICES,
          pageSize: 12,
        },
      ]);

      const year = parseInt(answers.year);
      let startMonth = answers.startMonth;
      let endMonth = answers.endMonth;

      let warningText = "";
      if (startMonth > endMonth) {
        warningText = "⚠️  Start month is after end month, swapping...\n";
        [startMonth, endMonth] = [endMonth, startMonth];
      }

      months = [];
      for (let loopMonth = startMonth; loopMonth <= endMonth; loopMonth++) {
        const { weeks: notionWeeks, warning } =
          await getWeeksForMonthFromNotion(year, loopMonth);

        const monthStart = getMonthStart(new Date(year, loopMonth - 1, 1));
        const monthEnd = getMonthEnd(new Date(year, loopMonth - 1, 1));

        months.push({
          month: loopMonth,
          year,
          weeks: notionWeeks,
          startDate: monthStart,
          endDate: monthEnd,
        });
      }

      // Flatten all weeks from all months into single array
      weeks = months.flatMap((m) => m.weeks);

      // Calculate overall date range
      const allStartDates = months.map((m) => m.startDate);
      const allEndDates = months.map((m) => m.endDate);
      startDate = new Date(Math.min(...allStartDates.map((d) => d.getTime())));
      endDate = new Date(Math.max(...allEndDates.map((d) => d.getTime())));

      // Build display text
      const firstMonthName = new Date(year, startMonth - 1, 1).toLocaleString(
        "default",
        { month: "long" },
      );
      const lastMonthName = new Date(year, endMonth - 1, 1).toLocaleString(
        "default",
        { month: "long" },
      );
      const monthLines = months
        .map((m) => {
          const monthName = new Date(m.year, m.month - 1, 1).toLocaleString(
            "default",
            { month: "long" },
          );
          return `   ${monthName} ${m.year} (${m.weeks.length} weeks)`;
        })
        .join("\n");

      displayText = `${warningText}\n✅ Selected: ${firstMonthName} - ${lastMonthName} ${year} (${months.length} months)\n\n${monthLines}\n`;
      break;
    }

    case "custom": {
      const currentDate = getToday();
      const currentYear = currentDate.getFullYear();

      let answers;
      let startDateVal;
      let endDateVal;
      do {
        answers = await inquirer.prompt([
          getYearPromptConfig(currentYear),
          {
            type: "list",
            name: "startMonth",
            message: "Start month:",
            choices: MONTH_CHOICES,
            pageSize: 12,
          },
          {
            type: "input",
            name: "startDay",
            message: "Start day:",
            validate: (input, answers) => {
              const day = parseInt(input, 10);
              const max = getDaysInMonth(
                parseInt(answers.year, 10),
                answers.startMonth,
              );
              if (isNaN(day) || day < 1 || day > max) {
                return `Please enter a day between 1 and ${max}`;
              }
              return true;
            },
          },
          {
            type: "list",
            name: "endMonth",
            message: "End month:",
            choices: (answers) =>
              MONTH_CHOICES.filter((m) => m.value >= answers.startMonth),
            default: 0,
            pageSize: 12,
          },
          {
            type: "input",
            name: "endDay",
            message: "End day:",
            validate: (input, answers) => {
              const day = parseInt(input, 10);
              const max = getDaysInMonth(
                parseInt(answers.year, 10),
                answers.endMonth,
              );
              if (isNaN(day) || day < 1 || day > max) {
                return `Please enter a day between 1 and ${max}`;
              }
              return true;
            },
          },
        ]);

        const year = parseInt(answers.year, 10);
        const startDay = parseInt(answers.startDay, 10);
        const endDay = parseInt(answers.endDay, 10);
        startDateVal = new Date(year, answers.startMonth - 1, startDay);
        endDateVal = new Date(year, answers.endMonth - 1, endDay);

        if (endDateVal < startDateVal) {
          console.log("End date cannot be before start date.");
        }
      } while (endDateVal < startDateVal);

      startDate = startDateVal;
      endDate = endDateVal;
      endDate.setHours(23, 59, 59, 999);

      const dayCount = daysDifference(startDate, endDate) + 1;
      displayText = `\n✅ Selected: ${formatDateLong(
        startDate,
      )} to ${formatDateLong(endDate)} (${dayCount} days)\n`;
      break;
    }
  }

  // If week granularity and no weeks array yet, derive it from date range
  if (minGranularity === "week" && !weeks) {
    weeks = deriveWeeksFromDateRange(startDate, endDate);
  }

  // If month granularity and no months array yet, create from date range
  if (minGranularity === "month" && !months) {
    // This shouldn't happen if all month cases are handled, but add as safety
    months = [];
  }

  return { startDate, endDate, weeks, months, displayText };
}

/**
 * Build formatted month display text
 * Helper function to format month selection display
 *
 * @param {string} monthName - Month name (e.g., "March")
 * @param {number} year - Year
 * @param {Array} weeks - Array of week objects
 * @returns {string} Formatted display text
 */
function buildMonthDisplayText(monthName, year, weeks) {
  const weekLines = weeks
    .map((week) => `   ${formatWeekDisplay(week)}`)
    .join("\n");
  return `\n✅ Selected: ${monthName} ${year}\n   Includes ${weeks.length} weeks:\n\n${weekLines}\n`;
}

/**
 * Month picker - select all weeks within a calendar month
 *
 * @returns {Promise<{month: number, year: number, weeks: Array<{weekNumber: number, year: number, startDate: Date, endDate: Date}>, warning: string|null, displayText: string}>}
 */
async function selectMonthForWeeks() {
  const currentDate = getToday();
  const currentYear = currentDate.getFullYear();

  const answers = await inquirer.prompt([
    getYearPromptConfig(currentYear),
    {
      type: "list",
      name: "month",
      message: "Month:",
      choices: MONTH_CHOICES,
      pageSize: 12,
    },
  ]);

  const year = parseInt(answers.year);
  const month = answers.month;

  const { weeks: notionWeeks, warning } = await getWeeksForMonthFromNotion(
    year,
    month,
  );

  const monthName = new Date(year, month - 1, 1).toLocaleString("default", {
    month: "long",
  });

  return {
    month,
    year,
    weeks: notionWeeks,
    warning,
    displayText: buildMonthDisplayText(monthName, year, notionWeeks),
  };
}

/**
 * Select data sources to process
 *
 * @param {string[]} availableSources - List of available source names
 * @returns {Promise<string[]>} Selected sources
 */
async function selectSources(availableSources) {
  const { sources } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "sources",
      message: "Select data sources to process:",
      choices: [
        { name: "All Sources", value: "all" },
        new inquirer.Separator(),
        ...availableSources.map((source) => ({
          name: source,
          value: source.toLowerCase(),
        })),
      ],
      pageSize: 20, // Show all sources without scrolling
      validate: (answer) => {
        if (answer.length === 0) {
          return "You must select at least one source";
        }
        return true;
      },
    },
  ]);

  // If "all" is selected, return all available sources
  if (sources.includes("all")) {
    return availableSources.map((s) => s.toLowerCase());
  }

  return sources;
}

/**
 * Confirm operation before proceeding
 *
 * @param {string} message - Confirmation message
 * @param {boolean} defaultValue - Default answer
 * @returns {Promise<boolean>} User confirmation
 */
async function confirmOperation(
  message = "Proceed with operation?",
  defaultValue = true,
) {
  const { confirmed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message,
      default: defaultValue,
    },
  ]);

  return confirmed;
}

/**
 * Show progress indicator
 *
 * @param {string} message - Progress message
 * @param {string} emoji - Optional emoji prefix
 */
function showProgress(message, emoji = "⏳") {
  console.log(`${emoji} ${message}`);
}

/**
 * Show success message
 *
 * @param {string} message - Success message
 */
function showSuccess(message) {
  console.log(`✅ ${message}`);
}

/**
 * Show error message
 *
 * @param {string} message - Error message
 * @param {Error} error - Optional error object
 */
function showError(message, error = null) {
  console.error(`❌ ${message}`);
  if (error && error.message) {
    console.error(`   ${error.message}`);
  }
  if (error && error.stack && process.env.DEBUG) {
    console.error(`\n${error.stack}`);
  }
}

/**
 * Show warning message
 *
 * @param {string} message - Warning message
 */
function showWarning(message) {
  console.warn(`⚠️  ${message}`);
}

/**
 * Show info message
 *
 * @param {string} message - Info message
 */
function showInfo(message) {
  console.log(`ℹ️  ${message}`);
}

/**
 * Display summary table of results
 *
 * @param {Object} summary Summary data
 */
function showSummary(summary) {
  console.log("\n" + "=".repeat(60));
  console.log("📊 SUMMARY");
  console.log("=".repeat(60));

  Object.entries(summary).forEach(([key, value]) => {
    const label = key.replace(/([A-Z])/g, " $1").trim();
    const capitalizedLabel = label.charAt(0).toUpperCase() + label.slice(1);
    console.log(`   ${capitalizedLabel}: ${value}`);
  });

  console.log("=".repeat(60) + "\n");
}

/**
 * Create a simple spinner
 *
 * @param {string} message - Spinner message (start(label) can replace it)
 * @returns {Object} Spinner control object
 */
function createSpinner(message) {
  const isTTY = process.stdout.isTTY;
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let currentFrame = 0;
  let interval = null;

  return {
    // An optional label replaces the message from here on, so one spinner
    // can name each step it waits on ("Pulling Oura (Sleep)...").
    start(label = null) {
      if (label) message = label;
      if (!isTTY) return;
      if (interval) clearInterval(interval);
      process.stdout.write(`\r\x1b[2K${frames[currentFrame]} ${message}`);
      interval = setInterval(() => {
        currentFrame = (currentFrame + 1) % frames.length;
        process.stdout.write(`\r\x1b[2K${frames[currentFrame]} ${message}`);
      }, 80);
    },

    stop(finalMessage = null) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (isTTY) {
        process.stdout.write("\r\x1b[2K");
      }
      if (finalMessage) {
        console.log(finalMessage);
      }
    },

    succeed(message) {
      this.stop(`✅ ${message}`);
    },

    fail(message) {
      this.stop(`❌ ${message}`);
    },

    warn(message) {
      this.stop(`⚠️  ${message}`);
    },

    info(message) {
      this.stop(`ℹ️  ${message}`);
    },
  };
}

/**
 * Display a formatted list
 *
 * @param {string[]} items - List items
 * @param {string} prefix - Prefix for each item
 */
function showList(items, prefix = "  •") {
  items.forEach((item) => console.log(`${prefix} ${item}`));
}

/**
 * Display a formatted table
 *
 * @param {Object[]} rows - Table rows
 * @param {string[]} columns - Column names
 */
function showTable(rows, columns) {
  if (rows.length === 0) {
    console.log("   (No data)");
    return;
  }

  // Calculate column widths
  const widths = columns.map((col) => {
    const maxWidth = Math.max(
      col.length,
      ...rows.map((row) => String(row[col] || "").length),
    );
    return Math.min(maxWidth, 50); // Cap at 50 chars
  });

  // Print header
  const header = columns.map((col, i) => col.padEnd(widths[i])).join(" | ");
  console.log("   " + header);
  console.log("   " + "-".repeat(header.length));

  // Print rows
  rows.forEach((row) => {
    const line = columns
      .map((col, i) => {
        const value = String(row[col] || "");
        const truncated =
          value.length > widths[i]
            ? value.slice(0, widths[i] - 3) + "..."
            : value;
        return truncated.padEnd(widths[i]);
      })
      .join(" | ");
    console.log("   " + line);
  });
}

/**
 * Prompt for text input
 *
 * @param {string} message - Prompt message
 * @param {string} defaultValue - Default value
 * @returns {Promise<string>} User input
 */
async function promptText(message, defaultValue = "") {
  const { value } = await inquirer.prompt([
    {
      type: "input",
      name: "value",
      message,
      default: defaultValue,
    },
  ]);

  return value;
}

/**
 * Prompt for selection from list
 *
 * @param {string} message - Prompt message
 * @param {string[]} choices - List of choices
 * @returns {Promise<string>} Selected value
 */
async function promptSelect(message, choices) {
  const { value } = await inquirer.prompt([
    {
      type: "list",
      name: "value",
      message,
      choices,
      pageSize: 20, // Show all options without scrolling
    },
  ]);

  return value;
}

/**
 * Prompt for multiple selections
 *
 * @param {string} message - Prompt message
 * @param {string[]} choices - List of choices
 * @returns {Promise<string[]>} Selected values
 */
async function promptMultiSelect(message, choices) {
  const { values } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "values",
      message,
      choices,
      pageSize: 20, // Show all options without scrolling
    },
  ]);

  return values;
}

/**
 * Parse date-range flags from process.argv. Shared across all date-aware CLIs
 * (sync, collect, update, summarize, recap) so they all accept the same surface.
 *
 * Accepts:
 *   --date=YYYY-MM-DD               (single-day shortcut for --from=X --to=X)
 *   --from=YYYY-MM-DD --to=YYYY-MM-DD
 *
 * Returns one of:
 *   { range: null, error: null }                                 — no flags passed; caller falls back to its existing default behavior
 *   { range: null, error: "..." }                                — bad input (mixed flags, bad format, future date, etc.)
 *   { range: { from, to, fromDate, toDate, weeks, months }, error: null }
 *
 * `weeks` and `months` are deduped, sorted arrays so summarize/recap iterate
 * each unique period once even when the range spans multiple days in one week.
 *
 * Order independence: if from > to, the values are swapped silently.
 */
/**
 * Derive the unique Sun–Sat weeks and calendar months a [fromDate, toDate]
 * span touches. Shared by parseDateRangeFromArgv (explicit --from/--to) and
 * defaultAutoRange (the --auto default window) so both return an identical
 * { weeks, months } shape.
 * @returns {{weeks: Array<{weekNumber:number,year:number}>, months: Array<{month:number,year:number}>}}
 */
function deriveWeeksAndMonths(fromDate, toDate) {
  const weekKeys = new Set();
  const weeks = [];
  const monthKeys = new Set();
  const months = [];
  for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
    const yr = d.getFullYear();
    const wk = getWeekNumber(d, yr);
    const wKey = `${yr}-W${wk}`;
    if (!weekKeys.has(wKey)) {
      weekKeys.add(wKey);
      weeks.push({ weekNumber: wk, year: yr });
    }
    const mKey = `${yr}-${d.getMonth() + 1}`;
    if (!monthKeys.has(mKey)) {
      monthKeys.add(mKey);
      months.push({ month: d.getMonth() + 1, year: yr });
    }
  }
  return { weeks, months };
}

/**
 * The default --auto window: last week + this week + next week (3 Sun–Sat
 * weeks, week-aligned). Returns the same shape as parseDateRangeFromArgv's
 * `range`, so every date-scoped step consumes its own granularity —
 * collect/update take fromDate/toDate, summarize takes weeks, aggregate takes
 * months. One definition of the auto window, shared across the pipeline.
 */
function defaultAutoRange() {
  const today = getToday();
  const fromDate = getWeekStart(today); // Sunday of this week
  fromDate.setDate(fromDate.getDate() - 7); // → Sunday of last week
  fromDate.setHours(0, 0, 0, 0);
  const toDate = getWeekEnd(today); // Saturday of this week
  toDate.setDate(toDate.getDate() + 7); // → Saturday of next week
  toDate.setHours(23, 59, 59, 999);
  const { weeks, months } = deriveWeeksAndMonths(fromDate, toDate);
  return { from: formatDate(fromDate), to: formatDate(toDate), fromDate, toDate, weeks, months };
}

function parseDateRangeFromArgv(argv) {
  const get = (flag) => {
    for (const arg of argv) {
      if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
    }
    return null;
  };

  const dateFlag = get("--date");
  let fromFlag = get("--from");
  let toFlag = get("--to");

  // Nothing passed
  if (dateFlag === null && fromFlag === null && toFlag === null) {
    return { range: null, error: null };
  }

  // Can't combine --date with --from/--to
  if (dateFlag !== null && (fromFlag !== null || toFlag !== null)) {
    return { range: null, error: "Cannot combine --date with --from/--to. Use one or the other." };
  }

  // Partial range
  if (dateFlag === null && (fromFlag === null || toFlag === null)) {
    return { range: null, error: "Both --from and --to are required (or use --date for a single day)." };
  }

  // Resolve --date shorthand
  let from = dateFlag !== null ? dateFlag : fromFlag;
  let to = dateFlag !== null ? dateFlag : toFlag;

  // Validate format and parseability
  for (const [name, val] of [
    [dateFlag !== null ? "--date" : "--from", from],
    [dateFlag !== null ? "--date" : "--to", to],
  ]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      return { range: null, error: `Invalid ${name} format: "${val}". Expected YYYY-MM-DD.` };
    }
    const d = new Date(val + "T00:00:00");
    if (isNaN(d.getTime())) {
      return { range: null, error: `Invalid ${name} value: "${val}".` };
    }
  }

  let fromDate = new Date(from + "T00:00:00");
  let toDate = new Date(to + "T23:59:59.999");

  // Auto-swap if reversed
  if (fromDate > toDate) {
    [from, to] = [to, from];
    fromDate = new Date(from + "T00:00:00");
    toDate = new Date(to + "T23:59:59.999");
  }

  // Reject future dates
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (fromDate > todayStart) {
    return { range: null, error: `${dateFlag !== null ? "--date" : "--from"} "${from}" is in the future. Backfill only makes sense for past days.` };
  }

  // Derive unique weeks and months covered by the range (shared helper)
  const { weeks, months } = deriveWeeksAndMonths(fromDate, toDate);

  return {
    range: { from, to, fromDate, toDate, weeks, months },
    error: null,
  };
}

/**
 * Build the `--from=X --to=Y` flag string for passing a range to a child CLI.
 * Returns "" when range is null. Use leading-space form so it appends cleanly.
 */
function dateRangeFlags(range) {
  if (!range) return "";
  return ` --from=${range.from} --to=${range.to}`;
}

module.exports = {
  selectDateRange,
  selectMonthForWeeks,
  selectSources,
  confirmOperation,
  showProgress,
  showSuccess,
  showError,
  showWarning,
  showInfo,
  showSummary,
  createSpinner,
  showList,
  showTable,
  promptText,
  promptSelect,
  promptMultiSelect,
  parseDateRangeFromArgv,
  defaultAutoRange,
  dateRangeFlags,
};
