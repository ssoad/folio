import React from "react";
import { Toaster } from "react-hot-toast";
import { isCompact } from "../../utils/platform";
import "./folioToaster.css";

// Messages ("Copying successful", "Import failed"...). On phones they're
// Android-style snackbars: a bar at the bottom in the theme's inverse
// colours, text only (folioToaster.css). Wide windows keep the toasts at the
// top.
const FolioToaster = () => {
  const compact = isCompact();
  return (
    <Toaster
      position={compact ? "bottom-center" : "top-center"}
      containerClassName={compact ? "folio-snackbar-container" : undefined}
      toastOptions={{
        className: compact ? "folio-snackbar" : undefined,
        style: {
          wordWrap: "break-word",
          wordBreak: "break-word",
          whiteSpace: "normal",
          overflowWrap: "break-word",
        },
        // A snackbar is text only; the spinner stays for work in progress
        ...(compact ? { success: { icon: null }, error: { icon: null } } : {}),
      }}
    />
  );
};

export default FolioToaster;
