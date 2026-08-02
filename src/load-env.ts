/**
 * Loads `.env` into `process.env`, if one exists.
 *
 * Imported for its side effect as the *first* import in `main.ts`. That
 * position is load-bearing: `recordings.storage.ts` resolves `STORAGE_DIR` at
 * module scope, so anything read from the environment must already be there by
 * the time `app.module` is evaluated.
 *
 * `process.loadEnvFile` is a Node built-in (20.12+), which is why this service
 * has no dotenv dependency. A missing file is normal, not an error: in
 * production the environment is supplied by the process manager, and there is
 * no `.env` on disk at all.
 */
try {
  process.loadEnvFile();
} catch (cause) {
  if ((cause as NodeJS.ErrnoException)?.code !== 'ENOENT') throw cause;
}

export {};
