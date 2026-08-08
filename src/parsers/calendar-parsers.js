/**
 * Custom parsers for calendars that require special processing
 * Used by calendars with processingPattern: "customParser"
 */

/**
 * Parse body weight from calendar events
 * Extracts weight values using regex and calculates average
 * @param {Object} calendarEvents - All calendar events keyed by fetchKey
 * @param {Function} isDateInWeek - Function to check if date is in current week
 * @param {Object} group Summary_GROUPS config for this calendar
 * @returns {Object} Summary fields to merge
 */
function weightParser(calendarEvents, isDateInWeek, group) {
  const bodyWeightEvents = calendarEvents.bodyWeight || [];
  const filteredBodyWeightEvents = bodyWeightEvents.filter((event) =>
    isDateInWeek(event.date)
  );

  // Extract weight values from event summaries using regex
  // Matches patterns like "Weight: 201.4 lbs" or "201.4 lbs"
  const weights = filteredBodyWeightEvents
    .map((event) => {
      const match = event.summary?.match(/(\d+\.?\d*)\s*lbs?/i);
      return match ? parseFloat(match[1]) : null;
    })
    .filter((weight) => weight !== null);

  // Calculate average
  if (weights.length > 0) {
    const sum = weights.reduce((acc, weight) => acc + weight, 0);
    return {
      bodyWeightAverage: Math.round((sum / weights.length) * 10) / 10,
    };
  } else {
    // No weigh-ins: null clears the Notion property. A written 0 counts as a
    // data point in the monthly rollup mean; a blank week is ignored.
    return { bodyWeightAverage: null };
  }
}

/**
 * Parse blood pressure from calendar events
 * Extracts systolic/diastolic values and calculates averages
 * @param {Object} calendarEvents - All calendar events keyed by fetchKey
 * @param {Function} isDateInWeek - Function to check if date is in current week
 * @param {Object} group Summary_GROUPS config for this calendar
 * @returns {Object} Summary fields to merge
 */
function bloodPressureParser(calendarEvents, isDateInWeek, group) {
  const bloodPressureEvents = calendarEvents.bloodPressure || [];
  const filteredBloodPressureEvents = bloodPressureEvents.filter((event) =>
    isDateInWeek(event.date)
  );

  // Extract values from event title/summary using regex
  // Title format: "BP: 147/95"
  const readings = filteredBloodPressureEvents
    .map((event) => {
      const summary = event.summary || "";
      const match = summary.match(/BP:\s*(\d+\.?\d*)\/(\d+\.?\d*)/i);
      if (match) {
        return {
          systolic: parseFloat(match[1]),
          diastolic: parseFloat(match[2]),
        };
      }
      return { systolic: null, diastolic: null };
    })
    .filter(
      (reading) => reading.systolic !== null || reading.diastolic !== null
    );

  if (readings.length > 0) {
    const systolicSum = readings.reduce((sum, r) => sum + (r.systolic || 0), 0);
    const diastolicSum = readings.reduce((sum, r) => sum + (r.diastolic || 0), 0);
    const systolicCount = readings.filter((r) => r.systolic !== null).length;
    const diastolicCount = readings.filter((r) => r.diastolic !== null).length;

    return {
      avgSystolic:
        systolicCount > 0
          ? Math.round((systolicSum / systolicCount) * 10) / 10
          : null,
      avgDiastolic:
        diastolicCount > 0
          ? Math.round((diastolicSum / diastolicCount) * 10) / 10
          : null,
    };
  } else {
    // No readings: null clears the Notion property. A written 0 counts as a
    // data point in the monthly rollup mean; a blank week is ignored.
    return {
      avgSystolic: null,
      avgDiastolic: null,
    };
  }
}

const PARSERS = {
  weightParser,
  bloodPressureParser,
};

module.exports = {
  PARSERS,
  weightParser,
  bloodPressureParser,
};

