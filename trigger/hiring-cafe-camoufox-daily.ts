import * as path from "path";
import { schedules } from "@trigger.dev/sdk";

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

    console.log("Daily scrape complete", result);
    return result;
  },
});
