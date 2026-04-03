import * as path from "path";
import { task } from "@trigger.dev/sdk";

export const hiringCafeCamoufoxSmoke = task({
  id: "hiring-cafe-camoufox-smoke",
  run: async () => {
    const { runHiringCafeFullScrape } = await import(
      "../data_in_progress/jobs/hiring_cafe_camoufox/scrape-full"
    );
    const maxPages = Number(process.env.HIRING_CAFE_SMOKE_MAX_PAGES ?? "2");
    const outputDir = path.join(
      process.cwd(),
      "data_in_progress/jobs/hiring_cafe_camoufox/output/trigger-smoke"
    );

    console.log("Starting smoke test via BrightData", {
      maxPages,
      outputDir,
    });

    const result = await runHiringCafeFullScrape({
      windowDays: 1,
      maxPages,
      outputDir,
      freshStart: true,
    });

    console.log("Smoke test complete", result);
    return result;
  },
});
