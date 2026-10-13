import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@/generated/prisma/client';
import { config } from './config';

mkdirSync(path.dirname(config.databaseUrl.slice(5)), { recursive: true });
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalDb.prisma ?? new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: config.databaseUrl }) });
if (process.env.NODE_ENV !== 'production') globalDb.prisma = db;
