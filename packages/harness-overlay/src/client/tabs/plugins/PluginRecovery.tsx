import { useEffect, useState, type ReactNode } from "react";
import type { PluginRecoveryPort } from "../../desktop/contracts.ts";
import { PluginPowerIcon } from "./icons.tsx";
import type { PluginsTranslate } from "./locales.ts";

interface PluginRecoveryProps {
  recovery: PluginRecoveryPort;
  t: PluginsTranslate;
  view: "summary" | "page";
}

/** Recovery is a desktop restart operation; DSH owns ordinary plugin switches. */
export function PluginRecovery({ recovery, t, view }: PluginRecoveryProps): ReactNode {
  const [safeMode, setSafeMode] = useState<boolean>();
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void recovery.readSettings().then(settings => {
      if (active) setSafeMode(settings.safeMode);
    }, failure => {
      if (active) setError(String(failure));
    });
    return () => { active = false; };
  }, [recovery]);
  const toggle = async (): Promise<void> => {
    if (safeMode === undefined || changing) return;
    setChanging(true);
    setError(undefined);
    try { await recovery.setSafeMode(!safeMode); }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setChanging(false);
    }
  };
  if (view === "summary") return error ?? t(safeMode ? "plugins.safeModeActive" : "plugins.recovery.description");
  return <div className="minke-plugin-recovery">
    <button type="button" disabled={safeMode === undefined || changing} onClick={() => void toggle()}>
      <PluginPowerIcon />
      {t(changing ? "plugins.restarting" : safeMode ? "plugins.exitSafeMode" : "plugins.enterSafeMode")}
    </button>
    {safeMode && <span role="status">{t("plugins.safeModeActive")}</span>}
    {error && <span role="alert">{error}</span>}
  </div>;
}
