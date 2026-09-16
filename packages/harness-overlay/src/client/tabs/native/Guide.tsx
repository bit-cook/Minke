import { useEffect, useId, useSyncExternalStore, type ReactNode } from "react";
import { formatShortcutBinding } from "../../shortcuts/binding.ts";
import type { TabCreateShortcutBindings } from "../create-shortcuts.ts";
import type { TabRendererRegistry } from "../registry.ts";
import type { NativeTabInfo } from "./contract.ts";
import type { NativeTabsRuntime } from "./runtime.ts";

interface NativeTabGuideProps {
  native: NativeTabsRuntime;
  renderers: TabRendererRegistry;
  createShortcuts: TabCreateShortcutBindings;
  currentCwd(): string | undefined;
  useTabInfo(): NativeTabInfo;
}

/** Minke cards compose below the native guide entries without replacing them. */
export function NativeTabGuide({ native, renderers, createShortcuts, currentCwd, useTabInfo }: NativeTabGuideProps): ReactNode {
  const titleId = useId();
  useSyncExternalStore(renderers.subscribe, renderers.getSnapshot, renderers.getSnapshot);
  useSyncExternalStore(createShortcuts.subscribe, createShortcuts.getSnapshot, createShortcuts.getSnapshot);
  const { tab } = useTabInfo();
  const options = renderers.creators();
  if (options.length === 0) return null;
  return <section className="minke-tabs-native-guide__section" aria-labelledby={titleId}>
    <h2 id={titleId} className="minke-tabs-native-guide__heading">Minke</h2>
    <ul className="minke-tabs-empty__options">
      {options.map(option => {
        const binding = createShortcuts.binding("right", option.id);
        return <li key={option.id}>
          <button type="button" className="minke-tabs-empty__option" data-option={option.id}
            onClick={() => native.createAt(tab.id, () => option.create({ cwd: currentCwd() }))}>
            <span className="minke-tabs-empty__icon" aria-hidden="true">{option.icon}</span>
            <span className="minke-tabs-empty__label">{option.label}</span>
            {binding && <kbd className="minke-tabs-native-guide__shortcut">{formatShortcutBinding(binding, createShortcuts.platform)}</kbd>}
          </button>
        </li>;
      })}
    </ul>
  </section>;
}

/** Restore persisted launcher tabs to the current native Start page. */
export function LegacyNativeTabGuide({ useTabInfo }: { useTabInfo(): NativeTabInfo }): ReactNode {
  const { tab } = useTabInfo();
  useEffect(() => { tab.actions.openTab("guide", { replaceTab: true }); }, [tab.id]);
  return null;
}
