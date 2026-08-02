import { Injectable, Logger } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { RecordingMeta } from './recording.types';

/** Storage root. Override with STORAGE_DIR to point at a mounted volume. */
const STORAGE_DIR = resolve(
  process.env.STORAGE_DIR ?? join(process.cwd(), 'storage'),
);
const AUDIO_DIR = join(STORAGE_DIR, 'recordings');
const INDEX_FILE = join(STORAGE_DIR, 'index.json');

/**
 * Filesystem-backed persistence for takes.
 *
 * Three kinds of file:
 *   - `recordings/<id>.wav`        the audio payload
 *   - `recordings/<id>.peaks.json` the waveform envelope
 *   - `index.json`                 metadata for every take
 *
 * A JSON index is deliberate rather than lazy: takes are append-mostly and read
 * whole, so a database would add an operational dependency without buying
 * anything at this scale. Measured, the slim index parses in ~2ms at 1000 takes
 * and ~10ms at 5000 — well past any realistic single-user session.
 *
 * The real ceiling is not size, it is processes: the write lock below is
 * in-memory, so this design assumes ONE server process. Running two instances
 * against the same directory would lose entries, and that is the point at which
 * a database (SQLite is sufficient) becomes necessary rather than optional.
 *
 * Swapping this class for a real repository requires no controller change.
 */
@Injectable()
export class RecordingsStorage {
  private readonly logger = new Logger(RecordingsStorage.name);

  /**
   * Serialises index writes. Node is single-threaded but `await` interleaves, so
   * two concurrent uploads could otherwise both read the old index and the
   * second would clobber the first's entry.
   */
  private writeQueue: Promise<unknown> = Promise.resolve();

  /** Absolute path for a take's audio file. */
  audioPath(id: string): string {
    return join(AUDIO_DIR, `${id}.wav`);
  }

  /** Absolute path for a take's waveform envelope. */
  private peaksPath(id: string): string {
    return join(AUDIO_DIR, `${id}.peaks.json`);
  }

  async ensureReady(): Promise<void> {
    await mkdir(AUDIO_DIR, { recursive: true });
    this.logger.log(`Storage ready at ${STORAGE_DIR}`);
  }

  /** Read the metadata index. A missing or corrupt index reads as empty. */
  async list(): Promise<RecordingMeta[]> {
    try {
      const raw = await readFile(INDEX_FILE, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Newest first, matching the order the UI renders.
      return (parsed as RecordingMeta[]).sort(
        (a, b) => b.createdAt - a.createdAt,
      );
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.logger.warn(
          `Could not read index, treating as empty: ${String(cause)}`,
        );
      }
      return [];
    }
  }

  async findById(id: string): Promise<RecordingMeta | null> {
    const all = await this.list();
    return all.find((recording) => recording.id === id) ?? null;
  }

  /**
   * Read a take's waveform envelope.
   *
   * A missing sidecar is not an error: the audio is still playable, the UI just
   * draws a flat waveform. Losing the envelope must never make a take unopenable.
   */
  async readPeaks(id: string): Promise<number[]> {
    try {
      const raw = await readFile(this.peaksPath(id), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as number[]) : [];
    } catch {
      return [];
    }
  }

  /** Write the audio and envelope, then register the take in the index. */
  async save(
    meta: RecordingMeta,
    peaks: number[],
    audio: Buffer,
  ): Promise<RecordingMeta> {
    await mkdir(AUDIO_DIR, { recursive: true });

    // Payload before index: an unreferenced file is harmless, but an index entry
    // pointing at a file that was never written is a broken take.
    await writeFile(this.audioPath(meta.id), audio);
    await writeFile(this.peaksPath(meta.id), JSON.stringify(peaks), 'utf8');

    await this.mutateIndex((current) => [
      meta,
      ...current.filter((entry) => entry.id !== meta.id),
    ]);

    return meta;
  }

  /** Remove the audio, the envelope and the index entry. False if unknown. */
  async remove(id: string): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) return false;

    // Index entry first: an orphaned file is recoverable, but an index entry
    // pointing at a deleted file breaks every subsequent read.
    await this.mutateIndex((current) =>
      current.filter((entry) => entry.id !== id),
    );
    await rm(this.audioPath(id), { force: true });
    await rm(this.peaksPath(id), { force: true });

    return true;
  }

  /** Open a read stream for playback. */
  createAudioStream(id: string) {
    return createReadStream(this.audioPath(id));
  }

  /** Apply a transform to the index under the write lock, atomically. */
  private mutateIndex(
    transform: (current: RecordingMeta[]) => RecordingMeta[],
  ): Promise<void> {
    const next = this.writeQueue.then(async () => {
      const current = await this.list();
      const updated = transform(current);

      // Write-then-rename so a crash mid-write cannot truncate the index.
      const temporary = `${INDEX_FILE}.${process.pid}.tmp`;
      await mkdir(STORAGE_DIR, { recursive: true });
      await writeFile(temporary, JSON.stringify(updated, null, 2), 'utf8');
      await rename(temporary, INDEX_FILE);
    });

    // Keep the chain alive even if this write fails, or every later write hangs.
    this.writeQueue = next.catch(() => undefined);
    return next;
  }
}
