import { ConfigService } from "../assets/lib/kookit-extra-browser.min";
import store from "../store";
import { handleCollapse } from "../store/actions";
import { isCompact, isNativeApp } from "./platform";

export { isCompact, isNativeApp };

const root = () => document.documentElement;

export const isDrawerOpen = () => root().classList.contains("drawer-open");

export const setDrawerOpen = (open: boolean) => {
  root().classList.toggle("drawer-open", open && isCompact());
};

const applyCompact = () => {
  const compact = isCompact();
  const wasCompact = root().classList.contains("is-compact");
  if (compact === wasCompact) return;
  root().classList.toggle("is-compact", compact);
  // The drawer always shows the full sidebar; the saved collapsed state is
  // only for wide windows, so it isn't written back here
  store.dispatch(
    handleCollapse(
      compact ? false : ConfigService.getReaderConfig("isCollapsed") === "yes"
    )
  );
  if (!compact) setDrawerOpen(false);
};

export const initResponsive = () => {
  root().classList.toggle("is-native", isNativeApp());
  applyCompact();
  window.addEventListener("resize", applyCompact);
};
