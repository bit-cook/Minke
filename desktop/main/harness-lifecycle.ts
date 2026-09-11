import type { HarnessRuntimeEndpoint } from "./harness-runtime.ts";
import { resolveHarnessTimeout } from "./harness-timeout.ts";

export interface HarnessLifecycleRuntime {
  start(): Promise<HarnessRuntimeEndpoint>;
}

export interface HarnessLifecycleRemote {
  detach(): Promise<unknown>;
  start(
    harnessOrigin: string,
    launchToken: string,
  ): Promise<unknown>;
}

export interface HarnessLifecycleWindow {
  isDestroyed(): boolean;
  loadURL(url: string): Promise<unknown>;
  webContents: {
    getURL(): string;
    isDestroyed(): boolean;
    isLoadingMainFrame(): boolean;
    stop(): void;
  };
}

export interface HarnessLifecycleOptions {
  runtime: HarnessLifecycleRuntime;
  remote?: HarnessLifecycleRemote;
  reportError?: (message: string, error: unknown) => void;
  navigationTimeoutMs?: number;
  /** Ask whether to reload the window while keeping the ready runtime alive. */
  requestNavigationRetry?: (error: HarnessNavigationError) => Promise<boolean>;
}

export class HarnessNavigationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HarnessNavigationError";
  }
}

function isUsableWindow(
  window: HarnessLifecycleWindow | undefined,
): window is HarnessLifecycleWindow {
  return window !== undefined &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed();
}

function hasCompletedHarnessNavigation(
  window: HarnessLifecycleWindow,
  origin: string,
): boolean {
  if (!isUsableWindow(window)) return false;
  try {
    return (
      !window.webContents.isLoadingMainFrame() &&
      new URL(window.webContents.getURL()).href ===
        new URL(origin).href
    );
  } catch {
    return false;
  }
}

/**
 * Own the live Harness URL and the ordering between the local runtime, the
 * optional desktop window, and remote exposure.
 */
export class HarnessLifecycle {
  readonly #runtime: HarnessLifecycleRuntime;
  readonly #remote: HarnessLifecycleRemote | undefined;
  readonly #reportError: (message: string, error: unknown) => void;
  readonly #navigationTimeoutMs: number;
  readonly #requestNavigationRetry: HarnessLifecycleOptions["requestNavigationRetry"];
  #url: string | undefined;
  #authenticatedUrl: string | undefined;
  #launchToken: string | undefined;

  constructor(options: HarnessLifecycleOptions) {
    this.#runtime = options.runtime;
    this.#remote = options.remote;
    this.#reportError =
      options.reportError ??
      ((message, error) => console.error(message, error));
    this.#navigationTimeoutMs = resolveHarnessTimeout(
      "navigation",
      options.navigationTimeoutMs,
    );
    this.#requestNavigationRetry = options.requestNavigationRetry;
  }

  get url(): string | undefined {
    return this.#url;
  }

  clear(): void {
    this.#url = undefined;
    this.#authenticatedUrl = undefined;
    this.#launchToken = undefined;
  }

  async attach(
    window: HarnessLifecycleWindow,
  ): Promise<void> {
    const url = this.#url;
    if (url === undefined || !isUsableWindow(window)) return;
    const authenticatedUrl = this.#authenticatedUrl;
    const launchToken = this.#launchToken;
    await this.#loadWindow(
      window,
      authenticatedUrl ?? url,
      url,
      launchToken,
    );
    if (
      authenticatedUrl !== undefined &&
      this.#authenticatedUrl === authenticatedUrl
    ) {
      this.#authenticatedUrl = undefined;
      this.#launchToken = undefined;
    }
  }

  async start(
    window?: HarnessLifecycleWindow,
  ): Promise<string> {
    if (this.#remote !== undefined) {
      try {
        await this.#remote.detach();
      } catch (error) {
        this.#reportError(
          "Remote access failed to detach:",
          error,
        );
      }
    }

    const endpoint = await this.#runtime.start();
    const {
      authenticatedUrl,
      launchToken,
      origin,
    } = endpoint;
    this.#url = origin;
    this.#authenticatedUrl = authenticatedUrl;
    this.#launchToken = launchToken;
    if (isUsableWindow(window)) {
      await this.#loadWindow(
        window,
        authenticatedUrl,
        origin,
        launchToken,
      );
      if (this.#authenticatedUrl === authenticatedUrl) {
        this.#authenticatedUrl = undefined;
        this.#launchToken = undefined;
      }
    }
    if (this.#remote !== undefined) {
      void this.#remote
        .start(origin, launchToken)
        .catch((error: unknown) => {
          this.#reportError(
            "Remote access failed to start:",
            error,
          );
        });
    }
    return origin;
  }

  async #loadWindow(
    window: HarnessLifecycleWindow,
    navigationUrl: string,
    origin: string,
    launchToken: string | undefined,
  ): Promise<void> {
    for (;;) {
      try {
        await this.#loadWindowAttempt(
          window,
          navigationUrl,
          origin,
          launchToken,
        );
        return;
      } catch (error) {
        if (
          !(error instanceof HarnessNavigationError) ||
          this.#requestNavigationRetry === undefined ||
          !isUsableWindow(window) ||
          this.#url !== origin ||
          !(await this.#requestNavigationRetry(error)) ||
          !isUsableWindow(window) ||
          this.#url !== origin
        ) {
          throw error;
        }
      }
    }
  }

  async #loadWindowAttempt(
    window: HarnessLifecycleWindow,
    navigationUrl: string,
    origin: string,
    launchToken: string | undefined,
  ): Promise<void> {
    let navigation: Promise<unknown>;
    try {
      navigation = window.loadURL(navigationUrl);
    } catch (error) {
      throw new HarnessNavigationError(
        `Harness window could not start loading ${origin}`,
        {
          cause: sanitizedNavigationCause(
            error,
            launchToken,
          ),
        },
      );
    }

    await new Promise<void>((resolvePromise, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (hasCompletedHarnessNavigation(window, origin)) {
          resolvePromise();
          return;
        }
        if (isUsableWindow(window)) {
          try {
            window.webContents.stop();
          } catch {
            // The window can be destroyed between the guard and stop().
          }
        }
        reject(
          new HarnessNavigationError(
            `Harness window navigation did not finish within ${String(this.#navigationTimeoutMs)} ms`,
          ),
        );
      }, this.#navigationTimeoutMs);
      timeout.unref();

      void navigation.then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolvePromise();
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(
            new HarnessNavigationError(
              `Harness window failed to load ${origin}`,
              {
                cause: sanitizedNavigationCause(
                  error,
                  launchToken,
                ),
              },
            ),
          );
        },
      );
    });
  }
}

function sanitizedNavigationCause(
  error: unknown,
  launchToken: string | undefined,
): Error {
  const source =
    error instanceof Error
      ? error.message
      : String(error);
  const withoutToken =
    launchToken === undefined
      ? source
      : source.replaceAll(launchToken, "<redacted>");
  const cause = new Error(
    withoutToken.replace(
      /([?&]token=)[^&\s)]*/giu,
      "$1<redacted>",
    ),
  );
  if (error instanceof Error) cause.name = error.name;
  return cause;
}
