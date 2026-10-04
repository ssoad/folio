import React from "react";

// Line icons for the phone reader (24px grid, 1.8px stroke, drawn in the
// current text colour), so the bars, sheets and toolbars share one style
const paths = {
  back: ["M15 6l-6 6 6 6"],
  bookmark: ["M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"],
  search: [
    "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z",
    "M21 21l-5.2-5.2",
  ],
  // Dots as small rings, so they read at the same weight as the lines
  more: [
    "M11 5.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0",
    "M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0",
    "M11 18.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0",
  ],
  moreHorizontal: [
    "M4.5 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0",
    "M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0",
    "M17.5 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0",
  ],
  contents: [
    "M9 6h11",
    "M9 12h11",
    "M9 18h11",
    "M4.5 6h.01",
    "M4.5 12h.01",
    "M4.5 18h.01",
  ],
  display: [
    "M3 19l5-13 5 13",
    "M4.8 14.5h6.4",
    "M14.5 19l3.5-9 3.5 9",
    "M15.6 16.2h4.8",
  ],
  pen: ["M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z", "M13.5 6.5l4 4"],
  listen: [
    "M4 15v-3a8 8 0 0 1 16 0v3",
    "M18 19a2 2 0 0 1-2-2v-2a2 2 0 0 1 4 0v2a2 2 0 0 1-2 2z",
    "M6 19a2 2 0 0 1-2-2v-2a2 2 0 0 1 4 0v2a2 2 0 0 1-2 2z",
  ],
  ai: [
    "M12 3l1.8 4.8L18.6 9.6 13.8 11.4 12 16.2 10.2 11.4 5.4 9.6 10.2 7.8z",
    "M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z",
  ],
  note: ["M6 4h9l4 4v12H6z", "M14 4v5h5", "M9 13h7", "M9 17h5"],
  copy: [
    "M8 8h11v12H8z",
    "M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h3",
  ],
  close: ["M6 6l12 12", "M18 6L6 18"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  minus: ["M5 12h14"],
  plus: ["M12 5v14", "M5 12h14"],
  sun: [
    "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    "M12 2.5v2",
    "M12 19.5v2",
    "M4.6 4.6l1.4 1.4",
    "M18 18l1.4 1.4",
    "M2.5 12h2",
    "M19.5 12h2",
    "M4.6 19.4L6 18",
    "M18 6l1.4-1.4",
  ],
  highlighter: ["M9 14l-4 4v2h6l2-2", "M9 14l6-10 5 3-6 10z", "M9 14l5 3"],
  shape: ["M4 4h9v9H4z", "M16.5 20a4 4 0 1 0 0-8"],
  text: ["M5 6V4h14v2", "M12 4v16", "M9 20h6"],
  eraser: [
    "M8.5 19.5h11",
    "M4.6 15.4l9.9-9.9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8l-8.4 8.4a2 2 0 0 1-1.4.6H8.3a2 2 0 0 1-1.4-.6l-2.3-2.3a.8.8 0 0 1 0-1.2z",
    "M9.5 10.5l5 5",
  ],
  undo: ["M9 14L4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  zoom: [
    "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z",
    "M21 21l-5.2-5.2",
    "M10.5 7.5v6",
    "M7.5 10.5h6",
  ],
};

export type PhoneIconName = keyof typeof paths;

const PhoneIcon = (props: {
  name: PhoneIconName;
  size?: number;
  className?: string;
  filled?: boolean;
}) => (
  <svg
    className={props.className}
    width={props.size || 22}
    height={props.size || 22}
    viewBox="0 0 24 24"
    fill={props.filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {paths[props.name].map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);

export default PhoneIcon;
