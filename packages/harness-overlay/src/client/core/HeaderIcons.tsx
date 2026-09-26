import type { ReactNode } from "react";

// Match rc.2's IconPanelLeftOutlineRegular and native split control: a
// one-unit stroke with small corners, on the same inset 16 × 16 canvas.
const DSH_FRAME_PATH =
  "M13.5 1.5H2.5C1.94772 1.5 1.5 1.94772 1.5 2.5V13.5C1.5 14.0523 1.94772 14.5 2.5 14.5H13.5C14.0523 14.5 14.5 14.0523 14.5 13.5V2.5C14.5 1.94772 14.0523 1.5 13.5 1.5Z";

function HeaderIcon({ children }: { children: ReactNode }): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={15}
      height={15}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function Frame(): ReactNode {
  return <path d={DSH_FRAME_PATH} />;
}

export function PanelHeaderIcon({ placement }: { placement: "bottom" | "right" }): ReactNode {
  return (
    <HeaderIcon>
      <Frame />
      <path d={placement === "right" ? "M10.5 1.5V14.5" : "M1.5 10.5H14.5"} />
    </HeaderIcon>
  );
}

export function RemoteHeaderIcon(): ReactNode {
  return (
    <HeaderIcon>
      <Frame />
      <g data-minke-remote-hub-indicator stroke="currentColor">
        <path
          d="M4.5 5.25A6 6 0 0 1 10.5 11.25M4.5 8.25A3 3 0 0 1 7.5 11.25"
          strokeLinecap="round"
        />
        <circle cx={4.5} cy={11.25} r={0.5} fill="currentColor" stroke="none" />
      </g>
    </HeaderIcon>
  );
}
