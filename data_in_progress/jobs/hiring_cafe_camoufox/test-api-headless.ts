process.env.CAMOUFOX_HEADLESS = '1';

(async () => {
  await import('./test-api');
})();
