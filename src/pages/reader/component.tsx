import React from "react";
import { NATIVE_BACK_EVENT } from "../../utils/native";
import { effectiveReaderMode, isCompact } from "../../utils/platform";
import { Trans } from "react-i18next";
import SettingPanel from "../../containers/panels/settingPanel";
import NavigationPanel from "../../containers/panels/navigationPanel";
import OperationPanel from "../../containers/panels/operationPanel";
import { Toaster } from "react-hot-toast";
import ProgressPanel from "../../containers/panels/progressPanel";
import { ReaderProps, ReaderState } from "./interface";
import {
  ConfigService,
  ReadingTimeUtil,
} from "../../assets/lib/kookit-extra-browser.min";
import Viewer from "../../containers/viewer";
import { Tooltip } from "react-tooltip";
import "./index.css";
import Book from "../../models/Book";
import DatabaseService from "../../utils/storage/databaseService";
import ConvertDialog from "../../components/dialogs/convertDialog";
import PdfCropDialog from "../../components/dialogs/pdfCropDialog";
import { isElectron } from "react-device-detect";
import SettingDialog from "../../components/dialogs/settingDialog";
import SpeechDialog from "../../components/dialogs/speechDialog";
import AnnotationDialog from "../../components/dialogs/annotationDialog";
import PopupOptionDialog from "../../components/dialogs/popupOptionDialog";
import {
  updateDiscordPresence,
  clearDiscordPresence,
} from "../../utils/reader/discordRPC";
import {
  READER_CHROME_TOGGLE_EVENT,
  READER_EXIT_EVENT,
  READING_PANEL_TOGGLE_EVENT,
  searchInTheBook,
  setDrawingMode,
  toggleNavTab,
} from "../../utils/reader/mouseEvent";
import { setImmersiveReading } from "../../utils/native";
import { isReadingRawPDF, throttle } from "../../utils/common";
declare var window: any;
let lock = false; //prevent from clicking too fasts
let throttleTime = 200;
let isMouseMoving = false;
const PANEL_POSITIONS = ["left", "right", "top", "bottom"] as const;
type PanelPosition = (typeof PANEL_POSITIONS)[number];
const PANEL_ENTER_DELAY = 500;
const PANEL_LEAVE_DELAY = 500;
const enterTimers: Record<string, NodeJS.Timeout | null> = {
  left: null,
  right: null,
  top: null,
  bottom: null,
};
const leaveTimers: Record<string, NodeJS.Timeout | null> = {
  left: null,
  right: null,
  top: null,
  bottom: null,
};
const isEdgeHovering: Record<string, boolean> = {
  left: false,
  right: false,
  top: false,
  bottom: false,
};
const PANEL_OPEN_STATE: Record<
  PanelPosition,
  | "isOpenLeftPanel"
  | "isOpenRightPanel"
  | "isOpenTopPanel"
  | "isOpenBottomPanel"
> = {
  left: "isOpenLeftPanel",
  right: "isOpenRightPanel",
  top: "isOpenTopPanel",
  bottom: "isOpenBottomPanel",
};
class Reader extends React.Component<ReaderProps, ReaderState> {
  messageTimer!: NodeJS.Timeout;
  tickTimer!: NodeJS.Timeout;
  private autoShowTimer: NodeJS.Timeout | null = null;
  private readingTimeUtil = new ReadingTimeUtil(
    ConfigService,
    isElectron
      ? {
          registerUnloadHandler(callback: () => void): () => void {
            const ipcRenderer = window.electronAPI;
            // Separate reader window close
            ipcRenderer.on("before-reader-close", callback);
            // In-app tab (WebContentsView) close
            ipcRenderer.on("before-tab-close", callback);
            return () => {
              ipcRenderer.removeListener("before-reader-close", callback);
              ipcRenderer.removeListener("before-tab-close", callback);
            };
          },
          onBeforeClose(): void {
            const ipcRenderer = window.electronAPI;
            // Reply to whichever close signal is active
            ipcRenderer.send("reader-close-ready");
            ipcRenderer.send("tab-close-ready");
          },
        }
      : {
          registerUnloadHandler(callback: () => void): () => void {
            window.addEventListener("beforeunload", callback);
            return () => window.removeEventListener("beforeunload", callback);
          },
        }
  );
  constructor(props: ReaderProps) {
    super(props);
    this.state = {
      isOpenTopPanel: false,
      isOpenBottomPanel: false,
      hoverPanel: "",
      isOpenLeftPanel: this.props.isNavLocked,
      isOpenRightPanel: this.props.isSettingLocked,
      totalDuration: 0,
      currentDuration: 0,
      scale: ConfigService.getReaderConfig("scale") || "1",
      isTouch: ConfigService.getReaderConfig("isTouch") === "yes",
      isPreventTrigger:
        ConfigService.getReaderConfig("isPreventTrigger") === "yes",
      isShowScale: false,
      isNearEdge: false,
    };
  }
  componentDidMount() {
    // PDFs and comics fill the phone screen edge to edge (compact.css)
    document.documentElement.classList.toggle(
      "is-fixed-reading",
      /^#\/(pdf|cbr|cbz|cbt|cb7)\//i.test(window.location.hash)
    );
    this.syncImmersive();
    if (ConfigService.getReaderConfig("isMergeWord") === "yes") {
      document
        .querySelector("body")
        ?.setAttribute("style", "background-color: rgba(0,0,0,0)");
    }

    // Update UI counters every second so the navigation panel still shows
    // live reading-time values, but actual storage writes only happen when
    // a reading session ends (visibility hidden / blur / unmount).
    this.tickTimer = setInterval(() => {
      if (!this.props.currentBook.key) return;
      this.setState((prev) => ({
        totalDuration: prev.totalDuration + 60,
        currentDuration: prev.currentDuration + 60,
      }));
    }, 60000);

    window.addEventListener("beforeunload", function (event) {
      if (!isElectron) {
        ConfigService.setReaderConfig("isFinishWebReading", "yes");
      }
    });
    const handleMouseMove = () => {
      isMouseMoving = true;
      setTimeout(() => {
        isMouseMoving = false;
      }, 100);
    };
    const throttledMouseMove = throttle(handleMouseMove, 100);
    window.addEventListener("mousemove", throttledMouseMove);
    window.addEventListener(
      READING_PANEL_TOGGLE_EVENT,
      this.handleReadingPanelToggle
    );
    window.addEventListener(
      READER_CHROME_TOGGLE_EVENT,
      this.handleReaderChromeToggle
    );
    window.addEventListener(NATIVE_BACK_EVENT, this.handleBack);

    // 进入阅读器后主动展示快捷按钮 3 秒，提示用户位置后自动隐藏
    this.setState({ isNearEdge: true });
    this.autoShowTimer = setTimeout(() => {
      this.autoShowTimer = null;
      this.setState({ isNearEdge: false });
    }, 1500);
  }
  async UNSAFE_componentWillMount() {
    let url = document.location.href;
    let firstIndexOfQuestion = url.indexOf("?");
    let lastIndexOfSlash = url.lastIndexOf("/", firstIndexOfQuestion);
    let key = url.substring(lastIndexOfSlash + 1, firstIndexOfQuestion);
    if (ConfigService.getAllListConfig("seperateStyleBooks").includes(key)) {
      window.currentBookKey = key;
      this.props.handleBackgroundColor(
        ConfigService.getReaderConfig("backgroundColor") || ""
      );
    } else {
      window.currentBookKey = "";
    }
    this.props.handleFetchBooks();
    this.props.handleFetchAuthed();
    DatabaseService.getRecord(key, "books").then((book: Book | null) => {
      book = book || JSON.parse(ConfigService.getItem("tempBook") || "{}");
      if (!book) return;

      this.props.handleFetchPercentage(book);
      let readerMode =
        isReadingRawPDF(book) || book.format.startsWith("CB")
          ? ConfigService.getReaderConfig("pdfReaderMode") || "scroll"
          : ConfigService.getReaderConfig("readerMode") || "double";
      this.props.handleReaderMode(effectiveReaderMode(readerMode));
      this.props.handleReadingBook(book);
      // Start event-driven reading-time tracking
      this.readingTimeUtil.start(book.key);
      // Initialise UI duration from persisted total
      const savedTotal = this.readingTimeUtil.getTotalSeconds(book.key);
      this.setState({ totalDuration: savedTotal, currentDuration: 0 });
      if (isElectron) {
        updateDiscordPresence(book);
      }
    });
  }

  componentDidUpdate() {
    this.syncImmersive();
  }
  // The status bar shows with the reader's bars and hides with them
  syncImmersive = () => {
    setImmersiveReading(
      !(
        this.state.isOpenTopPanel ||
        this.state.isOpenBottomPanel ||
        this.state.isOpenLeftPanel ||
        this.state.isOpenRightPanel
      )
    );
  };
  componentWillUnmount() {
    document.documentElement.classList.remove("is-fixed-reading");
    setImmersiveReading(false);
    window.removeEventListener(
      READING_PANEL_TOGGLE_EVENT,
      this.handleReadingPanelToggle
    );
    window.removeEventListener(
      READER_CHROME_TOGGLE_EVENT,
      this.handleReaderChromeToggle
    );
    window.removeEventListener(NATIVE_BACK_EVENT, this.handleBack);
    if (isElectron) {
      clearDiscordPresence();
    }
    clearInterval(this.tickTimer);
    if (this.autoShowTimer) {
      clearTimeout(this.autoShowTimer);
      this.autoShowTimer = null;
    }
    PANEL_POSITIONS.forEach((position) => {
      this.cancelEnterReader(position);
      this.cancelLeaveReader(position);
    });
    // Flush any in-flight session time before the component tears down
    this.readingTimeUtil.stop();
  }

  cancelEnterReader = (position: string) => {
    isEdgeHovering[position] = false;
    if (enterTimers[position]) {
      clearTimeout(enterTimers[position]!);
      enterTimers[position] = null;
    }
  };

  scheduleEnterReader = (position: string) => {
    this.cancelEnterReader(position);
    isEdgeHovering[position] = true;
    const delay = this.state.isPreventTrigger ? 0 : PANEL_ENTER_DELAY;
    enterTimers[position] = setTimeout(() => {
      enterTimers[position] = null;
      if (!isEdgeHovering[position] || isMouseMoving) return;
      this.handleEnterReader(position);
    }, delay);
  };

  cancelLeaveReader = (position: string) => {
    if (leaveTimers[position]) {
      clearTimeout(leaveTimers[position]!);
      leaveTimers[position] = null;
    }
  };

  scheduleLeaveReader = (position: string) => {
    this.cancelLeaveReader(position);
    leaveTimers[position] = setTimeout(() => {
      leaveTimers[position] = null;
      this.handleLeaveReader(position);
    }, PANEL_LEAVE_DELAY);
  };

  handleEdgeMouseEnter = (position: PanelPosition) => {
    if (
      this.state.isTouch ||
      this.state[PANEL_OPEN_STATE[position]] ||
      this.state.isPreventTrigger
    ) {
      this.cancelLeaveReader(position);
      this.setState({ hoverPanel: position });
      return;
    }
    this.scheduleEnterReader(position);
  };

  handleEdgeMouseLeave = (position: PanelPosition) => {
    this.cancelEnterReader(position);
    this.setState({ hoverPanel: "" });
  };

  handleEnterReader = (position: string) => {
    this.cancelEnterReader(position);
    this.cancelLeaveReader(position);
    switch (position) {
      case "right":
        this.setState({
          isOpenRightPanel: true,
        });
        break;
      case "left":
        this.setState({
          isOpenLeftPanel: true,
        });
        break;
      case "top":
        this.setState({
          isOpenTopPanel: true,
        });
        break;
      case "bottom":
        this.setState({
          isOpenBottomPanel: true,
        });
        break;
      default:
        break;
    }
  };
  handleLeaveReader = (position: string) => {
    this.cancelLeaveReader(position);
    switch (position) {
      case "right":
        if (this.props.isSettingLocked) {
          break;
        } else {
          this.setState({ isOpenRightPanel: false });
          break;
        }

      case "left":
        if (
          this.props.isNavLocked ||
          ConfigService.getReaderConfig("isTempLocked") === "yes"
        ) {
          break;
        } else {
          this.setState({ isOpenLeftPanel: false });
          break;
        }
      case "top":
        this.setState({ isOpenTopPanel: false });
        break;
      case "bottom":
        this.setState({ isOpenBottomPanel: false });
        break;
      default:
        break;
    }
  };
  // A tap in the middle of the page: show or hide the top and bottom bars,
  // and close any open sheet
  handleReaderChromeToggle = () => {
    if (this.state.isOpenLeftPanel || this.state.isOpenRightPanel) {
      this.closeSheets();
      return;
    }
    const show = !(this.state.isOpenTopPanel || this.state.isOpenBottomPanel);
    this.setState({ isOpenTopPanel: show, isOpenBottomPanel: show });
    if (!show) this.closeToolPopovers();
  };
  handleOpenAssistant = async () => {
    if (!this.props.htmlBook?.rendition) return;
    this.props.handleMenuMode("assistant");
    this.props.handleOriginalText(
      await this.props.htmlBook.rendition.chapterText()
    );
    this.props.handleOpenMenu(true);
  };
  // Drawing on the page: scanned PDFs only, since their text can't be
  // highlighted
  canDraw = () =>
    !!this.props.currentBook &&
    isReadingRawPDF(this.props.currentBook) &&
    (this.props.currentBook.description || "").indexOf("scanned") > -1;
  handleToggleDrawing = () => {
    if (!this.props.htmlBook?.rendition) return;
    const isDrawing = !this.props.isAnnotationOpen;
    this.props.htmlBook.rendition.applyAnnotationConfig({
      isDrawing: isDrawing ? "yes" : "no",
    });
    setDrawingMode(
      isDrawing,
      this.props.currentBook.format,
      this.props.currentBook.key
    );
    this.props.handleAnnotationDialog(isDrawing);
  };
  // Phones have no hover to close the PDF tool popovers (zoom, crop, convert)
  closeToolPopovers = () => {
    if (this.props.isConvertOpen) this.props.handleConvertDialog(false);
    if (this.props.isPdfCropOpen) this.props.handlePdfCropDialog(false);
    if (this.state.isShowScale) this.setState({ isShowScale: false });
  };
  // Android back button: close the selection popup, a sheet or the bars
  // first, then leave the book
  handleBack = (event: Event) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    const popupBox = document.querySelector(".popup-box-container");
    if (popupBox && getComputedStyle(popupBox).display !== "none") {
      const closeBtn = popupBox.querySelector(".popup-close") as HTMLElement;
      if (closeBtn) {
        closeBtn.click();
        return;
      }
      this.props.handleOpenMenu(false);
      this.props.handleMenuMode("");
      return;
    }
    const popup = document.querySelector(".popup-menu-container");
    if (popup && getComputedStyle(popup).display !== "none") {
      this.props.handleOpenMenu(false);
      return;
    }
    if (this.props.isOpenPopupOptionDialog) {
      this.props.handlePopupOptionDialog(false);
      return;
    }
    if (
      this.props.isConvertOpen ||
      this.props.isPdfCropOpen ||
      this.state.isShowScale
    ) {
      this.closeToolPopovers();
    } else if (this.props.isAnnotationOpen) {
      this.handleToggleDrawing();
    } else if (this.state.isOpenLeftPanel || this.state.isOpenRightPanel) {
      this.closeSheets();
    } else if (this.state.isOpenTopPanel || this.state.isOpenBottomPanel) {
      this.setState({ isOpenTopPanel: false, isOpenBottomPanel: false });
    } else {
      window.dispatchEvent(new CustomEvent(READER_EXIT_EVENT));
    }
  };
  closeSheets = () => {
    this.handleLeaveReader("left");
    this.handleLeaveReader("right");
  };
  // Contents and settings open as sheets on phones, over hidden bars
  openSheet = (position: "left" | "right") => {
    this.setState({ isOpenTopPanel: false, isOpenBottomPanel: false });
    this.handleEnterReader(position);
  };
  handleReadingPanelToggle = (event: Event) => {
    const position = (event as CustomEvent<{ position: string }>).detail
      ?.position;
    if (!PANEL_POSITIONS.includes(position as PanelPosition)) return;
    const stateKey = PANEL_OPEN_STATE[position as PanelPosition];
    if (this.state[stateKey]) {
      this.handleLeaveReader(position);
    } else {
      this.handleEnterReader(position);
    }
  };
  handleLocation = () => {
    if (!this.props.htmlBook?.rendition) return;
    let position = this.props.htmlBook.rendition.getPosition();

    ConfigService.setObjectConfig(
      this.props.currentBook.key,
      position,
      "recordLocation"
    );
  };
  render() {
    const renditionProps = {
      handleLeaveReader: this.handleLeaveReader,
      handleEnterReader: this.handleEnterReader,
      isShow:
        this.state.isOpenLeftPanel ||
        this.state.isOpenTopPanel ||
        this.state.isOpenBottomPanel ||
        this.state.isOpenRightPanel,
    };
    return (
      <div className="viewer">
        <Tooltip id="my-tooltip" style={{ zIndex: 25 }} />

        <div
          className="previous-chapter-single-container"
          onClick={async () => {
            if (lock || !this.props.htmlBook?.rendition) return;
            lock = true;
            await this.props.htmlBook.rendition.prev();
            this.handleLocation();
            setTimeout(() => (lock = false), throttleTime);
          }}
          style={{
            left: this.props.isNavLocked ? 315 : 15,
            opacity: this.state.isNearEdge ? undefined : 0,
            transition: "opacity 0.3s ease",
          }}
          onMouseEnter={() => this.setState({ isNearEdge: true })}
          onMouseLeave={() => this.setState({ isNearEdge: false })}
        >
          <span className="icon-dropdown previous-chapter-single"></span>
        </div>
        <div
          className="reader-float-actions"
          style={{
            position: "absolute",
            bottom: 10,
            right:
              this.props.isSettingLocked || this.props.isDockedRight ? 315 : 15,
            display: "flex",
            flexDirection: "column-reverse",
            alignItems: "center",
            gap: "8px",
            zIndex: 10,
            opacity: this.state.isNearEdge ? 1 : 0,
            transition: "opacity 0.3s ease",
          }}
          onMouseEnter={() => this.setState({ isNearEdge: true })}
          onMouseLeave={() => this.setState({ isNearEdge: false })}
        >
          <div
            className="next-chapter-single-container"
            onClick={async () => {
              if (lock || !this.props.htmlBook?.rendition) return;
              lock = true;
              await this.props.htmlBook.rendition.next();
              this.handleLocation();
              setTimeout(() => (lock = false), throttleTime);
            }}
            style={{ position: "static" }}
          >
            <span className="icon-dropdown next-chapter-single"></span>
          </div>
          <div
            className="next-chapter-single-container"
            onClick={async () => {
              this.props.handleSpeechDialog(!this.props.isSpeechOpen);
            }}
            style={{ position: "static", transform: "rotate(0deg)" }}
          >
            <span
              style={
                this.props.isSpeechOpen
                  ? { fontWeight: "bold", marginTop: "4px" }
                  : {}
              }
              className={`icon-${this.props.isSpeechOpen ? "close" : "earphone"} next-chapter-single`}
            ></span>
          </div>
          {ConfigService.getReaderConfig("isDisableAI") !== "yes" && (
            <div
              className="next-chapter-single-container"
              onClick={this.handleOpenAssistant}
              style={{
                position: "static",
                transform: "rotate(0deg)",
                fontWeight: "bold",
                fontSize: "17px",
              }}
            >
              AI
            </div>
          )}
          {this.props.currentBook &&
            isReadingRawPDF(this.props.currentBook) &&
            this.canDraw() && (
              <div
                className="next-chapter-single-container"
                onClick={this.handleToggleDrawing}
                style={{ position: "static", transform: "rotate(0deg)" }}
              >
                <span
                  style={
                    this.props.isAnnotationOpen
                      ? { fontWeight: "bold", marginTop: "4px" }
                      : { fontSize: "17px" }
                  }
                  className={`icon-${this.props.isAnnotationOpen ? "close" : "edit"} next-chapter-single`}
                ></span>
              </div>
            )}
        </div>

        <div
          className={
            "reader-quick-tools" +
            (this.state.isOpenTopPanel ? " is-open" : "")
          }
          style={{
            position: "absolute",
            top: "0px",
            right:
              this.props.isSettingLocked || this.props.isDockedRight ? 300 : 5,
            zIndex: 10,
            width: "120px",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            opacity: this.state.isNearEdge ? 1 : 0,
            transition: "opacity 0.3s ease",
            color: ConfigService.getReaderConfig("textColor")
              ? ConfigService.getReaderConfig("textColor")
              : "",
          }}
          onMouseEnter={() => this.setState({ isNearEdge: true })}
          onMouseLeave={() => this.setState({ isNearEdge: false })}
        >
          {(this.props.readerMode === "scroll" ||
            this.props.readerMode === "single") && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
              }}
            >
              {this.state.isShowScale && (
                <div className="scale-container">
                  <div
                    style={{
                      zIndex: 100,
                      width: "100px",
                    }}
                  >
                    <input
                      className="input-value"
                      defaultValue={
                        ConfigService.getReaderConfig("scale")
                          ? parseFloat(ConfigService.getReaderConfig("scale")) *
                            100
                          : 100
                      }
                      value={
                        this.state.scale === " "
                          ? this.state.scale
                          : Math.round(parseFloat(this.state.scale) * 100)
                      }
                      type="number"
                      onInput={(event: any) => {
                        let fieldVal = event.target.value;
                        ConfigService.setReaderConfig(
                          "scale",
                          parseFloat(fieldVal) / 100 + ""
                        );
                      }}
                      onFocus={() => {
                        this.setState({ scale: " " });
                      }}
                      onChange={(event) => {
                        let fieldVal = event.target.value;
                        this.setState({
                          scale: parseFloat(fieldVal) / 100 + "",
                        });
                      }}
                      onBlur={(event) => {
                        let fieldVal = event.target.value;
                        if (fieldVal.trim() !== "") {
                          ConfigService.setReaderConfig(
                            "scale",
                            parseFloat(fieldVal) / 100 + ""
                          );
                        }
                        this.props.renderBookFunc();
                      }}
                    />
                    <span> %</span>
                  </div>

                  <input
                    className="input-progress"
                    value={this.state.scale}
                    type="range"
                    max={4}
                    min={0.5}
                    step={0.01}
                    onInput={(event: any) => {
                      const scale = event.target.value;
                      ConfigService.setReaderConfig("scale", scale);
                    }}
                    onChange={(event) => {
                      this.setState({ scale: event.target.value });
                    }}
                    onMouseUp={() => {
                      this.props.handleScale(this.state.scale);
                      this.props.renderBookFunc();
                    }}
                    style={{
                      zIndex: 100,
                      width: "120px",
                    }}
                  />
                </div>
              )}
              <div
                className="reader-zoom-in-icon-container"
                onClick={() => {
                  this.setState({ isShowScale: !this.state.isShowScale });
                }}
              >
                <span className="icon-zoom-in reader-setting-icon"></span>
              </div>
            </div>
          )}

          {this.props.currentBook.format === "PDF" &&
            this.props.readerMode === "scroll" && (
              <div
                className="reader-setting-icon-container"
                onClick={() => {
                  this.props.handlePdfCropDialog(!this.props.isPdfCropOpen);
                }}
              >
                <span
                  className="icon-crop reader-setting-icon"
                  style={{ fontSize: 24 }}
                ></span>
              </div>
            )}

          {this.props.currentBook.format === "PDF" && (
            <div
              className="reader-setting-icon-container"
              onClick={() => {
                this.props.handleConvertDialog(!this.props.isConvertOpen);
              }}
            >
              <span
                className="icon-convert-text reader-setting-icon"
                style={{ fontSize: 26 }}
              ></span>
            </div>
          )}
          <div
            className="reader-setting-icon-container"
            onClick={() => {
              this.handleEnterReader("left");
              this.handleEnterReader("right");
              this.handleEnterReader("bottom");
              this.handleEnterReader("top");
            }}
          >
            <span
              className="icon-grid reader-setting-icon"
              style={{ opacity: 1 }}
            ></span>
          </div>
        </div>
        {this.props.isSettingOpen && (
          <>
            <SettingDialog />
            <div className="drag-background"></div>
          </>
        )}
        <Toaster
          toastOptions={{
            style: {
              wordWrap: "break-word",
              wordBreak: "break-word",
              whiteSpace: "normal",
              overflowWrap: "break-word",
            },
          }}
        />

        <div
          className="left-panel"
          onMouseEnter={() => this.handleEdgeMouseEnter("left")}
          onMouseLeave={() => this.handleEdgeMouseLeave("left")}
          style={this.state.hoverPanel === "left" ? { opacity: 0.5 } : {}}
          onClick={() => {
            this.handleEnterReader("left");
          }}
        >
          <span className="icon-grid panel-icon"></span>
        </div>
        <div
          className="right-panel"
          onMouseEnter={() => this.handleEdgeMouseEnter("right")}
          onMouseLeave={() => this.handleEdgeMouseLeave("right")}
          style={
            this.state.hoverPanel === "right"
              ? {
                  opacity: 0.5,
                  right: this.props.isDockedRight ? "299px" : "0px",
                }
              : { right: this.props.isDockedRight ? "299px" : "0px" }
          }
          onClick={() => {
            this.handleEnterReader("right");
          }}
        >
          <span className="icon-grid panel-icon"></span>
        </div>
        <div
          className="top-panel"
          onMouseEnter={() => this.handleEdgeMouseEnter("top")}
          style={
            this.state.hoverPanel === "top"
              ? {
                  opacity: 0.5,
                  marginLeft:
                    this.props.isNavLocked &&
                    !this.props.isSettingLocked &&
                    !this.props.isDockedRight
                      ? 150
                      : 0,
                }
              : {
                  marginLeft:
                    this.props.isNavLocked &&
                    !this.props.isSettingLocked &&
                    !this.props.isDockedRight
                      ? 150
                      : 0,
                }
          }
          onMouseLeave={() => this.handleEdgeMouseLeave("top")}
          onClick={() => {
            this.handleEnterReader("top");
          }}
        >
          <span className="icon-grid panel-icon"></span>
        </div>
        <div
          className="bottom-panel"
          onMouseEnter={() => this.handleEdgeMouseEnter("bottom")}
          onMouseLeave={() => this.handleEdgeMouseLeave("bottom")}
          onClick={() => {
            this.handleEnterReader("bottom");
          }}
          style={
            this.state.hoverPanel === "bottom"
              ? {
                  opacity: 0.5,
                  marginLeft:
                    this.props.isNavLocked &&
                    !this.props.isSettingLocked &&
                    !this.props.isDockedRight
                      ? 150
                      : 0,
                }
              : {
                  marginLeft:
                    this.props.isNavLocked &&
                    !this.props.isSettingLocked &&
                    !this.props.isDockedRight
                      ? 150
                      : 0,
                }
          }
        >
          <span className="icon-grid panel-icon"></span>
        </div>

        <div
          className={
            "setting-panel-container" + (this.state.isOpenRightPanel ? " is-open" : "")
          }
          onMouseEnter={() => {
            this.cancelLeaveReader("right");
          }}
          onMouseLeave={() => {
            this.scheduleLeaveReader("right");
          }}
          style={
            this.state.isOpenRightPanel
              ? {}
              : {
                  transform: "translateX(309px)",
                }
          }
        >
          <SettingPanel />
        </div>
        <div
          className={
            "navigation-panel-container" + (this.state.isOpenLeftPanel ? " is-open" : "")
          }
          onClickCapture={(event) => {
            // Phones: jumping to a chapter, bookmark or note closes the sheet
            const target = event.target as HTMLElement;
            if (
              isCompact() &&
              !this.props.isNavLocked &&
              target.closest(
                ".book-content-name, .book-bookmark-list, .bookmark-page-list-item-title"
              )
            ) {
              setTimeout(() => this.handleLeaveReader("left"), 150);
            }
          }}
          onMouseEnter={() => {
            this.cancelLeaveReader("left");
          }}
          onMouseLeave={() => {
            this.scheduleLeaveReader("left");
          }}
          style={
            this.state.isOpenLeftPanel
              ? {}
              : {
                  transform: "translateX(-309px)",
                }
          }
        >
          <NavigationPanel
            {...({
              totalDuration: this.state.totalDuration,
            } as any)}
          />
        </div>
        <div
          className={
            "progress-panel-container" + (this.state.isOpenBottomPanel ? " is-open" : "")
          }
          onMouseEnter={() => {
            this.cancelLeaveReader("bottom");
          }}
          onMouseLeave={() => {
            this.scheduleLeaveReader("bottom");
          }}
          style={
            this.state.isOpenBottomPanel
              ? {
                  marginLeft:
                    this.props.isNavLocked && !this.props.isSettingLocked
                      ? 150
                      : !this.props.isNavLocked &&
                          (this.props.isSettingLocked ||
                            this.props.isDockedRight)
                        ? -150
                        : 0,
                }
              : {
                  transform: "translateY(110px)",
                  marginLeft:
                    this.props.isNavLocked && !this.props.isSettingLocked
                      ? 150
                      : !this.props.isNavLocked &&
                          (this.props.isSettingLocked ||
                            this.props.isDockedRight)
                        ? -150
                        : 0,
                }
          }
        >
          <ProgressPanel />
        </div>
        <div
          className={
            "operation-panel-container" + (this.state.isOpenTopPanel ? " is-open" : "")
          }
          onMouseEnter={() => {
            this.cancelLeaveReader("top");
          }}
          onMouseLeave={() => {
            this.scheduleLeaveReader("top");
          }}
          style={
            this.state.isOpenTopPanel
              ? {
                  marginLeft:
                    this.props.isNavLocked && !this.props.isSettingLocked
                      ? 150
                      : !this.props.isNavLocked &&
                          (this.props.isSettingLocked ||
                            this.props.isDockedRight)
                        ? -150
                        : 0,
                }
              : {
                  transform: "translateY(-110px)",
                  marginLeft:
                    this.props.isNavLocked && !this.props.isSettingLocked
                      ? 150
                      : !this.props.isNavLocked &&
                          (this.props.isSettingLocked ||
                            this.props.isDockedRight)
                        ? -150
                        : 0,
                }
          }
        >
          {this.props.htmlBook && (
            <OperationPanel
              {...({
                currentDuration: this.state.currentDuration,
              } as any)}
            />
          )}
        </div>

        {/* Phones: closes the contents and settings sheets */}
        <div
          className={
            "reader-sheet-backdrop" +
            ((this.state.isOpenLeftPanel && !this.props.isNavLocked) ||
            (this.state.isOpenRightPanel && !this.props.isSettingLocked)
              ? " is-open"
              : "")
          }
          onClick={this.closeSheets}
        ></div>
        {/* Phones: the bottom bar's shortcuts to the side panels */}
        <div
          className={
            "reader-compact-toolbar" +
            (this.state.isOpenBottomPanel ? " is-open" : "")
          }
        >
          <button
            type="button"
            onClick={() => {
              // Leaves search, which shares the sheet, and shows the contents
              this.setState({ isOpenTopPanel: false, isOpenBottomPanel: false });
              this.closeToolPopovers();
              toggleNavTab("contents");
            }}
          >
            <span className="icon-grid"></span>
            <Trans>Contents</Trans>
          </button>
          <button
            type="button"
            onClick={() => {
              this.setState({ isOpenTopPanel: false, isOpenBottomPanel: false });
              this.closeToolPopovers();
              searchInTheBook("", "", false);
            }}
          >
            <span className="icon-search"></span>
            <Trans>Search</Trans>
          </button>
          <button
            type="button"
            className={this.props.isSpeechOpen ? "is-active" : ""}
            onClick={() => {
              this.setState({ isOpenTopPanel: false, isOpenBottomPanel: false });
              this.props.handleSpeechDialog(!this.props.isSpeechOpen);
            }}
          >
            <span className="icon-earphone"></span>
            <Trans>Listen</Trans>
          </button>
          {ConfigService.getReaderConfig("isDisableAI") !== "yes" && (
            <button
              type="button"
              onClick={() => {
                this.setState({
                  isOpenTopPanel: false,
                  isOpenBottomPanel: false,
                });
                this.handleOpenAssistant();
              }}
            >
              <span className="reader-compact-toolbar-text-icon">AI</span>
              <Trans>Assistant</Trans>
            </button>
          )}
          {this.canDraw() && (
            <button
              type="button"
              className={this.props.isAnnotationOpen ? "is-active" : ""}
              onClick={() => {
                this.setState({
                  isOpenTopPanel: false,
                  isOpenBottomPanel: false,
                });
                this.handleToggleDrawing();
              }}
            >
              <span className="icon-edit"></span>
              <Trans>Draw</Trans>
            </button>
          )}
          <button type="button" onClick={() => this.openSheet("right")}>
            <span className="icon-setting"></span>
            <Trans>Setting</Trans>
          </button>
        </div>

        {this.props.currentBook.key && <Viewer {...(renditionProps as any)} />}
        {this.props.isConvertOpen && <ConvertDialog />}
        {this.props.isPdfCropOpen && <PdfCropDialog />}
        {this.props.isOpenPopupOptionDialog && <PopupOptionDialog />}
        {
          <div
            style={
              this.props.isSpeechOpen
                ? {}
                : {
                    display: "none",
                  }
            }
          >
            <SpeechDialog />
          </div>
        }
        {this.props.isAnnotationOpen && <AnnotationDialog />}
      </div>
    );
  }
}

export default Reader;
