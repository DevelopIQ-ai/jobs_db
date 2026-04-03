import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_autvtaetgyfphmaprzim",
  dirs: ["./trigger"],
  build: {
    external: ["camoufox-js", "playwright-core", "chromium-bidi/**", "bun:sqlite"],
  },
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 5000,
      factor: 2,
      randomize: true,
    },
  },
  maxDuration: 3600,
});
