import React from "react";
import "./popupMenu.css";
import PopupNote from "../popupNote";
import PopupTrans from "../popupTrans";
import PopupDict from "../popupDict";
import { PopupBoxProps, PopupBoxStates } from "./interface";
import { clearIframeSelection, getIframeDoc } from "../../../utils/reader/docUtil";
import PopupAssist from "../popupAssist";
import { isElectron } from "react-device-detect";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { NATIVE_BACK_EVENT } from "../../../utils/native";

const SNAP_THRESHOLD_PX = 50;
const RIGHT_SNAP_THRESHOLD_PX = 50;
const SETTING_PANEL_WIDTH = 299;

const POPUP_SIZE_KEY = "popupBoxSize";
const POPUP_POS_KEY = "popupBoxPosition";
const DEFAULT_WIDTH = 500;
const POPUP_MODES = ["note", "trans", "dict", "assistant"];
// Gap kept between the popup and the window edges
const VIEWPORT_MARGIN = 8;
// Room above the popup for the close / pin / move controls drawn at top: -30px
const CONTROLS_SPACE = 40;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 200;
// At or below this width the popup becomes a full-width sheet at the bottom
const PHONE_MAX_WIDTH = 576;
// Largest share of the screen height the phone sheet can be dragged to
const PHONE_MAX_HEIGHT_RATIO = 0.9;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

const isPhoneWidth = () => window.innerWidth <= PHONE_MAX_WIDTH;

function getDefaultHeight(menuMode: string) {
  if (menuMode === "assistant") return 400;
  if (menuMode === "note") return 360;
  return 320;
}

class PopupBox extends React.Component<PopupBoxProps, PopupBoxStates> {
  highlighter: any;
  timer!: NodeJS.Timeout;
  key: any;
  mode: string;
  showNote: boolean;
  isFirstShow: boolean;
  rect: any;
  isResizing: boolean = false;
  resizeStartX: number = 0;
  resizeStartY: number = 0;
  resizeStartWidth: number = 0;
  resizeStartHeight: number = 0;
  isDragging: boolean = false;
  dragStartX: number = 0;
  dragStartY: number = 0;
  dragStartLeft: number = 0;
  dragStartBottom: number = 0;
  wasDocked: boolean = false;
  resizeFrame: number | null = null;

  constructor(props: PopupBoxProps) {
    super(props);
    this.showNote = false;
    this.isFirstShow = false;
    this.highlighter = null;
    this.mode = POPUP_MODES.includes(props.menuMode)
      ? props.menuMode
      : "assistant";

    const savedSize = this.getSavedSize();
    const savedPos = this.getSavedPosition();
    this.state = {
      deleteKey: "",
      rect: this.props.rect,
      isShowUrl: false,
      popupWidth: savedSize ? savedSize.width : DEFAULT_WIDTH,
      popupHeight: savedSize
        ? savedSize.height
        : getDefaultHeight(props.menuMode),
      popupLeft: savedPos ? savedPos.left : 50,
      popupBottom: savedPos ? savedPos.bottom : 0,
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0,
      isNearBottom: false,
      isNearRight: false,
      isDockedRight: this.props.isDockedRight,
    };
  }

  getSavedSize(): { width: number; height: number } | null {
    try {
      const saved = ConfigService.getReaderConfig(POPUP_SIZE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.width && parsed.height) return parsed;
      }
    } catch (e) {}
    return null;
  }

  saveSizeToConfig(width: number, height: number) {
    try {
      ConfigService.setReaderConfig(
        POPUP_SIZE_KEY,
        JSON.stringify({ width, height })
      );
    } catch (e) {}
  }

  getSavedPosition(): { left: number; bottom: number } | null {
    try {
      const saved = ConfigService.getReaderConfig(POPUP_POS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.left !== undefined && parsed.bottom !== undefined)
          return parsed;
      }
    } catch (e) {}
    return null;
  }

  savePositionToConfig(left: number, bottom: number) {
    try {
      ConfigService.setReaderConfig(
        POPUP_POS_KEY,
        JSON.stringify({ left, bottom })
      );
    } catch (e) {}
  }

  getSavedDocked(): boolean {
    try {
      return ConfigService.getReaderConfig("isDockedRight") === "yes";
    } catch (e) {}
    return false;
  }

  saveDockedToConfig(docked: boolean) {
    try {
      ConfigService.setReaderConfig("isDockedRight", docked ? "yes" : "no");
    } catch (e) {}
  }

  syncDockedToRedux(docked: boolean) {
    this.saveDockedToConfig(docked);
    this.props.handleDockedRight(docked);
    if (docked) {
      setTimeout(() => {
        this.props.renderBookFunc();
      }, 300);
    }
  }

  UNSAFE_componentWillReceiveProps(nextProps: PopupBoxProps) {
    if (POPUP_MODES.includes(nextProps.menuMode)) {
      this.mode = nextProps.menuMode;
    }
  }

  componentDidMount(): void {
    if (isElectron) {
      const ipcRenderer = window.electronAPI;
      let isShowUrl = ipcRenderer.sendSync("url-window-status", {
        type: this.props.menuMode,
      });
      this.setState({ isShowUrl });
    }
    // Pointer events cover mouse, touch and pen with one code path
    document.addEventListener("pointermove", this.handleResizeMove);
    document.addEventListener("pointermove", this.handleDragMove);
    document.addEventListener("pointerup", this.handleResizeEnd);
    document.addEventListener("pointerup", this.handleDragEnd);
    document.addEventListener("pointercancel", this.handleResizeEnd);
    document.addEventListener("pointercancel", this.handleDragEnd);
    window.addEventListener("resize", this.handleWindowResize);
    window.addEventListener(NATIVE_BACK_EVENT, this.handleNativeBack, {
      capture: true,
    });
  }

  componentWillUnmount(): void {
    window.removeEventListener(
      NATIVE_BACK_EVENT,
      this.handleNativeBack,
      { capture: true } as any
    );
    document.removeEventListener("pointermove", this.handleResizeMove);
    document.removeEventListener("pointermove", this.handleDragMove);
    document.removeEventListener("pointerup", this.handleResizeEnd);
    document.removeEventListener("pointerup", this.handleDragEnd);
    document.removeEventListener("pointercancel", this.handleResizeEnd);
    document.removeEventListener("pointercancel", this.handleDragEnd);
    window.removeEventListener("resize", this.handleWindowResize);
    if (this.resizeFrame !== null) {
      cancelAnimationFrame(this.resizeFrame);
    }
  }

  handleNativeBack = (e: Event) => {
    if (!this.state.isDockedRight) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.handleClose();
    }
  };

  // Size and position are stored as the user left them; they are fitted to the
  // window at render time, so re-render when the window changes size
  handleWindowResize = () => {
    if (this.resizeFrame !== null) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null;
      this.forceUpdate();
    });
  };

  getNavOffset() {
    if (this.props.isNavLocked && !this.props.isSettingLocked) return 150;
    if (!this.props.isNavLocked && this.props.isSettingLocked) return -150;
    return 0;
  }

  // Fits the saved size and position into the current window
  getFloatingGeometry() {
    const { popupWidth, popupHeight, popupLeft, popupBottom } = this.state;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (isPhoneWidth()) {
      return {
        width: viewportWidth,
        height: clamp(
          popupHeight,
          MIN_HEIGHT,
          Math.round(viewportHeight * PHONE_MAX_HEIGHT_RATIO)
        ),
        centerX: viewportWidth / 2,
        bottom: 0,
      };
    }
    const width = Math.min(popupWidth, viewportWidth - VIEWPORT_MARGIN * 2);
    const height = Math.min(
      popupHeight,
      viewportHeight - CONTROLS_SPACE - VIEWPORT_MARGIN
    );
    const centerX = clamp(
      (popupLeft / 100) * viewportWidth + this.getNavOffset(),
      width / 2 + VIEWPORT_MARGIN,
      viewportWidth - width / 2 - VIEWPORT_MARGIN
    );
    const bottom = clamp(
      (popupBottom / 100) * viewportHeight,
      0,
      viewportHeight - height - CONTROLS_SPACE
    );
    return { width, height, centerX, bottom };
  }

  handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    this.isResizing = true;
    this.resizeStartX = e.clientX;
    this.resizeStartY = e.clientY;
    const geometry = this.getFloatingGeometry();
    this.resizeStartWidth = geometry.width;
    this.resizeStartHeight = geometry.height;
  };

  handleResizeMove = (e: PointerEvent) => {
    if (!this.isResizing) return;
    // Dragging top-right corner: right edge extends right (+dx), top edge moves up (-dy means bigger height)
    const dx = e.clientX - this.resizeStartX;
    const dy = e.clientY - this.resizeStartY;
    if (isPhoneWidth()) {
      // The phone sheet is always full width, its grabber only changes the height
      this.setState({
        popupHeight: clamp(
          this.resizeStartHeight - dy,
          MIN_HEIGHT,
          Math.round(window.innerHeight * PHONE_MAX_HEIGHT_RATIO)
        ),
      });
      return;
    }
    const newWidth = clamp(
      this.resizeStartWidth + dx,
      MIN_WIDTH,
      window.innerWidth - VIEWPORT_MARGIN * 2
    );
    const newHeight = clamp(
      this.resizeStartHeight - dy,
      MIN_HEIGHT,
      window.innerHeight - CONTROLS_SPACE - VIEWPORT_MARGIN
    );
    this.setState({ popupWidth: newWidth, popupHeight: newHeight });
  };

  handleResizeEnd = (_e: PointerEvent) => {
    if (!this.isResizing) return;
    this.isResizing = false;
    this.saveSizeToConfig(this.state.popupWidth, this.state.popupHeight);
  };

  handleDragStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (this.state.isDockedRight) {
      const { popupWidth, popupHeight } = this.state;
      // 移动图标中心在 popup 内的偏移：right:24px, width:18px, top:0, height:18px
      // 图标中心距 popup 左边缘 = popupWidth - 24 - 9 = popupWidth - 33
      // 图标中心距 popup 上边缘 = 9
      // 反推：让图标中心对齐鼠标，计算 popup 的 left% 和 bottom%
      const rawLeft =
        ((e.clientX - popupWidth / 2 + 33) / window.innerWidth) * 100;
      const newLeft = Math.max(0, Math.min(100, rawLeft));
      const rawBottom =
        ((window.innerHeight - e.clientY - popupHeight + 9) /
          window.innerHeight) *
        100;
      const newBottom = Math.max(0, rawBottom);

      this.dragStartLeft = newLeft;
      this.dragStartBottom = newBottom;
      this.isDragging = true;
      this.wasDocked = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.props.handleMenuMode("assistant");
      this.props.handleOpenMenu(true);
      this.setState({
        isDockedRight: false,
        popupLeft: newLeft,
        popupBottom: newBottom,
      });
      this.syncDockedToRedux(false);
      return;
    }
    // Start from where the popup is shown, which may differ from the saved
    // position after it was fitted into a smaller window
    const geometry = this.getFloatingGeometry();
    this.isDragging = true;
    this.wasDocked = false;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragStartLeft =
      ((geometry.centerX - this.getNavOffset()) / window.innerWidth) * 100;
    this.dragStartBottom = (geometry.bottom / window.innerHeight) * 100;
  };

  handleDragMove = (e: PointerEvent) => {
    if (!this.isDragging) return;
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;
    const newLeft = Math.max(
      0,
      Math.min(100, this.dragStartLeft + (dx / window.innerWidth) * 100)
    );
    const newBottom = Math.max(
      0,
      this.dragStartBottom - (dy / window.innerHeight) * 100
    );

    const bottomPx = (newBottom / 100) * window.innerHeight;
    const isNearBottom = bottomPx < SNAP_THRESHOLD_PX;

    const rightEdgePx =
      (newLeft / 100) * window.innerWidth + this.state.popupWidth / 2;
    const isNearRight =
      window.innerWidth - rightEdgePx < RIGHT_SNAP_THRESHOLD_PX;

    this.setState({
      popupLeft: newLeft,
      popupBottom: newBottom,
      isNearBottom,
      isNearRight,
    });
  };

  handleDragEnd = (_e: PointerEvent) => {
    if (!this.isDragging) return;
    this.isDragging = false;
    let { popupLeft, popupBottom, popupWidth } = this.state;

    const rightEdgePx = (popupLeft / 100) * window.innerWidth + popupWidth / 2;
    if (window.innerWidth - rightEdgePx < RIGHT_SNAP_THRESHOLD_PX) {
      this.setState({
        isDockedRight: true,
        isNearRight: false,
        isNearBottom: false,
      });
      this.syncDockedToRedux(true);
      return;
    }

    const bottomPx = (popupBottom / 100) * window.innerHeight;
    if (bottomPx < SNAP_THRESHOLD_PX) {
      popupBottom = 0;
    }
    this.setState({
      popupLeft,
      popupBottom,
      isNearBottom: false,
      isNearRight: false,
    });
    this.savePositionToConfig(popupLeft, popupBottom);

    // 从固定右侧状态拖出后松手（未重新吸附），刷新书籍布局
    if (this.wasDocked) {
      this.wasDocked = false;
      setTimeout(() => {
        this.props.renderBookFunc();
      }, 300);
    }
  };

  handleToggleDock = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (this.state.isDockedRight) {
      // 当前已固定 → 取消固定，恢复到之前保存的位置
      const savedPos = this.getSavedPosition();
      const savedSize = this.getSavedSize();
      this.setState({
        isDockedRight: false,
        popupLeft: savedPos ? savedPos.left : 50,
        popupBottom: savedPos ? savedPos.bottom : 0,
        popupWidth: savedSize ? savedSize.width : DEFAULT_WIDTH,
        popupHeight: savedSize ? savedSize.height : getDefaultHeight(this.mode),
      });
      this.syncDockedToRedux(false);
      this.props.renderBookFunc();
    } else {
      // 当前未固定 → 直接固定到右侧
      this.syncDockedToRedux(true);
    }
  };

  handleClose() {
    this.props.handleOpenMenu(false);
    this.props.handleNoteKey("");
    this.props.handleMenuMode("");
    clearIframeSelection(this.props.currentBook.format);
  }
  render() {
    const { isNearRight, isDockedRight } = this.state;
    const isPhone = isPhoneWidth();
    const menuMode = isDockedRight ? this.mode : this.props.menuMode;
    const PopupProps = {
      chapterDocIndex: this.props.chapterDocIndex,
      chapter: this.props.chapter,
      isDockedRight,
    };
    const geometry = this.getFloatingGeometry();
    const isAtBottom = geometry.bottom === 0;

    const containerStyle: React.CSSProperties = isDockedRight
      ? {
          position: "fixed",
          right: 0,
          top: 0,
          left: "auto",
          bottom: 0,
          width: Math.min(SETTING_PANEL_WIDTH, window.innerWidth),
          height: "100%",
          transform: "none",
          borderRadius: "10px 0 0 10px",
          marginLeft: 0,
          transition: "none",
        }
      : {
          width: geometry.width,
          height: geometry.height,
          left: geometry.centerX,
          bottom: geometry.bottom,
          transform: "translateX(-50%)",
          borderBottomLeftRadius: isAtBottom ? 0 : 10,
          borderBottomRightRadius: isAtBottom ? 0 : 10,
          outline: isNearRight
            ? "6px solid var(--color-primary, #5c9ee6)"
            : "none",
        };

    return (
      <div
        style={{
          display:
            this.state.isShowUrl &&
            (menuMode === "dict" || menuMode === "trans")
              ? "none"
              : "block",
        }}
      >
        <div className={`popup-box-container`} style={containerStyle}>
          {isPhone && !isDockedRight && (
            <div
              className="popup-sheet-grabber"
              onPointerDown={this.handleResizeStart}
              title={this.props.t("Resize")}
            />
          )}
          {menuMode === "note" ? (
            <PopupNote {...(PopupProps as any)} />
          ) : menuMode === "trans" ? (
            <PopupTrans {...(PopupProps as any)} />
          ) : menuMode === "dict" ? (
            <PopupDict {...(PopupProps as any)} />
          ) : menuMode === "assistant" ? (
            <PopupAssist {...(PopupProps as any)} />
          ) : null}
          <span
            className="icon-close popup-close"
            onClick={() => {
              this.handleClose();
            }}
            style={{
              ...(isDockedRight
                ? { display: "none" }
                : { top: "-30px", left: "calc(50% - 10px)" }),
            }}
          ></span>
          {/* On phones the popup is a fixed bottom sheet: no moving, resizing or
              docking, only undocking a panel docked on a wider window */}
          {(!isPhone || isDockedRight) && (
            <span
              className={`icon-sidebar popup-pin-handle ${isDockedRight ? "" : "popup-close"}`}
              onClick={this.handleToggleDock}
              title={this.props.t(isDockedRight ? "Unpin" : "Pin to right")}
              style={
                isDockedRight
                  ? {
                      right: "40px",
                    }
                  : {
                      top: "-30px",
                      right: "40px",
                    }
              }
            ></span>
          )}
          {!isPhone && (
            <span
              className={`icon-menu popup-drag-handle ${isDockedRight ? "" : "popup-close"}`}
              onPointerDown={this.handleDragStart}
              title={this.props.t("Move")}
              style={
                isDockedRight
                  ? {
                      right: "10px",
                    }
                  : {
                      top: "-30px",
                      right: "10px",
                    }
              }
            ></span>
          )}

          {!isDockedRight && !isPhone && (
            <div
              className="popup-resize-handle"
              onPointerDown={this.handleResizeStart}
              title={this.props.t("Resize")}
            />
          )}
        </div>
        {!isDockedRight && (
          <div
            className="popup-box-backdrop drag-background"
            onClick={this.handleClose}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) {
                this.handleClose();
              }
            }}
          ></div>
        )}
      </div>
    );
  }
}

export default PopupBox;
