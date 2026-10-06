import React from "react";

// The onboarding scenes. Pages, cards and ink use the theme's colours, so
// they follow light and dark; book covers and highlights keep their own.
// Moving parts carry ob-* classes animated in onboarding.css.

const Defs = () => (
  <defs>
    <linearGradient id="ob-cover-indigo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#6d7cf6" />
      <stop offset="1" stopColor="#3b48b8" />
    </linearGradient>
    <linearGradient id="ob-cover-amber" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#ffcf6b" />
      <stop offset="1" stopColor="#f08a3c" />
    </linearGradient>
    <linearGradient id="ob-cover-rose" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#ff8fab" />
      <stop offset="1" stopColor="#d9467a" />
    </linearGradient>
    <linearGradient id="ob-cover-teal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#5fe0c8" />
      <stop offset="1" stopColor="#1f9c8f" />
    </linearGradient>
    <radialGradient id="ob-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
      <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
    </radialGradient>
    <filter id="ob-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="8" stdDeviation="9" floodColor="#000" floodOpacity="0.16" />
    </filter>
  </defs>
);

const Sparkle = ({ x, y, size = 10, className = "" }: { x: number; y: number; size?: number; className?: string }) => (
  <path
    className={"ob-twinkle " + className}
    style={{ transformOrigin: `${x}px ${y}px` }}
    d={`M${x} ${y - size}C${x + size * 0.15} ${y - size * 0.15} ${x + size * 0.15} ${y - size * 0.15} ${x + size} ${y}C${x + size * 0.15} ${y + size * 0.15} ${x + size * 0.15} ${y + size * 0.15} ${x} ${y + size}C${x - size * 0.15} ${y + size * 0.15} ${x - size * 0.15} ${y + size * 0.15} ${x - size} ${y}C${x - size * 0.15} ${y - size * 0.15} ${x - size * 0.15} ${y - size * 0.15} ${x} ${y - size}Z`}
    fill="var(--accent)"
  />
);

// Title and author lines on a cover
const CoverText = ({ x, y, w }: { x: number; y: number; w: number }) => (
  <g fill="#fff">
    <rect x={x} y={y} width={w} height="6" rx="3" opacity="0.92" />
    <rect x={x} y={y + 11} width={w * 0.62} height="6" rx="3" opacity="0.92" />
    <rect x={x} y={y + 28} width={w * 0.4} height="4" rx="2" opacity="0.6" />
  </g>
);

export const LibraryScene = () => (
  <svg viewBox="0 0 320 260" className="ob-art" aria-hidden="true">
    <Defs />
    <circle cx="160" cy="138" r="118" fill="url(#ob-glow)" />
    <rect x="58" y="200" width="204" height="7" rx="3.5" fill="var(--border-strong)" />
    <g className="ob-float ob-d2">
      <g transform="rotate(-9 108 200)" filter="url(#ob-shadow)">
        <rect x="76" y="96" width="60" height="104" rx="7" fill="url(#ob-cover-indigo)" />
        <rect x="76" y="96" width="9" height="104" rx="4" fill="#000" opacity="0.14" />
        <CoverText x={92} y={114} w={34} />
      </g>
    </g>
    <g className="ob-float ob-d3">
      <g transform="rotate(7 214 200)" filter="url(#ob-shadow)">
        <rect x="188" y="102" width="56" height="98" rx="7" fill="url(#ob-cover-rose)" />
        <rect x="188" y="102" width="9" height="98" rx="4" fill="#000" opacity="0.14" />
        <CoverText x={203} y={120} w={30} />
      </g>
    </g>
    <g className="ob-float ob-d1" filter="url(#ob-shadow)">
      <rect x="128" y="66" width="66" height="134" rx="8" fill="url(#ob-cover-amber)" />
      <rect x="128" y="66" width="10" height="134" rx="5" fill="#000" opacity="0.12" />
      <circle cx="166" cy="104" r="15" fill="#fff" opacity="0.28" />
      <path d="M160 98h9l5 5v13a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2v-16a2 2 0 0 1 2-2z" fill="#fff" opacity="0.95" />
      <CoverText x={144} y={136} w={38} />
    </g>
    {/* Reading progress card */}
    <g className="ob-float ob-d4" filter="url(#ob-shadow)">
      <rect x="208" y="44" width="92" height="36" rx="18" fill="var(--surface-raised)" />
      <circle cx="226" cy="62" r="9" fill="none" stroke="var(--border-strong)" strokeWidth="3.5" />
      <circle cx="226" cy="62" r="9" fill="none" stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="56.5" strokeDashoffset="18" transform="rotate(-90 226 62)" className="ob-ring" />
      <rect x="242" y="55" width="44" height="5" rx="2.5" fill="var(--text)" opacity="0.7" />
      <rect x="242" y="65" width="28" height="4" rx="2" fill="var(--text)" opacity="0.3" />
    </g>
    <Sparkle x={58} y={70} size={9} className="ob-d1" />
    <Sparkle x={274} y={150} size={7} className="ob-d3" />
    <Sparkle x={40} y={150} size={5} className="ob-d2" />
  </svg>
);

// Lines of text on the page; some carry a highlight behind them
const pageLines = [
  { w: 132 },
  { w: 118, mark: "#f6c453" },
  { w: 126 },
  { w: 96 },
  { w: 130, mark: "#7ee0c9" },
  { w: 112 },
  { w: 124, mark: "#ff9fbd" },
  { w: 70 },
];

export const ReadingScene = () => (
  <svg viewBox="0 0 320 260" className="ob-art" aria-hidden="true">
    <Defs />
    <circle cx="160" cy="132" r="118" fill="url(#ob-glow)" />
    <g className="ob-float ob-d1" filter="url(#ob-shadow)">
      <rect x="78" y="34" width="164" height="200" rx="16" fill="var(--surface-raised)" />
      <rect x="98" y="54" width="70" height="8" rx="4" fill="var(--text)" opacity="0.75" />
      {pageLines.map((line, i) => (
        <g key={i}>
          {line.mark && (
            <rect
              x="94"
              y={76 + i * 18 - 4}
              width={line.w + 8}
              height="13"
              rx="4"
              fill={line.mark}
              opacity="0.55"
              className="ob-mark"
              style={{ animationDelay: `${0.4 + i * 0.12}s` }}
            />
          )}
          <rect x="98" y={76 + i * 18} width={line.w} height="5" rx="2.5" fill="var(--text)" opacity="0.22" />
        </g>
      ))}
    </g>
    {/* Pen drawing a note in the margin */}
    <path d="M206 214c10-8 18-14 26-10s-4 14 4 14 14-10 22-16" fill="none" stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round" className="ob-draw" />
    <g className="ob-pen">
      <g transform="rotate(38 262 192)">
        <rect x="256" y="140" width="12" height="52" rx="4" fill="var(--text)" />
        <rect x="256" y="140" width="12" height="10" rx="4" fill="var(--accent)" />
        <path d="M256 192h12l-6 12z" fill="var(--text)" opacity="0.8" />
      </g>
    </g>
    {/* Text size and theme */}
    <g className="ob-float ob-d3" filter="url(#ob-shadow)">
      <rect x="22" y="70" width="70" height="40" rx="20" fill="var(--surface-raised)" />
      <text x="40" y="97" fontFamily="Newsreader, Georgia, serif" fontSize="20" fill="var(--text)">A</text>
      <text x="57" y="97" fontFamily="Newsreader, Georgia, serif" fontSize="14" fill="var(--muted)">a</text>
      <rect x="70" y="84" width="10" height="12" rx="3" fill="var(--accent)" opacity="0.9" />
    </g>
    <g className="ob-float ob-d2" filter="url(#ob-shadow)">
      <rect x="236" y="56" width="74" height="34" rx="17" fill="var(--surface-raised)" />
      <circle cx="254" cy="73" r="8" fill="#fbfaf7" stroke="var(--border-strong)" />
      <circle cx="273" cy="73" r="8" fill="#f1e3c6" />
      <circle cx="292" cy="73" r="8" fill="#2a2a28" stroke="var(--border-strong)" />
    </g>
    <Sparkle x={60} y={190} size={8} className="ob-d2" />
  </svg>
);

const waveBars = [14, 26, 40, 22, 34, 18, 30, 12];

export const ListenScene = () => (
  <svg viewBox="0 0 320 260" className="ob-art" aria-hidden="true">
    <Defs />
    <circle cx="160" cy="140" r="118" fill="url(#ob-glow)" />
    {/* Voice: play button between two sound waves */}
    {waveBars.map((h, i) => (
      <rect
        key={"l" + i}
        x={56 + i * 9}
        y={172 - h / 2}
        width="5"
        height={h}
        rx="2.5"
        fill="var(--accent)"
        opacity={0.35 + (i / waveBars.length) * 0.5}
        className="ob-wave"
        style={{ animationDelay: `${i * 0.11}s`, transformOrigin: `${58 + i * 9}px 172px` }}
      />
    ))}
    {waveBars.map((h, i) => (
      <rect
        key={"r" + i}
        x={196 + i * 9}
        y={172 - waveBars[waveBars.length - 1 - i] / 2}
        width="5"
        height={waveBars[waveBars.length - 1 - i]}
        rx="2.5"
        fill="var(--accent)"
        opacity={0.85 - (i / waveBars.length) * 0.5}
        className="ob-wave"
        style={{ animationDelay: `${(waveBars.length - i) * 0.11}s`, transformOrigin: `${198 + i * 9}px 172px` }}
      />
    ))}
    <g filter="url(#ob-shadow)">
      <circle cx="160" cy="172" r="34" fill="var(--accent)" className="ob-pulse" style={{ transformOrigin: "160px 172px" }} />
      <path d="M152 158v28l23-14z" fill="var(--on-accent)" />
    </g>
    {/* The assistant explaining a passage */}
    <g className="ob-float ob-d2" filter="url(#ob-shadow)">
      <path d="M86 34h148a14 14 0 0 1 14 14v42a14 14 0 0 1-14 14H120l-16 14v-14H86a14 14 0 0 1-14-14V48a14 14 0 0 1 14-14z" fill="var(--surface-raised)" />
      <rect x="88" y="50" width="26" height="26" rx="9" fill="url(#ob-cover-indigo)" />
      <path d="M101 55c1 6 2 7 8 8-6 1-7 2-8 8-1-6-2-7-8-8 6-1 7-2 8-8z" fill="#fff" />
      <rect x="124" y="52" width="104" height="6" rx="3" fill="var(--text)" opacity="0.6" />
      <rect x="124" y="64" width="84" height="5" rx="2.5" fill="var(--text)" opacity="0.25" />
      <rect x="124" y="75" width="94" height="5" rx="2.5" fill="var(--text)" opacity="0.25" />
      <rect x="88" y="86" width="60" height="5" rx="2.5" fill="var(--text)" opacity="0.18" className="ob-typing" />
    </g>
    {/* Translation */}
    <g className="ob-float ob-d4" filter="url(#ob-shadow)">
      <rect x="226" y="108" width="74" height="34" rx="17" fill="url(#ob-cover-teal)" />
      <text x="240" y="131" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="15" fill="#fff">A</text>
      <path d="M256 125h12m-4-4 4 4-4 4" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <text x="273" y="131" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="14" fill="#fff">文</text>
    </g>
    <Sparkle x={262} y={36} size={9} className="ob-d1" />
    <Sparkle x={44} y={110} size={7} className="ob-d3" />
  </svg>
);

export const SyncScene = () => (
  <svg viewBox="0 0 320 260" className="ob-art" aria-hidden="true">
    <Defs />
    <circle cx="160" cy="124" r="118" fill="url(#ob-glow)" />
    {/* Data flowing between the devices and the cloud */}
    <g fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" opacity="0.7">
      <path d="M78 176C78 132 120 112 140 100" className="ob-flow" />
      <path d="M160 176V112" className="ob-flow ob-d2" />
      <path d="M244 172C244 130 202 112 180 100" className="ob-flow ob-d3" />
    </g>
    {/* Cloud with a lock: encrypted on your server */}
    <g className="ob-float ob-d1" filter="url(#ob-shadow)">
      <g fill="var(--surface-raised)" stroke="var(--border)" strokeWidth="1">
        <circle cx="130" cy="74" r="24" />
        <circle cx="190" cy="72" r="26" />
        <circle cx="160" cy="56" r="34" />
        <rect x="106" y="66" width="110" height="32" rx="16" />
      </g>
      {/* One outline around the union: the inner strokes are painted over */}
      <g fill="var(--surface-raised)">
        <circle cx="130" cy="74" r="23.5" />
        <circle cx="190" cy="72" r="25.5" />
        <circle cx="160" cy="56" r="33.5" />
        <rect x="106.5" y="66.5" width="109" height="31" rx="15.5" />
      </g>
      <rect x="146" y="54" width="28" height="24" rx="6" fill="url(#ob-cover-indigo)" />
      <path d="M152 54v-6a8 8 0 0 1 16 0v6" fill="none" stroke="url(#ob-cover-indigo)" strokeWidth="4" />
      <circle cx="160" cy="65" r="3.5" fill="#fff" />
      <rect x="158.5" y="66" width="3" height="6" rx="1.5" fill="#fff" />
    </g>
    {/* Phone */}
    <g className="ob-float ob-d2" filter="url(#ob-shadow)">
      <rect x="58" y="176" width="40" height="70" rx="9" fill="var(--text)" />
      <rect x="62" y="182" width="32" height="58" rx="5" fill="url(#ob-cover-amber)" />
      <rect x="67" y="190" width="20" height="4" rx="2" fill="#fff" opacity="0.9" />
      <rect x="67" y="198" width="14" height="4" rx="2" fill="#fff" opacity="0.7" />
    </g>
    {/* Laptop */}
    <g className="ob-float ob-d3" filter="url(#ob-shadow)">
      <rect x="118" y="178" width="84" height="54" rx="7" fill="var(--text)" />
      <rect x="123" y="183" width="74" height="44" rx="4" fill="var(--surface-raised)" />
      <rect x="130" y="190" width="18" height="30" rx="3" fill="url(#ob-cover-indigo)" />
      <rect x="152" y="190" width="18" height="30" rx="3" fill="url(#ob-cover-rose)" />
      <rect x="174" y="190" width="16" height="30" rx="3" fill="url(#ob-cover-teal)" />
      <path d="M108 232h104l-8 8h-88z" fill="var(--text)" opacity="0.85" />
    </g>
    {/* Tablet */}
    <g className="ob-float ob-d4" filter="url(#ob-shadow)">
      <rect x="220" y="172" width="54" height="72" rx="9" fill="var(--text)" />
      <rect x="225" y="177" width="44" height="62" rx="5" fill="var(--surface-raised)" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x="231" y={185 + i * 10} width={i % 2 ? 26 : 32} height="4" rx="2" fill="var(--text)" opacity="0.25" />
      ))}
      <rect x="229" y="203" width="36" height="9" rx="3" fill="#f6c453" opacity="0.5" />
    </g>
    {/* Synced */}
    <g className="ob-pop">
      <circle cx="214" cy="40" r="13" fill="var(--success)" />
      <path d="M208 40l4 4 8-8" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <Sparkle x={54} y={64} size={8} className="ob-d2" />
    <Sparkle x={286} y={120} size={6} className="ob-d1" />
  </svg>
);
