import { environmentValue } from "../../config/embedded-node-runtime.mts";

const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const TIMEOUT_ENVIRONMENT = {
  startup: "MINKE_HARNESS_STARTUP_TIMEOUT_MS",
  navigation: "MINKE_HARNESS_NAVIGATION_TIMEOUT_MS",
} as const;

/** Resolve an explicit timeout, a desktop environment override, or the default. */
export function resolveHarnessTimeout(
  phase: keyof typeof TIMEOUT_ENVIRONMENT,
  configured?: number,
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const name = TIMEOUT_ENVIRONMENT[phase];
  const value = environmentValue(environment, name)?.trim();
  const timeout = configured ?? (
    value === undefined || value === ""
      ? DEFAULT_TIMEOUT_MS
      : /^\d+$/u.test(value) ? Number(value) : NaN
  );
  // Node clamps overflowing timers to 1 ms, which would abort every launch.
  if (
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    timeout > MAX_TIMEOUT_MS
  ) {
    throw new RangeError(
      `${name} must be a whole number of milliseconds between 1 and ${String(MAX_TIMEOUT_MS)}`,
    );
  }
  return timeout;
}
