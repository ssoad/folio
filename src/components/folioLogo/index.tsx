import React from "react";
import "./folioLogo.css";

interface FolioLogoProps {
  size?: number;
  // Show the page mark and/or the "Folio" wordmark
  withMark?: boolean;
  withWordmark?: boolean;
  isPro?: boolean;
  className?: string;
  onClick?: () => void;
}

// A page with its corner turned down; its lines of text form an F.
// Same geometry as src/assets/images/folio-mark.svg and scripts/generate-brand-assets.py
export const FolioMark = ({ size = 28 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    aria-hidden="true"
    className="folio-mark"
  >
    <path
      d="M14 6h26l14 14v34a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z"
      className="folio-mark-page"
    />
    <path d="M40 6v10a4 4 0 0 0 4 4h10z" className="folio-mark-fold" />
    <rect x="19" y="26" width="24" height="5" rx="2.5" className="folio-mark-ink" />
    <rect x="19" y="36" width="16" height="5" rx="2.5" className="folio-mark-ink" />
    <rect x="19" y="26" width="5" height="22" rx="2.5" className="folio-mark-ink" />
  </svg>
);

const FolioLogo = ({
  size = 28,
  withMark = true,
  withWordmark = true,
  isPro = false,
  className = "",
  onClick,
}: FolioLogoProps) => (
  <div
    className={"folio-logo " + className}
    onClick={onClick}
    role={onClick ? "link" : undefined}
  >
    {withMark && <FolioMark size={size} />}
    {withWordmark && (
      <span className="folio-logo-wordmark" style={{ fontSize: size * 0.86 }}>
        Folio<span className="folio-logo-dot">.</span>
      </span>
    )}
    {isPro && <span className="folio-logo-pro">Pro</span>}
  </div>
);

export default FolioLogo;
