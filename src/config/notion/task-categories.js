/**
 * Task Category Mappings
 * Maps task Category values (with emojis) to Personal Summary property keys
 */

const TASK_CATEGORY_MAPPING = {
  "💪 Physical Health": "physicalHealth",
  "🌱 Personal": "personal",
  "🍻 Interpersonal": "interpersonal",
  "❤️ Mental Health": "mentalHealth",
  "🏠 Home": "home",
  "💼 Work": "work", // Note: Work tasks excluded from CSV, handle gracefully
};

const WORK_TASK_CATEGORY_MAPPING = {
  "🧪 Research": "research",
  "💡 Sketch": "sketch",
  "🎨 Design": "design",
  "🖥️ Coding": "coding",
  "⚠️ Crit": "crit",
  "🔎 QA": "qa",
  "🤝 Hiring": "hiring",
  "📝 Admin": "admin",
  "🍸 Social": "social",
  "🏝️ OOO": "ooo",
};

const PERSONAL_TASK_CATEGORY_MAPPING = {
  "💻 Coding": "coding",
  "📝 Admin": "admin",
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
 * @param {string|null|undefined} workCategory - Work Category property value (e.g., "🧪 Research", "📝 Admin")
 * @returns {string|null} Category key (e.g., "research", "admin") or null if unmapped
 */
function getWorkCategoryKey(workCategory) {
  if (!workCategory) {
    return null;
  }

  return WORK_TASK_CATEGORY_MAPPING[workCategory] || null;
}

/**
 * Get personal sub-category key from Personal Category property value
 * @param {string|null|undefined} personalCategory - Personal Category property value (e.g., "💻 Coding", "📝 Admin")
 * @returns {string|null} Category key (e.g., "coding", "admin") or null if unmapped
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
