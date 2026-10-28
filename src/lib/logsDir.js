import path from "path";
import { DATA_DIR } from "@/lib/dataDir.js";

/**
 * Base directory for request/debug logs.
 *
 * Logs MUST live outside the repository working tree. The Tailwind scan base
 * (src/app/globals.css) and the Turbopack dev watcher both key off the project
 * directory: a log file written into <repo>/logs invalidated the CSS transform
 * on every single request, which re-wrote Turbopack's dev filesystem cache
 * (~256MB per invalidation) until it ballooned to ~10GB and the oversized
 * cache deserialization OOM'd the transform worker -> HTTP 500 on every page.
 *
 * Resolution order:
 *   1. REQUEST_LOGS_DIR  — explicit override (absolute or relative to cwd)
 *   2. DATA_DIR/logs     — the app data dir (Docker: /var/lib/9router/logs,
 *                          Windows: %APPDATA%\9router\logs)
 *   3. <cwd>/logs        — last-resort fallback
 */
export function getLogsDir() {
  const override = process.env.REQUEST_LOGS_DIR;
  if (override) return path.resolve(override);

  if (DATA_DIR) return path.join(DATA_DIR, "logs");

  return path.join(process.cwd(), "logs");
}

export const LOGS_DIR = getLogsDir();
