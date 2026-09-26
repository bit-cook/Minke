import type { HarnessClientContext } from "../core/context.ts";
import type { DesktopBridgeWindow } from "../desktop/contracts.ts";
import { desktopTabsPort } from "../desktop/index.ts";
import { MINKE_PROJECT_URL } from "../about/model.ts";

interface FeedbackUi {
  openSession(sessionId: string): void;
}

/** Redirect the native menu and bare /feedback action without replacing its UI. */
export function installFeedback(
  ctx: HarnessClientContext,
  browser: DesktopBridgeWindow & Pick<Window, "open"> = window,
): void {
  ctx.inject?.(["feedbackUi"], (scope) => {
    const feedback = scope.get("feedbackUi") as FeedbackUi;
    scope.effect(() => {
      const previous = feedback.openSession;
      const openIssues = (): void => {
        const url = `${MINKE_PROJECT_URL}/issues/new/choose`;
        const tabs = desktopTabsPort(browser);
        if (tabs.available) tabs.openExternal(url);
        else browser.open(url, "_blank", "noopener,noreferrer");
      };
      feedback.openSession = openIssues;
      return () => {
        if (feedback.openSession === openIssues) feedback.openSession = previous;
      };
    }, "minke-overlay: feedback destination");
  });
}
