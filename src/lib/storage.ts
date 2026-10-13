import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';

export interface Storage {
  path(key: string): string;
  prepare(key: string): Promise<string>;
  json<T>(key: string): Promise<T | null>;
  putJson(key: string, value: unknown): Promise<void>;
  removeProject(id: string): Promise<void>;
}
export const storage: Storage = {
  path(key) {
    const resolved = path.resolve(config.storageDir, key);
    if (!resolved.startsWith(config.storageDir + path.sep)) throw new Error('Invalid storage key.');
    return resolved;
  },
  async prepare(key) { const file = this.path(key); await mkdir(path.dirname(file), { recursive: true }); return file; },
  async json<T>(key: string) { try { return JSON.parse(await readFile(this.path(key), 'utf8')) as T; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } },
  async putJson(key, value) { const file = await this.prepare(key); await writeFile(file + '.tmp', JSON.stringify(value)); await rename(file + '.tmp', file); },
  async removeProject(id) { if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid project ID.'); await rm(this.path(id), { recursive: true, force: true }); },
};
export async function exists(key: string) { try { return (await stat(storage.path(key))).isFile(); } catch { return false; } }
