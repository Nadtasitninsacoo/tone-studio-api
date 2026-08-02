# Guitar Recorder API

NestJS 11 service that stores guitar takes: audio payload, waveform envelope and
metadata, plus range-capable streaming for playback.

This is a **standalone project** with its own repository, released on its own
schedule. It has no build-time dependency on any client and does not assume one is
running. The only thing it knows about a client is which origins to allow through
CORS.

The recorder UI is a separate repository, **guitar-recorder-web**. Adding a second
client — an admin console, say — means adding its origin to `CORS_ORIGIN` and
nothing else here.

## Run

```bash
npm install
cp .env.example .env     # optional, all values have defaults
npm run start:dev        # http://localhost:3100
```

`.env` is loaded by `src/load-env.ts` using Node's built-in `process.loadEnvFile`
— there is no dotenv dependency. In production, supply the environment through
your process manager instead; a missing `.env` is normal, not an error.

**Port 3100 is deliberate, not arbitrary.** `next dev` claims 3000/3001, and a
backend that silently loses the port race is a confusing first-run failure. Do
not "fix" this back to 3000.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3100` | |
| `CORS_ORIGIN` | localhost/127.0.0.1 on 3000 and 3001 | Comma-separated. A new client must be added here or the browser blocks its fetches. |
| `STORAGE_DIR` | `./storage` | Point at a mounted volume in production. |

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/recordings` | metadata only, newest first, **no `peaks`** |
| GET | `/recordings/:id` | includes `peaks` |
| GET | `/recordings/:id/file` | `Accept-Ranges: bytes`, returns 206 for a Range request |
| GET | `/recordings/:id/file?download=1` | sets `Content-Disposition: attachment` |
| POST | `/recordings` | multipart `file` + metadata fields |
| DELETE | `/recordings/:id` | 204, and 404 thereafter |

The response shapes are defined in
[src/recordings/recording.types.ts](src/recordings/recording.types.ts). That file
is the source of truth for the wire contract — clients mirror it, so a change
there is a breaking change for every client.

**`?download=1` is required, not cosmetic.** The HTML `download` attribute is
ignored on cross-origin links, so the response header is the only way to make
Save work from a client on a different host.

**`peaks` are excluded from the list endpoint on purpose.** Measured: 480 floats
were **91.5%** of every index entry (3081 bytes vs 262), which made listing 1000
takes cost 65ms per request. Moved to sidecar files → 2.2ms. Do not inline them
back into the index for convenience.

## Storage

```
storage/
├─ index.json                  metadata for every take
└─ recordings/
   ├─ <uuid>.wav               audio payload
   └─ <uuid>.peaks.json        waveform envelope
```

Index writes are serialised through an in-memory promise chain and written
atomically (write to temp, then rename). The on-disk name is always `<uuid>.wav`
regardless of what the client called the file.

Order matters in both directions and is commented in
[src/recordings/recordings.storage.ts](src/recordings/recordings.storage.ts):
payload is written **before** the index entry (an unreferenced file is harmless;
an index entry pointing at a missing file is a broken take), and on delete the
index entry goes **first**.

## Security

All of the following are verified with curl:

- Filename `../../evil take!.wav` → stored as `.evil take.wav`; the on-disk name
  is the uuid regardless.
- Non-UUID `id` → 400. This is an allowlist, not escaping.
- Non-WAV payload claiming `audio/wav` → 400, via a RIFF magic-byte check.
- Out-of-range metadata → 400. `peaks` are clamped to 0..1.

There is **no authentication**. Every endpoint is open to any allowed origin.
That is fine for a single-user local tool and is the first thing to change before
this is exposed beyond localhost.

## Tests

```bash
npm run test        # unit
npm run test:e2e    # endpoints
npm run lint
```

Every endpoint and every security rejection above has been exercised, including a
byte-identical file round-trip.

## Known limits

- **One server process only.** The index write lock is in-memory, so two
  instances against the same storage directory would lose entries. That — not
  size — is the point at which a database (SQLite is enough) becomes necessary.
  Measured headroom: ~2ms at 1000 takes, ~10ms at 5000.
- When a database does arrive, audio files stay on disk or object storage. Never
  BLOB them into the database; only metadata belongs there.
- The service never touches an audio device. Recording happens in the browser and
  arrives here as an uploaded file.
