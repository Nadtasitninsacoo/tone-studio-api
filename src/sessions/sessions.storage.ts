import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { MixerSession } from './session.types';

const STORAGE_DIR = resolve(
  process.env.STORAGE_DIR ?? join(process.cwd(), 'storage'),
);
const SESSIONS_FILE = join(STORAGE_DIR, 'sessions.json');

@Injectable()
export class SessionsStorage {
  private readonly logger = new Logger(SessionsStorage.name);
  private writeQueue: Promise<unknown> = Promise.resolve();

  async ensureReady(): Promise<void> {
    await mkdir(STORAGE_DIR, { recursive: true });
    this.logger.log(`Sessions storage ready at ${STORAGE_DIR}`);
  }

  /** Read all sessions, sorted newest first. */
  async list(): Promise<MixerSession[]> {
    try {
      const raw = await readFile(SESSIONS_FILE, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return (parsed as MixerSession[]).sort(
        (a, b) => b.createdAt - a.createdAt,
      );
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.logger.warn(
          `Could not read sessions file, treating as empty: ${String(cause)}`,
        );
      }
      return [];
    }
  }

  async findById(id: string): Promise<MixerSession | null> {
    const all = await this.list();
    return all.find((s) => s.id === id) ?? null;
  }

  async save(session: MixerSession): Promise<MixerSession> {
    await this.mutateSessions((current) => [
      session,
      ...current.filter((s) => s.id !== session.id),
    ]);
    return session;
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) return false;

    await this.mutateSessions((current) => current.filter((s) => s.id !== id));
    return true;
  }

  private mutateSessions(
    transform: (current: MixerSession[]) => MixerSession[],
  ): Promise<void> {
    const next = this.writeQueue.then(async () => {
      const current = await this.list();
      const updated = transform(current);

      const temporary = `${SESSIONS_FILE}.${process.pid}.tmp`;
      await mkdir(STORAGE_DIR, { recursive: true });
      await writeFile(temporary, JSON.stringify(updated, null, 2), 'utf8');
      await rename(temporary, SESSIONS_FILE);
    });

    this.writeQueue = next.catch(() => undefined);
    return next;
  }
}
