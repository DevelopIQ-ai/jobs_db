import * as path from "path";
import { schedules } from "@trigger.dev/sdk";

const MIN_EXPECTED_JOBS = 500;

export const hiringCafeCamoufoxDaily = schedules.task({
  id: "hiring-cafe-camoufox-daily",
  cron: {
    pattern: "30 12 * * *",
    timezone: "UTC",
  },
  run: async (payload) => {
    const { runHiringCafeFullScrape } = await import(
      "../data_in_progress/jobs/hiring_cafe_camoufox/scrape-full"
    );
    const maxPages = Number(process.env.HIRING_CAFE_DAILY_MAX_PAGES ?? "0");
    const outputDir = path.join(
      process.cwd(),
      "data_in_progress/jobs/hiring_cafe_camoufox/output/trigger-daily"
    );

    console.log("Starting daily hiring.cafe scrape via BrightData", {
      timestamp: payload.timestamp.toISOString(),
      timezone: payload.timezone,
      schedule: "12:30 UTC / 6:00 PM IST",
      maxPages,
      outputDir,
    });

    const result = await runHiringCafeFullScrape({
      windowDays: 1,
      maxPages,
      outputDir,
      freshStart: true,
    });

    if (result.totalWritten < MIN_EXPECTED_JOBS) {
      console.warn(`WARNING: Only ${result.totalWritten} jobs scraped (expected >= ${MIN_EXPECTED_JOBS}). Exit reason: ${result.exitReason}. Errors: ${result.totalErrors}.`);
    }
    if (result.totalUpserted === 0 && result.totalWritten > 0) {
      console.error(`CRITICAL: ${result.totalWritten} jobs scraped but 0 upserted to Supabase — data was NOT persisted to database.`);
    }
    if (result.totalUpserted > 0 && result.totalUpserted < result.totalWritten * 0.5) {
      console.warn(`WARNING: Only ${result.totalUpserted}/${result.totalWritten} jobs upserted to Supabase (< 50% success rate).`);
    }

    console.log("Daily scrape complete", result);
    return result;
  },
});
