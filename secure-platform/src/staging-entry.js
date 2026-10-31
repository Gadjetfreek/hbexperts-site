// Deploy entry for the STAGING worker only (wrangler.staging.toml).
// The Workers runtime treats every named export of the main module as an entrypoint, and
// issue33-production-worker.js also exports helper constants/functions, which blocks deploy.
// This re-exports only the default handler, with no behavior change.
import worker from './issue33-production-worker.js';
export default worker;
