/**
 * Notion Configuration Index
 * Aggregates all integration-specific Notion configurations
 */

const oura = require("./oura");
const strava = require("./strava");
const steam = require("./steam");
const githubPersonal = require("./github-personal");
const githubWork = require("./github-work");
const withings = require("./withings");
const bloodPressure = require("./blood-pressure");
const medications = require("./medications");
const supplements = require("./supplements");
const events = require("./events");
const trips = require("./trips");
const personalSummary = require("./personal-summary");
const workSummary = require("./work-summary");
const personalHabits = require("./personal-habits");
const personalMonthlyRecap = require("./personal-monthly-recap");
const workMonthlyRecap = require("./work-monthly-recap");
const relationships = require("./relationships");
const years = require("./years");
const months = require("./months");
const weeks = require("./weeks");
const rocks = require("./rocks");
const linearTasks = require("./linear-tasks");
const linearProjects = require("./linear-projects");
const nycMuseums = require("./nyc-museums");
const nycRestaurants = require("./nyc-restaurants");
const nycTattoos = require("./nyc-tattoos");
const nycVenues = require("./nyc-venues");

// Aggregate database IDs
const databases = {
  oura: oura.database,
  strava: strava.database,
  githubPersonal: githubPersonal.database,
  githubWork: githubWork.database,
  steam: steam.database,
  withings: withings.database,
  bloodPressure: bloodPressure.database,
  medications: medications.database,
  supplements: supplements.database,
  events: events.database,
  trips: trips.database,
  personalSummary: personalSummary.database,
  workSummary: workSummary.database,
  personalHabits: personalHabits.database,
  personalMonthlyRecap: personalMonthlyRecap.database,
  workMonthlyRecap: workMonthlyRecap.database,
  relationships: relationships.database,
  years: years.database,
  months: months.database,
  weeks: weeks.database,
  rocks: rocks.database,
  linearTasks: linearTasks.database,
  linearProjects: linearProjects.database,
  nycMuseums: nycMuseums.database,
  nycRestaurants: nycRestaurants.database,
  nycTattoos: nycTattoos.database,
  nycVenues: nycVenues.database,
};

// Aggregate properties
const properties = {
  oura: oura.properties,
  strava: strava.properties,
  steam: steam.properties,
  githubPersonal: githubPersonal.properties,
  githubWork: githubWork.properties,
  withings: withings.properties,
  bloodPressure: bloodPressure.properties,
  medications: medications.properties,
  supplements: supplements.properties,
  events: events.properties,
  trips: trips.properties,
  personalSummary: personalSummary.properties,
  workSummary: workSummary.properties,
  personalHabits: personalHabits.properties,
  personalMonthlyRecap: personalMonthlyRecap.properties,
  workMonthlyRecap: workMonthlyRecap.properties,
  relationships: relationships.properties,
  years: years.properties,
  months: months.properties,
  weeks: weeks.properties,
  rocks: rocks.properties,
  linearTasks: linearTasks.properties,
  linearProjects: linearProjects.properties,
  nycMuseums: nycMuseums.properties,
  nycRestaurants: nycRestaurants.properties,
  nycTattoos: nycTattoos.properties,
  nycVenues: nycVenues.properties,
};

// Aggregate field mappings
const fieldMappings = {
  oura: oura.fieldMappings,
  strava: strava.fieldMappings,
  steam: steam.fieldMappings,
  githubPersonal: githubPersonal.fieldMappings,
  githubWork: githubWork.fieldMappings,
  withings: withings.fieldMappings,
  bloodPressure: bloodPressure.fieldMappings,
  medications: medications.fieldMappings || {},
  supplements: supplements.fieldMappings || {},
  events: events.fieldMappings || {},
  trips: trips.fieldMappings || {},
  personalSummary: personalSummary.fieldMappings,
  workSummary: workSummary.fieldMappings,
  personalHabits: personalHabits.fieldMappings,
  relationships: relationships.fieldMappings || {},
  years: years.fieldMappings,
  months: months.fieldMappings,
  weeks: weeks.fieldMappings || {},
  rocks: rocks.fieldMappings || {},
};

// Color mappings (for categorization and display)
const colors = {};

// Sleep-specific configurations (from oura.js)
const sleepCategorization = oura.categorization;

// Helper function to get property name
function getPropertyName(property) {
  if (property && typeof property === "object" && property.name) {
    return property.name;
  }
  return property;
}

// Helper function to check if property is enabled
function isPropertyEnabled(property) {
  if (property && typeof property === "object") {
    return property.enabled !== false; // Default to enabled if not specified
  }
  return true;
}

// Helper function to filter properties for a specific database
function getEnabledProperties(dbKey) {
  const dbProperties = properties[dbKey];
  if (!dbProperties) return {};

  const enabled = {};
  Object.entries(dbProperties).forEach(([key, prop]) => {
    if (isPropertyEnabled(prop)) {
      enabled[key] = prop;
    }
  });
  return enabled;
}

// Helper function to get property type for a database and property key
function getPropertyType(dbKey, propertyKey) {
  const prop = properties[dbKey]?.[propertyKey];
  return prop?.type || "text";
}

// Helper function to get select options for a property
function getPropertyOptions(dbKey, propertyKey) {
  const prop = properties[dbKey]?.[propertyKey];
  return prop?.options || null;
}

module.exports = {
  databases,
  properties,
  fieldMappings,
  colors,
  sleepCategorization,

  // Helper to get token (uses primary NOTION_TOKEN)
  getToken: () => process.env.NOTION_TOKEN,

  // Helper functions for property management
  getPropertyName,
  isPropertyEnabled,
  getEnabledProperties,
  getPropertyType,
  getPropertyOptions,
};
