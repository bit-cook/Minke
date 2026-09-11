import { useEffect, useState, type ReactNode } from "react";
import { WebIcon } from "./icons.tsx";

export function WebTabIcon({
  faviconUrl,
  loading = false,
}: {
  readonly faviconUrl?: string;
  readonly loading?: boolean;
}): ReactNode {
  const [displayedUrl, setDisplayedUrl] = useState<string>();
  const [failedUrl, setFailedUrl] = useState<string>();

  useEffect(() => {
    if (faviconUrl === undefined) {
      setFailedUrl(undefined);
      if (!loading) setDisplayedUrl(undefined);
      return;
    }
    if (!loading && faviconUrl === failedUrl) {
      setDisplayedUrl(undefined);
    }
  }, [failedUrl, faviconUrl, loading]);

  const pendingUrl =
    faviconUrl !== undefined &&
    faviconUrl !== displayedUrl &&
    faviconUrl !== failedUrl
      ? faviconUrl
      : undefined;
  const busy = loading || pendingUrl !== undefined;

  return (
    <span
      className="minke-tab__favicon-shell"
      data-loading={busy || undefined}
      aria-hidden="true"
    >
      {displayedUrl === undefined
        ? (
          <span className="minke-tab__favicon-fallback">
            <WebIcon size={12} />
          </span>
        )
        : (
          <img
            key={displayedUrl}
            className="minke-tab__favicon"
            src={displayedUrl}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
            onError={() => {
              setFailedUrl(displayedUrl);
              setDisplayedUrl(undefined);
            }}
          />
        )}
      {pendingUrl !== undefined && (
        <img
          className="minke-tab__favicon-preload"
          src={pendingUrl}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={() => {
            setDisplayedUrl(pendingUrl);
            setFailedUrl(undefined);
          }}
          onError={() => setFailedUrl(pendingUrl)}
        />
      )}
    </span>
  );
}
