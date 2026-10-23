/** 16 px stroke icons for the editor toolbar, drawn on a 16-unit grid. */
const PATHS = {
  play: <path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />,
  stop: <rect x="4" y="4" width="8" height="8" fill="currentColor" stroke="none" />,
  zoomIn: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2 14 14M5 7h4M7 5v4" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2 14 14M5 7h4" />
    </>
  ),
  zoomSel: <path d="M2 3v10M14 3v10M4.5 8h7M4.5 8l2-2M4.5 8l2 2M11.5 8l-2-2M11.5 8l-2 2" />,
  zoomAll: <path d="M2 3v10M14 3v10M5 5.5h6M5 8h6M5 10.5h6" />,
  select: <path d="M4 2.5v10l2.6-2.4 1.9 4 1.6-.8-1.9-3.9H12z" strokeLinejoin="round" />,
  ellipse: <ellipse cx="8" cy="8" rx="6" ry="4.25" />,
  rect: <rect x="2.5" y="4" width="11" height="8" />,
  arrow: <path d="M3 13 13 3M7 3h6v6" />,
  pen: <path d="M2.5 11.5c2-4 3.5-4.5 4.5-2s2.5 2 4-1 2-3.5 2.5-4" />,
  text: <path d="M3.5 3.5h9M8 3.5v9.5M6 13h4" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The Annotino mark: an interval tier with its middle interval selected. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="6.5" width="7" height="11" fill="#1e4a72" />
      <rect x="1.75" y="6.5" width="20.5" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 3v18M16 3v18" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
