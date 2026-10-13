import { defineConfig } from 'prisma/config';
import { config } from './src/lib/config';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
// Prisma's Windows engine can fail silently when asked to create a missing file.
// Open in append mode: creates an empty DB safely, never truncates existing data.
mkdirSync(path.dirname(config.databaseUrl.slice(5)), { recursive: true });
closeSync(openSync(config.databaseUrl.slice(5), 'a'));
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: config.databaseUrl },
});
