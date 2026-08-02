import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type {
  CreateRecordingFields,
  Recording,
  RecordingMeta,
} from './recording.types';
import { RecordingsStorage } from './recordings.storage';

/** Hard ceiling on an upload. ~30 min of 48 kHz stereo 16-bit is about 330 MB. */
export const MAX_UPLOAD_BYTES = 400 * 1024 * 1024;

/** Envelope resolution the frontend sends. Guards against absurd payloads. */
const MAX_PEAKS = 4096;

/**
 * Control characters, stripped from any text we store or log.
 *
 * eslint's no-control-regex is disabled deliberately: the rule exists to catch a
 * control character typed into a pattern by accident, and here matching them is
 * the entire purpose.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/** Only IDs matching this may ever reach the filesystem. */
const ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

@Injectable()
export class RecordingsService implements OnModuleInit {
  constructor(private readonly storage: RecordingsStorage) {}

  async onModuleInit(): Promise<void> {
    await this.storage.ensureReady();
  }

  /** Metadata only — the history list has no waveforms to draw. */
  findAll(): Promise<RecordingMeta[]> {
    return this.storage.list();
  }

  /**
   * Validate an ID before it is used in a path.
   *
   * The ID becomes a filename, so anything other than a UUID we generated is
   * rejected outright. This is what stops `../../etc/passwd` style traversal —
   * the pattern is an allowlist, not an escaping attempt.
   */
  private assertValidId(id: string): void {
    if (!ID_PATTERN.test(id)) {
      throw new BadRequestException('Malformed recording id.');
    }
  }

  /** Metadata without the envelope. Used by the file and delete routes. */
  async findMeta(id: string): Promise<RecordingMeta> {
    this.assertValidId(id);
    const recording = await this.storage.findById(id);
    if (!recording) throw new NotFoundException(`No recording with id ${id}.`);
    return recording;
  }

  /** Full record, including the waveform envelope from its sidecar file. */
  async findOne(id: string): Promise<Recording> {
    const meta = await this.findMeta(id);
    return { ...meta, peaks: await this.storage.readPeaks(id) };
  }

  async remove(id: string): Promise<void> {
    this.assertValidId(id);
    const removed = await this.storage.remove(id);
    if (!removed) throw new NotFoundException(`No recording with id ${id}.`);
  }

  audioPathFor(recording: RecordingMeta): string {
    return this.storage.audioPath(recording.id);
  }

  /**
   * Persist an uploaded take.
   *
   * Everything from the client is treated as untrusted: the filename is
   * regenerated, the numeric metadata is range-checked, and the payload itself is
   * verified to actually be a RIFF/WAVE file rather than merely claiming to be.
   */
  async create(
    file: Express.Multer.File | undefined,
    fields: CreateRecordingFields,
  ): Promise<Recording> {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'No audio file was uploaded under field "file".',
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `Upload exceeds ${MAX_UPLOAD_BYTES} bytes.`,
      );
    }

    this.assertRiffWave(file.buffer);

    const id = randomUUID();
    const peaks = this.parsePeaks(fields.peaks);

    const meta: RecordingMeta = {
      id,
      name: this.sanitiseName(fields.name, id),
      createdAt: this.parseNumber(fields.createdAt, 'createdAt', {
        min: 0,
        fallback: Date.now(),
      }),
      durationSec: this.parseNumber(fields.durationSec, 'durationSec', {
        min: 0,
        max: 24 * 60 * 60,
        fallback: 0,
      }),
      sizeBytes: file.size,
      sampleRate: this.parseNumber(fields.sampleRate, 'sampleRate', {
        min: 1000,
        max: 768_000,
        fallback: 48_000,
      }),
      channels: this.parseNumber(fields.channels, 'channels', {
        min: 1,
        max: 32,
        fallback: 1,
      }),
      peakDb: this.parseNumber(fields.peakDb, 'peakDb', {
        min: -200,
        max: 0,
        fallback: 0,
      }),
      deviceLabel: this.sanitiseText(fields.deviceLabel, 'Unknown input'),
    };

    await this.storage.save(meta, peaks, file.buffer);

    // Echo the envelope back so the client need not re-fetch what it just sent.
    return { ...meta, peaks };
  }

  /**
   * Confirm the payload really is a WAV.
   *
   * A `Content-Type` header is just a claim. Checking the RIFF/WAVE magic bytes
   * costs nothing and stops us storing whatever a client felt like sending under
   * a `.wav` name.
   */
  private assertRiffWave(buffer: Buffer): void {
    const isRiffWave =
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WAVE';

    if (!isRiffWave) {
      throw new BadRequestException(
        'Uploaded file is not a RIFF/WAVE audio file.',
      );
    }
  }

  /**
   * Build a safe display filename.
   *
   * Path separators and traversal sequences are stripped rather than escaped, and
   * the result is only ever metadata — the on-disk name is always `<uuid>.wav`.
   */
  private sanitiseName(raw: string | undefined, id: string): string {
    const base = (raw ?? '')
      .replace(/[\\/]/g, '')
      .replace(/\.{2,}/g, '.')
      .replace(/[^\w.\- ]/g, '')
      .trim()
      .slice(0, 120);

    if (!base) return `take-${id.slice(0, 8)}.wav`;
    return base.toLowerCase().endsWith('.wav') ? base : `${base}.wav`;
  }

  private sanitiseText(raw: string | undefined, fallback: string): string {
    const cleaned = (raw ?? '').replace(CONTROL_CHARS, '').trim().slice(0, 200);
    return cleaned || fallback;
  }

  private parseNumber(
    raw: string | undefined,
    field: string,
    bounds: { min?: number; max?: number; fallback: number },
  ): number {
    if (raw === undefined || raw === '') return bounds.fallback;

    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new BadRequestException(
        `Field "${field}" must be a finite number.`,
      );
    }
    if (bounds.min !== undefined && value < bounds.min) {
      throw new BadRequestException(
        `Field "${field}" must be >= ${bounds.min}.`,
      );
    }
    if (bounds.max !== undefined && value > bounds.max) {
      throw new BadRequestException(
        `Field "${field}" must be <= ${bounds.max}.`,
      );
    }
    return value;
  }

  /** Parse the waveform envelope, clamping each bucket into 0..1. */
  private parsePeaks(raw: string | undefined): number[] {
    if (!raw) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException(
        'Field "peaks" must be a JSON array of numbers.',
      );
    }

    if (!Array.isArray(parsed)) {
      throw new BadRequestException(
        'Field "peaks" must be a JSON array of numbers.',
      );
    }
    if (parsed.length > MAX_PEAKS) {
      throw new BadRequestException(
        `Field "peaks" may contain at most ${MAX_PEAKS} values.`,
      );
    }

    return parsed.map((value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return 0;
      return Math.min(1, Math.max(0, numeric));
    });
  }
}
