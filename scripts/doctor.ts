import { mkdirSync } from 'node:fs';
import { config } from '../src/lib/config';
import { checkTools } from '../src/lib/media';
async function main() {
  mkdirSync(config.storageDir, { recursive: true });
  console.log(await checkTools());
  console.log(`AI mode: ${config.AI_MODE}`);
  console.log(`Storage: ${config.storageDir}`);
  console.log(`Database: ${config.databaseUrl}`);
  if (config.AI_MODE === 'live' && (!config.GROQ_API_KEY || !config.GEMINI_API_KEY)) console.log('Live mode needs GROQ_API_KEY and GEMINI_API_KEY in .env. No API call was made.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
