import 'dotenv/config';
import { runHiringCafeFullScrape } from './scrape-full';

runHiringCafeFullScrape().catch(console.error);
