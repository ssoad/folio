import React from "react";

// Line icons for the Import button and its menu (24px grid, 2px stroke,
// drawn in the current text colour)
const paths = {
  plus: ["M12 5v14", "M5 12h14"],
  chevron: ["m6 9 6 6 6-6"],
  file: [
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z",
    "M14 2v6h6",
    "M12 18v-6",
    "M9 15h6",
  ],
  folder: [
    "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  ],
  cloud: ["M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"],
  catalog: [
    "M4 11a9 9 0 0 1 9 9",
    "M4 4a16 16 0 0 1 16 16",
    "M5 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  ],
  link: [
    "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
    "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  ],
  sync: [
    "M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
    "M3 3v5h5",
    "M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16",
    "M16 16h5v5",
  ],
};

export type ImportIconName = keyof typeof paths;

const ImportIcon = (props: {
  name: ImportIconName;
  size?: number;
  className?: string;
}) => (
  <svg
    className={props.className}
    width={props.size || 16}
    height={props.size || 16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {paths[props.name].map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);

export default ImportIcon;
