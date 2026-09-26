import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import TERMINAL_TAB_STYLES from "./styles.css";

export { TERMINAL_TAB_STYLES };

/** DSH owns terminal chrome and xterm styles; Minke supplies placement only. */
export const installTerminalTabStyles = defineOverlayStyle(
  "tabs-terminal",
  TERMINAL_TAB_STYLES,
);
