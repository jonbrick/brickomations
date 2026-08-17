/**
 * Task Category Mappings
 * Maps task Category values (with emojis) to Summary property keys
 *
 * Two-field model (migrated 2026-08-16): Category is the binary
 * (💼 Work / 🌱 Personal); subcategories live in WORK Category and
 * PERSONAL Category (7 options each).
 */

const TASK_CATEGORY_MAPPING = {
  "🌱 Personal": "personal",
  "💼 Work": "work",
};

// Exploration/Critique keep the legacy sketch/crit summary keys so the
// existing weekly-summary Notion columns keep their history.
const WORK_TASK_CATEGORY_MAPPING = {
  "🎨 Design": "design",
  "🖥️ Coding": "coding",
  "💡 Exploration": "sketch",
  "🔎 QA": "qa",
  "⚠️ Critique": "crit",
  "🤝 Hiring": "hiring",
  "💼 Admin": "workAdmin",
};

const PERSONAL_TASK_CATEGORY_MAPPING = {
  "🎸 Hobbies": "hobbies",
  "🍻 Interpersonal": "interpersonal",
  "🏠 Home": "home",
  "🍗 Cooking": "cooking",
  "💪 Physical Health": "physicalHealth",
  "❤️ Mental Health": "mentalHealth",
  "🌱 Admin": "personalAdmin",
};

const TASK_STATUS_MAPPING = {
  "🟢 Done": "done",
  "🔵 In Progress": "inProgress",
  "🟡 Scheduled": "scheduled",
  "🟠 To Book": "toBook",
  "🔴 To Do": "toDo",
  "🟣 Considering": "considering",
  "🧊 Ice Box": "iceBox",
};

/** Status values that should be skipped for calendar sync (Events/Trips) */
const CALENDAR_SKIP_STATUSES = [
  "🧊 Ice Box",
  "↗️ Next Year",
  "🛑 Won't Do",
  "🫥 N/A",
];

/**
 * Get category key from task Category value
 * @param {string} taskType - Task Category value (e.g., "💪 Physical Health")
 * @returns {string|null} Category key (e.g., "physicalHealth") or null if unmapped
 */
function getCategoryKey(taskType) {
  return TASK_CATEGORY_MAPPING[taskType] || null;
}

/**
 * Get work category key from Work Category property value
 * @param {string|null|undefined} workCategory - Work Category property value (e.g., "💡 Exploration", "📝 Admin")
 * @returns {string|null} Category key (e.g., "sketch", "workAdmin") or null if unmapped
 */
function getWorkCategoryKey(workCategory) {
  if (!workCategory) {
    return null;
  }

  return WORK_TASK_CATEGORY_MAPPING[workCategory] || null;
}

/**
 * Get personal sub-category key from Personal Category property value
 * @param {string|null|undefined} personalCategory - Personal Category property value (e.g., "📝 Admin")
 * @returns {string|null} Category key (e.g., "hobbies", "personalAdmin") or null if unmapped
 */
function getPersonalCategoryKey(personalCategory) {
  if (!personalCategory) {
    return null;
  }

  return PERSONAL_TASK_CATEGORY_MAPPING[personalCategory] || null;
}

module.exports = {
  TASK_CATEGORY_MAPPING,
  WORK_TASK_CATEGORY_MAPPING,
  PERSONAL_TASK_CATEGORY_MAPPING,
  TASK_STATUS_MAPPING,
  CALENDAR_SKIP_STATUSES,
  getCategoryKey,
  getWorkCategoryKey,
  getPersonalCategoryKey,
};
