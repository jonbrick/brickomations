import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// Convert UTC timestamp to Eastern date (YYYY-MM-DD), handles EST/EDT automatically
function getEasternDate(isoTimestamp) {
  return new Date(isoTimestamp).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

// Convert UTC timestamp to Eastern ISO with offset (e.g., 2026-01-21T21:30:00-05:00)
function toEasternISO(isoTimestamp) {
  const dt = new Date(isoTimestamp);
  const eastern = new Date(
    dt.toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  const offsetMs = eastern.getTime() - dt.getTime();
  const offsetHours = Math.round(offsetMs / (1000 * 60 * 60));
  const offsetStr =
    offsetHours <= 0
      ? `-${String(Math.abs(offsetHours)).padStart(2, "0")}:00`
      : `+${String(offsetHours).padStart(2, "0")}:00`;

  const year = eastern.getFullYear();
  const month = String(eastern.getMonth() + 1).padStart(2, "0");
  const day = String(eastern.getDate()).padStart(2, "0");
  const hours = String(eastern.getHours()).padStart(2, "0");
  const minutes = String(eastern.getMinutes()).padStart(2, "0");
  const seconds = String(eastern.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetStr}`;
}

// Snap a check timestamp to a 30-min block boundary
// The Checker runs every ~30 min and detects playtime that occurred in the preceding window.
// We round the check time UP to the nearest :00 or :30 to get the block end.
// Block start = block end - 30 min.
//
// Example: check ran at 9:54 PM → rounds up to 10:00 PM → block is 9:30 - 10:00 PM
// Example: check ran at 10:24 PM → rounds up to 10:30 PM → block is 10:00 - 10:30 PM
function snapToBlock(isoTimestamp) {
  const dt = new Date(isoTimestamp);
  const minutes = dt.getUTCMinutes();

  // Round up to nearest :00 or :30
  let blockEnd;
  if (minutes === 0 || minutes === 30) {
    // Already on a boundary — this IS the block end
    blockEnd = new Date(dt);
    blockEnd.setUTCSeconds(0, 0);
  } else if (minutes > 30) {
    // Round up to next :00
    blockEnd = new Date(dt);
    blockEnd.setUTCMinutes(0, 0, 0);
    blockEnd.setUTCHours(blockEnd.getUTCHours() + 1);
  } else {
    // minutes > 0 && minutes < 30 — round up to :30
    blockEnd = new Date(dt);
    blockEnd.setUTCMinutes(30, 0, 0);
  }

  // Block start = block end - 30 min
  const blockStart = new Date(blockEnd.getTime() - 30 * 60 * 1000);

  return {
    blockStart: blockStart.toISOString(),
    blockEnd: blockEnd.toISOString(),
  };
}

// Process a single UTC date: scan Checker records, group by game, detect periods, write DAILY_ records
async function processDate(targetDate, dryRun) {
  console.log(`Processing date: ${targetDate}${dryRun ? " [DRY RUN]" : ""}`);

  const scanCommand = new ScanCommand({
    TableName: "steam-playtime",
    FilterExpression:
      "#date_utc = :date AND attribute_exists(session_minutes) AND session_minutes > :zero",
    ExpressionAttributeNames: {
      "#date_utc": "date_utc",
    },
    ExpressionAttributeValues: {
      ":date": targetDate,
      ":zero": 0,
    },
  });

  const response = await docClient.send(scanCommand);
  console.log(`Found ${response.Items.length} gaming sessions for ${targetDate}`);

  if (response.Items.length === 0) {
    return { targetDate, summariesCreated: 0 };
  }

  // Group sessions by game
  const gameData = {};

  response.Items.forEach((item) => {
    const gameId = item.game_id;
    if (!gameData[gameId]) {
      gameData[gameId] = {
        game_name: item.game_name,
        sessions: [],
        total_minutes: 0,
      };
    }

    gameData[gameId].sessions.push({
      timestamp: item.timestamp,
      minutes: item.session_minutes,
    });
    gameData[gameId].total_minutes += item.session_minutes;
  });

  // Process each game
  let summariesCreated = 0;

  for (const [gameId, data] of Object.entries(gameData)) {
    // Sort sessions by timestamp
    data.sessions.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // Snap each check to a 30-min block
    const blocks = data.sessions.map((session) => ({
      ...snapToBlock(session.timestamp),
      checkTime: session.timestamp,
    }));

    // Detect play periods (consecutive blocks within 90 min = same period)
    const playPeriods = [];
    let currentPeriod = null;

    blocks.forEach((block, index) => {
      if (!currentPeriod) {
        currentPeriod = {
          start: block.blockStart,
          end: block.blockEnd,
          blockCount: 1,
        };
      } else {
        // Gap = time between previous block end and this block start
        const gap =
          (new Date(block.blockStart) - new Date(currentPeriod.end)) /
          1000 /
          60;

        if (gap <= 90) {
          // Same period — extend to this block's end
          currentPeriod.end = block.blockEnd;
          currentPeriod.blockCount++;
        } else {
          // New period
          playPeriods.push(currentPeriod);
          currentPeriod = {
            start: block.blockStart,
            end: block.blockEnd,
            blockCount: 1,
          };
        }
      }
    });

    if (currentPeriod) playPeriods.push(currentPeriod);

    // Write one record per period
    // record_id uses UTC date (targetDate) — just a unique key
    // date field uses Eastern date per-period — what brickomations queries on
    for (let i = 0; i < playPeriods.length; i++) {
      const period = playPeriods[i];
      const easternDate = getEasternDate(period.start);
      const durationMinutes = period.blockCount * 30;

      const item = {
        record_id: `DAILY_${targetDate}_${gameId}_PERIOD_${i + 1}`,
        date: easternDate,
        date_utc: targetDate,
        game_id: gameId,
        game_name: data.game_name,
        start_time: toEasternISO(period.start),
        start_time_utc: period.start,
        end_time: toEasternISO(period.end),
        end_time_utc: period.end,
        duration_minutes: durationMinutes,
      };

      if (dryRun) {
        console.log(`[DRY RUN] Would write:`, JSON.stringify(item));
      } else {
        await docClient.send(
          new PutCommand({ TableName: "steam-playtime", Item: item }),
        );
      }
      summariesCreated++;
    }

    console.log(
      `${dryRun ? "[DRY RUN] " : ""}${data.game_name}: ${playPeriods.length} period(s), ${blocks.length} blocks (UTC date: ${targetDate})`,
    );
  }

  return { targetDate, summariesCreated };
}

export const handler = async (event) => {
  console.log("Starting daily summary generation...");

  try {
    const dryRun = event.dryRun || false;

    // Determine which UTC dates to process
    let dates;
    if (event.date) {
      // Explicit date — process only that one
      dates = [event.date];
    } else {
      // No explicit date — process both yesterday and today UTC
      // Yesterday catches early evening ET sessions, today catches late-night
      // ET sessions that cross the UTC date boundary
      const now = new Date();
      const todayUTC = now.toISOString().split("T")[0];
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayUTC = yesterday.toISOString().split("T")[0];
      dates = [yesterdayUTC, todayUTC];
    }

    console.log(`Dates to process: ${dates.join(", ")}${dryRun ? " [DRY RUN]" : ""}`);

    let totalSummaries = 0;
    const results = [];

    for (const date of dates) {
      const result = await processDate(date, dryRun);
      totalSummaries += result.summariesCreated;
      results.push(result);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `${dryRun ? "[DRY RUN] " : ""}Created ${totalSummaries} period summaries for ${dates.join(", ")}`,
        totalSummaries,
        results,
      }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
