import assert from "node:assert/strict";
import test from "node:test";
import {
  act,
  createElement,
} from "react";
import {
  JSDOM,
} from "../vendor/deepseek-harness/node_modules/jsdom/lib/api.js";
import {
  TabsHeaderAction,
  NewSessionTabsHeaderAction,
} from "@minke/harness-overlay/client/tabs/HeaderActions.ts";
import {
  createBottomTabsToggle,
} from "@minke/harness-overlay/client/tabs/bottom-toggle.ts";
import {
  tabsEn,
} from "@minke/harness-overlay/client/tabs/locales.ts";
import {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";

async function withBrowserGlobals(dom, callback) {
  const values = {
    document: dom.window.document,
    Event: dom.window.Event,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    window: dom.window,
  };
  const descriptors = new Map(
    Object.keys(values).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        value,
        writable: true,
      });
    }
    await callback();
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor === undefined) {
        delete globalThis[key];
      } else {
        Object.defineProperty(globalThis, key, descriptor);
      }
    }
  }
}

test("the empty bottom Tabs action opens a Terminal directly", async () => {
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div>',
    { pretendToBeVisual: true },
  );
  try {
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const bottom = new TabsRuntime({
        showPanel() {},
        hidePanel() {},
      }, {
        idPrefix: "bottom-",
      });
      const right = new TabsRuntime({
        showPanel() {},
        hidePanel() {},
      });
      let defaultOpens = 0;
      let cwd = "/workspace/one";
      const toggleBottom = createBottomTabsToggle({
        runtime: bottom,
        defaultTitle: () => "Terminal",
        terminal: {
          create(title) {
            defaultOpens += 1;
            return bottom.open({
              kind: "terminal",
              key: `terminal-${String(defaultOpens)}`,
              title,
              payload: { cwd },
            });
          },
        },
      });
      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(
            createElement(TabsHeaderAction, {
              runtimes: { bottom, right, toggleBottom },
              t: (key) => tabsEn[key],
            }),
          );
        });
        const button = container.querySelector(
          '[data-minke-tabs-placement="bottom"]',
        );
        assert.ok(button instanceof dom.window.HTMLButtonElement);

        await act(async () => {
          button.click();
        });
        assert.equal(defaultOpens, 1);
        assert.equal(bottom.getSnapshot().visible, true);
        assert.deepEqual(
          bottom.getSnapshot().tabs.map(({ kind, payload }) => ({
            kind,
            cwd: payload.cwd,
          })),
          [{ kind: "terminal", cwd: "/workspace/one" }],
        );

        await act(async () => {
          button.click();
        });
        assert.equal(defaultOpens, 1);
        assert.equal(bottom.getSnapshot().visible, false);

        await act(async () => {
          bottom.close(bottom.getSnapshot().tabs[0].id);
        });
        cwd = "/workspace/two";
        await act(async () => {
          button.click();
        });
        assert.equal(defaultOpens, 2);
        assert.equal(bottom.getSnapshot().visible, true);
        assert.equal(
          bottom.getSnapshot().tabs[0].payload.cwd,
          "/workspace/two",
        );
      } finally {
        await act(async () => {
          root.unmount();
        });
        bottom.dispose();
        right.dispose();
      }
    });
  } finally {
    dom.window.close();
  }
});

test("blank Sessions leave the Sidebar opener to DSH in both open and collapsed states", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  try {
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const bottom = new TabsRuntime({ showPanel() {}, hidePanel() {} });
      const right = new TabsRuntime({ showPanel() {}, hidePanel() {} });
      const native = { connected: true, active: true, subscribe: () => () => {}, getSnapshot: () => 0 };
      const root = createRoot(dom.window.document.getElementById("root"));
      const rightButton = () => dom.window.document.querySelector('[data-minke-tabs-placement="right"]');
      try {
        await act(async () => root.render(createElement(NewSessionTabsHeaderAction, {
          native, runtimes: { bottom, right }, t: key => tabsEn[key],
          useSessions: selector => selector({ byId: { blank: { blank: true, retainedBy: { mainView: 1 } } } }),
        })));
        assert.equal(rightButton(), null, "DSH already renders an expand button in the blank Session header");
        await act(async () => right.show());
        assert.equal(right.getSnapshot().visible, true);
        assert.equal(rightButton(), null, "DSH owns the expanded Sidebar's collapse control");
        assert.equal(dom.window.document.querySelector('[data-minke-new-session-tabs-action]').dataset.nativeSidebar, "open");
        assert.ok(dom.window.document.querySelector('[data-minke-tabs-placement="bottom"]'));
        await act(async () => right.hide());
        assert.equal(rightButton(), null, "collapsing the Sidebar must not add a duplicate opener");
      } finally {
        await act(async () => root.unmount());
        bottom.dispose();
        right.dispose();
      }
    });
  } finally { dom.window.close(); }
});

test("global pages reopen DSH Start even when the retained Session is not blank", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  try {
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const bottom = new TabsRuntime({ showPanel() {}, hidePanel() {} });
      const hostEvents = [];
      const right = new TabsRuntime({ showPanel() { hostEvents.push("show"); }, hidePanel() { hostEvents.push("hide"); } });
      right.show();
      hostEvents.length = 0;
      const opened = [];
      const native = {
        connected: true, active: false, subscribe: () => () => {}, getSnapshot: () => 0,
        openNative(kind) { opened.push(kind); },
      };
      const root = createRoot(dom.window.document.getElementById("root"));
      try {
        for (const blank of [false, true]) {
          await act(async () => root.render(createElement(NewSessionTabsHeaderAction, {
            native, runtimes: { bottom, right }, t: key => tabsEn[key],
            useSessions: selector => selector({ byId: { retained: { blank, retainedBy: { mainView: 1 } } } }),
          })));
          const opener = dom.window.document.querySelector('[data-minke-tabs-placement="right"]');
          assert.ok(opener, "a non-conversation page keeps an entry back to the native Sidebar");
          assert.equal(opener.getAttribute("aria-expanded"), "false", "a hidden native seat is not an open legacy panel");
          assert.equal(opener.getAttribute("aria-controls"), null, "the native opener must not target the hidden fallback panel");
          await act(async () => opener.click());
        }
        assert.deepEqual(opened, ["guide", "guide"]);
        assert.deepEqual(hostEvents, [], "opening DSH must not toggle the legacy host");
      } finally {
        await act(async () => root.unmount());
        bottom.dispose();
        right.dispose();
      }
    });
  } finally { dom.window.close(); }
});
