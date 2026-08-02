/**
 * Persisted metadata for one recorded take.
 *
 * Note what is NOT here: the waveform envelope. It lives in a per-take sidecar
 * file instead, because at 480 floats it accounted for ~91% of every index entry
 * (3081 bytes with peaks vs 262 without). Since the index is read and parsed in
 * full on every request, inlining the envelope made listing 1000 takes cost 65ms;
 * with it moved out, the same list costs 2ms.
 */
export interface RecordingMeta {
  /** Server-generated. Also the on-disk filename stem, so it must stay opaque. */
  id: string;
  /** Display filename supplied by the client, sanitised. */
  name: string;
  /** Epoch ms the take was captured. */
  createdAt: number;
  durationSec: number;
  sizeBytes: number;
  sampleRate: number;
  channels: number;
  /** Highest sample magnitude as dBFS (<= 0). */
  peakDb: number;
  /** Input device the take was captured from. */
  deviceLabel: string;
}

/**
 * A take together with its waveform envelope.
 *
 * Returned by the detail and create endpoints only. The list endpoint returns
 * bare `RecordingMeta`, which also keeps the response small over the wire — the
 * history list has no waveforms to draw.
 */
export interface Recording extends RecordingMeta {
  /** Downsampled 0..1 envelope for waveform rendering. */
  peaks: number[];
}

/**
 * Fields accepted alongside the uploaded file.
 *
 * Multipart values always arrive as strings, so every numeric field is parsed
 * and range-checked in the service rather than trusted here.
 */
export interface CreateRecordingFields {
  name?: string;
  createdAt?: string;
  durationSec?: string;
  sampleRate?: string;
  channels?: string;
  peakDb?: string;
  /** JSON-encoded number array. */
  peaks?: string;
  deviceLabel?: string;
}
