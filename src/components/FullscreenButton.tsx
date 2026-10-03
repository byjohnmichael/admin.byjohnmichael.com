"use client";

import { useSyncExternalStore } from "react";

// Safari on iPad still only ships the webkit-prefixed Fullscreen API.
type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};
type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
};

function fullscreenElement(): Element | null {
  const doc = document as WebkitDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function subscribe(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  document.addEventListener("webkitfullscreenchange", onChange);
  return () => {
    document.removeEventListener("fullscreenchange", onChange);
    document.removeEventListener("webkitfullscreenchange", onChange);
  };
}

function isSupported(): boolean {
  const doc = document as WebkitDocument;
  return Boolean(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled);
}

/** Toggles the whole page in and out of browser fullscreen. Hidden where the
 *  browser can't do it (e.g. iPhone Safari). */
export default function FullscreenButton() {
  // server render: no button, so hydration matches whatever the browser says
  const supported = useSyncExternalStore(subscribe, isSupported, () => false);
  const active = useSyncExternalStore(
    subscribe,
    () => fullscreenElement() !== null,
    () => false,
  );

  async function toggle() {
    const doc = document as WebkitDocument;
    const root = document.documentElement as WebkitElement;
    try {
      if (fullscreenElement()) {
        await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
      } else {
        await (root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.());
      }
    } catch {
      // the browser refused (e.g. blocked by a permissions policy) — nothing to do
    }
  }

  if (!supported) return null;

  const label = active ? "exit fullscreen" : "fullscreen";
  return (
    <button
      type="button"
      onClick={toggle}
      className="btn btn-ghost btn-icon tap"
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      <svg
        viewBox="0 0 16 16"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="square"
        aria-hidden
      >
        {active ? (
          // corners pointing in
          <path d="M6 1.5V6H1.5M10 1.5V6h4.5M6 14.5V10H1.5M10 14.5V10h4.5" />
        ) : (
          // corners pointing out
          <path d="M1.5 6V1.5H6M14.5 6V1.5H10M1.5 10v4.5H6M14.5 10v4.5H10" />
        )}
      </svg>
    </button>
  );
}

// byjohnmichael*
