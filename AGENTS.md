# Guitar Recorder API — rules for agents

Read [README.md](README.md) first; it covers the API surface, storage layout and
measured limits. This file is only the things that are easy to break.

## This service stands alone

This directory is the whole project and its own git repository. There is no
parent project, no workspace, no shared `node_modules`. It has no build-time
dependency on any client and must never reach outside its own root — do not
import from, write to, or generate files in a client's directory, wherever that
happens to be checked out.

The wire contract lives in `src/recordings/recording.types.ts` and this service
owns it. Clients keep their own mirrored copy, so **any change to those
interfaces is a breaking change for every client**, even though nothing here will
fail to compile. Say so explicitly when you make one.

## Do not undo these

- **Port 3100.** `next dev` claims 3000/3001. Losing the port race is a confusing
  first-run failure.
- **`peaks` stay out of `index.json`.** They were 91.5% of every entry; listing
  1000 takes went from 65ms to 2.2ms when they moved to sidecar files. `GET
  /recordings` must not return them.
- **`?download=1` is required.** The HTML `download` attribute is ignored
  cross-origin, so `Content-Disposition` is the only thing that makes Save work.
- **Write order in `recordings.storage.ts`.** Payload before index entry on save;
  index entry before files on delete. Both directions are commented — an
  unreferenced file is harmless, a dangling index entry is a broken take.
- **The index write lock.** Writes are serialised through an in-memory promise
  chain and committed write-then-rename. Removing either loses entries.
- **`load-env.ts` must stay the first import in `main.ts`.** `recordings.storage.ts`
  resolves `STORAGE_DIR` at module scope, so the environment has to be populated
  before `app.module` is evaluated.

## Validation is an allowlist, not escaping

Ids are checked against a UUID pattern, uploads against RIFF magic bytes, and
metadata against explicit ranges — all returning 400. Keep it that way; do not
replace a check with sanitising, and do not widen a pattern to make a test pass.

## Scale

The in-memory write lock means **one server process**. That, not data volume, is
what forces a database eventually. When one arrives: metadata only. Audio files
stay on the filesystem or object storage — never BLOBs in the database.
