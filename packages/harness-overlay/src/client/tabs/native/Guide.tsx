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
      <span className="minke-tabs-native-guide__hero" aria-hidden="true">
        <svg width="56" height="56" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
          <path d="M 10.9 5.1 L 9.1 9.1 L 5.1 10.9 L 6.9 6.9 Z" fill="currentColor" />
        </svg>
      </span>
      {entries.length > 0 && <div className="minke-tabs-native-guide__defaults">
        {entries.map((entry, index) => {
          const Icon = entry.icon;
          const description = entries.length <= 4 ? entry.description?.() : undefined;
          const iconSize = description === undefined ? 22 : 26;
          return <button type="button" key={`${entry.kind}:${index}`} className="minke-tabs-empty__option"
            data-sidebar-right-guide-entry={entry.kind}
            onClick={() => tab.actions.openTab(entry.kind, { replaceTab: true })}>
            <span className="minke-tabs-empty__icon" aria-hidden="true">
              {Icon ? <Icon size={iconSize} /> :
                <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none" className="minke-tabs-native-guide__placeholder">
                  <path d="M 8 2.5 L 12.9 5.2 V 10.8 L 8 13.5 L 3.1 10.8 V 5.2 Z M 3.1 5.2 L 8 7.9 L 12.9 5.2 M 8 7.9 V 13.5"
                    stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round" />
                </svg>}
            </span>
            <span className="minke-tabs-native-guide__text">
              <span className="minke-tabs-empty__label">{entry.title()}</span>
              {description !== undefined && <span className="minke-tabs-native-guide__description">{description}</span>}
            </span>
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
