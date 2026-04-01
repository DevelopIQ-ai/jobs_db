process.env.CAMOUFOX_HEADLESS = '0';

(async () => {
  await import('./scrape-full');
})();
