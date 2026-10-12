import React from "react";
import "./emptyArt.css";

// Small scenes for empty pages, in the onboarding's style: theme colours for
// paper and ink, fixed colours for covers and highlights, a gentle float.

const Defs = () => (
  <defs>
    <linearGradient id="ea-indigo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#6d7cf6" />
      <stop offset="1" stopColor="#3b48b8" />
    </linearGradient>
    <linearGradient id="ea-amber" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#ffcf6b" />
      <stop offset="1" stopColor="#f08a3c" />
    </linearGradient>
    <linearGradient id="ea-rose" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#ff8fab" />
      <stop offset="1" stopColor="#d9467a" />
    </linearGradient>
    <linearGradient id="ea-teal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#5fe0c8" />
      <stop offset="1" stopColor="#1f9c8f" />
    </linearGradient>
    <radialGradient id="ea-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stopColor="var(--accent)" stopOpacity="0.24" />
      <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
    </radialGradient>
    <filter id="ea-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#000" floodOpacity="0.16" />
    </filter>
  </defs>
);

const Spark = ({ x, y, s = 7, d = "" }: { x: number; y: number; s?: number; d?: string }) => (
  <path
    className={"ea-twinkle " + d}
    style={{ transformOrigin: `${x}px ${y}px` }}
    d={`M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`}
    fill="var(--accent)"
  />
);

// Paper with lines; `marks` colours some of them like highlights
const Page = ({ x, y, w, h, marks = [] as string[] }: { x: number; y: number; w: number; h: number; marks?: string[] }) => (
  <g filter="url(#ea-shadow)">
    <rect x={x} y={y} width={w} height={h} rx="10" fill="var(--surface-raised)" />
    {[0, 1, 2, 3, 4].map((i) => {
      const ly = y + 18 + i * 14;
      if (ly > y + h - 12) return null;
      const lw = (w - 28) * (i % 2 ? 0.8 : 1);
      return (
        <g key={i}>
          {marks[i] && (
            <rect x={x + 12} y={ly - 4} width={lw + 4} height="11" rx="3" fill={marks[i]} opacity="0.55" className="ea-mark" style={{ animationDelay: `${0.3 + i * 0.12}s` }} />
          )}
          <rect x={x + 14} y={ly} width={lw} height="4" rx="2" fill="var(--text)" opacity="0.22" />
        </g>
      );
    })}
  </g>
);

const scenes: Record<string, () => JSX.Element> = {
  // Library: an empty shelf waiting, a book about to land on it
  home: () => (
    <>
      <rect x="40" y="132" width="160" height="6" rx="3" fill="var(--border-strong)" />
      <g className="ea-float">
        <g filter="url(#ea-shadow)" transform="rotate(-8 118 92)">
          <rect x="98" y="46" width="42" height="64" rx="6" fill="url(#ea-amber)" />
          <rect x="98" y="46" width="7" height="64" rx="3" fill="#000" opacity="0.12" />
          <rect x="110" y="60" width="22" height="4" rx="2" fill="#fff" opacity="0.9" />
          <rect x="110" y="68" width="14" height="4" rx="2" fill="#fff" opacity="0.7" />
        </g>
      </g>
      <g className="ea-pop">
        <circle cx="166" cy="56" r="14" fill="var(--accent)" />
        <path d="M166 49v14M159 56h14" stroke="var(--on-accent)" strokeWidth="3" strokeLinecap="round" />
      </g>
      <rect x="62" y="104" width="16" height="28" rx="3" fill="var(--border-strong)" opacity="0.6" />
      <rect x="160" y="110" width="14" height="22" rx="3" fill="var(--border-strong)" opacity="0.45" />
      <Spark x={60} y={64} d="ea-d1" />
      <Spark x={194} y={98} s={5} d="ea-d2" />
    </>
  ),
  // Favorites: a book with a heart floating up
  favorite: () => (
    <>
      <g className="ea-float ea-d2" filter="url(#ea-shadow)">
        <rect x="88" y="54" width="58" height="84" rx="7" fill="url(#ea-rose)" />
        <rect x="88" y="54" width="9" height="84" rx="4" fill="#000" opacity="0.12" />
        <rect x="104" y="72" width="30" height="5" rx="2.5" fill="#fff" opacity="0.9" />
        <rect x="104" y="81" width="20" height="4" rx="2" fill="#fff" opacity="0.7" />
      </g>
      <g className="ea-heart">
        <path d="M160 70c-6-10-22-6-18 6 2 6 12 12 18 16 6-4 16-10 18-16 4-12-12-16-18-6z" fill="url(#ea-rose)" filter="url(#ea-shadow)" />
      </g>
      <Spark x={70} y={70} d="ea-d1" />
      <Spark x={184} y={112} s={5} d="ea-d3" />
    </>
  ),
  // Bookmarks: a page with a ribbon dropping in
  bookmark: () => (
    <>
      <g className="ea-float"><Page x={76} y={40} w={88} h={104} /></g>
      <g className="ea-drop">
        <path d="M140 30h18v40l-9-7-9 7z" fill="url(#ea-indigo)" filter="url(#ea-shadow)" />
      </g>
      <Spark x={60} y={60} d="ea-d2" />
      <Spark x={186} y={118} s={5} d="ea-d1" />
    </>
  ),
  // Notes: a note card and a pen writing
  note: () => (
    <>
      <g className="ea-float"><Page x={62} y={44} w={92} h={98} /></g>
      <g className="ea-float ea-d3" filter="url(#ea-shadow)">
        <rect x="128" y="76" width="64" height="52" rx="9" fill="url(#ea-amber)" />
        <rect x="138" y="90" width="40" height="4" rx="2" fill="#fff" opacity="0.9" />
        <rect x="138" y="99" width="30" height="4" rx="2" fill="#fff" opacity="0.75" />
        <rect x="138" y="108" width="36" height="4" rx="2" fill="#fff" opacity="0.6" />
      </g>
      <path d="M150 146c8-6 14-10 20-6s-2 10 4 10 10-6 16-10" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" className="ea-draw" />
      <Spark x={52} y={58} d="ea-d1" />
    </>
  ),
  // Highlights: lines lighting up in colour
  highlight: () => (
    <>
      <g className="ea-float"><Page x={66} y={34} w={108} h={112} marks={["#f6c453", "", "#7ee0c9", "", "#ff9fbd"]} /></g>
      <g className="ea-float ea-d2" transform="rotate(32 178 66)">
        <rect x="170" y="36" width="16" height="50" rx="4" fill="url(#ea-amber)" filter="url(#ea-shadow)" />
        <path d="M170 86h16l-4 10h-8z" fill="#f6c453" />
      </g>
      <Spark x={52} y={56} d="ea-d3" />
    </>
  ),
  // Shelf: two boards, ready for books
  shelf: () => (
    <>
      <g filter="url(#ea-shadow)">
        <rect x="54" y="40" width="132" height="104" rx="12" fill="var(--surface-raised)" />
      </g>
      <rect x="64" y="86" width="112" height="5" rx="2.5" fill="var(--border-strong)" />
      <rect x="64" y="128" width="112" height="5" rx="2.5" fill="var(--border-strong)" />
      <g className="ea-float ea-d1">
        <rect x="76" y="54" width="14" height="32" rx="3" fill="url(#ea-indigo)" />
        <rect x="93" y="60" width="12" height="26" rx="3" fill="url(#ea-teal)" />
      </g>
      <g className="ea-pop">
        <circle cx="140" cy="108" r="12" fill="var(--accent)" />
        <path d="M140 102v12M134 108h12" stroke="var(--on-accent)" strokeWidth="2.6" strokeLinecap="round" />
      </g>
      <Spark x={196} y={52} d="ea-d2" />
    </>
  ),
  // Trash: an empty bin, nothing to worry about
  trash: () => (
    <>
      <g className="ea-float" filter="url(#ea-shadow)">
        <rect x="88" y="62" width="64" height="78" rx="10" fill="var(--surface-raised)" />
        <rect x="80" y="50" width="80" height="12" rx="6" fill="var(--border-strong)" />
        <rect x="108" y="42" width="24" height="10" rx="5" fill="var(--border-strong)" />
        <rect x="104" y="76" width="5" height="50" rx="2.5" fill="var(--text)" opacity="0.14" />
        <rect x="118" y="76" width="5" height="50" rx="2.5" fill="var(--text)" opacity="0.14" />
        <rect x="132" y="76" width="5" height="50" rx="2.5" fill="var(--text)" opacity="0.14" />
      </g>
      <g className="ea-pop">
        <circle cx="160" cy="58" r="11" fill="var(--success)" />
        <path d="M155 58l3.5 3.5 6.5-7" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <Spark x={66} y={72} d="ea-d1" />
      <Spark x={182} y={118} s={5} d="ea-d3" />
    </>
  ),
  // Search and filters: a magnifier finding nothing
  search: () => (
    <>
      <g className="ea-float"><Page x={70} y={44} w={86} h={96} /></g>
      <g className="ea-search" filter="url(#ea-shadow)">
        <circle cx="150" cy="88" r="22" fill="var(--surface-raised)" stroke="var(--accent)" strokeWidth="6" />
        <path d="M166 104l18 18" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round" />
      </g>
      <Spark x={58} y={60} d="ea-d2" />
    </>
  ),
};

const EmptyArt = ({ mode }: { mode: string }) => {
  const Scene = scenes[mode] || scenes.home;
  return (
    <svg viewBox="0 0 240 180" className="empty-art" aria-hidden="true">
      <Defs />
      <circle cx="120" cy="92" r="84" fill="url(#ea-glow)" />
      <Scene />
    </svg>
  );
};

export default EmptyArt;
