import React from "react";
import "./emptyCover.css";

// Muted cloth colours for books without cover art; the title picks one so a
// book keeps the same cover everywhere
const COVER_COLORS = [
  "#7a3e48",
  "#2f4858",
  "#4f6d5a",
  "#3b3b58",
  "#a3593e",
  "#445a3f",
  "#5b2a33",
  "#6b4e71",
  "#2e6f73",
  "#b08d57",
  "#3e4a7a",
  "#8c5e3c",
];

const pickColor = (title: string) => {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  return COVER_COLORS[Math.abs(hash) % COVER_COLORS.length];
};

const emptyCover = (props: {
  format?: string;
  title?: string;
  author?: string;
  scale?: number;
}) => (
  <div
    className="empty-cover"
    style={{
      transform: `scale(${props.scale})`,
      backgroundColor: pickColor(props.title || ""),
    }}
  >
    <div className="cover-title">{props.title}</div>
    <div className="cover-rule"></div>
    {props.author && <div className="cover-author">{props.author}</div>}
    <div className="cover-format">{props.format || "BOOK"}</div>
  </div>
);

export default emptyCover;
