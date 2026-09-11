import { useId, useSyncExternalStore, type ReactNode } from "react";
import { formatShortcutBinding } from "../../shortcuts/binding.ts";
import type { TabCreateShortcutBindings } from "../create-shortcuts.ts";
import type { TabsTranslate } from "../locales.ts";
import type { TabRendererRegistry } from "../registry.ts";
import type { NativeTabInfo, NativeTabRegistry } from "./contract.ts";
import type { NativeTabsRuntime } from "./runtime.ts";

interface NativeTabGuideProps {
  native: NativeTabsRuntime;
  registry: NativeTabRegistry;
  renderers: TabRendererRegistry;
  createShortcuts: TabCreateShortcutBindings;
  currentCwd(): string | undefined;
  useTabInfo(): NativeTabInfo;
  t: TabsTranslate;
}

/** The native Start page uses the same creation actions as Minke shortcuts. */
export function NativeTabGuide({ native, registry, renderers, createShortcuts, currentCwd, useTabInfo, t }: NativeTabGuideProps): ReactNode {
  const titleId = useId();
  useSyncExternalStore(renderers.subscribe, renderers.getSnapshot, renderers.getSnapshot);
  useSyncExternalStore(createShortcuts.subscribe, createShortcuts.getSnapshot, createShortcuts.getSnapshot);
  const registeredEntries = useSyncExternalStore(
    listener => registry.subscribe(listener), () => registry.guide(), () => registry.guide(),
  );
  const { tab } = useTabInfo();
  const options = renderers.creators();
  const entries = registeredEntries.filter(entry => entry.kind !== "minke.launcher");
  if (options.length === 0) return null;
  return <div className="minke-tabs-empty minke-tabs-native-guide" role="group" aria-label={t("panel.create")}>
    <div className="minke-tabs-native-guide__content">
      {entries.length > 0 && <div className="minke-tabs-native-guide__defaults">
        {entries.map((entry, index) => {
          const Icon = entry.icon;
          return <button type="button" key={`${entry.kind}:${index}`} className="minke-tabs-empty__option"
            data-sidebar-right-guide-entry={entry.kind}
            onClick={() => tab.actions.openTab(entry.kind, { replaceTab: true })}>
            {Icon && <span className="minke-tabs-empty__icon" aria-hidden="true"><Icon size={16} /></span>}
            <span className="minke-tabs-empty__label">{entry.title()}</span>
          </button>;
        })}
      </div>}
      <section className="minke-tabs-native-guide__section" aria-labelledby={titleId}>
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
      </section>
    </div>
  </div>;
}
