import React from "react";
import "./displaySheet.css";
import { Trans } from "react-i18next";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { isReadingRawPDF } from "../../../utils/common";
import PhoneIcon from "../phoneIcons";
import { DisplaySheetProps, DisplaySheetState, ReaderTheme } from "./interface";

// The phone reader's "Aa" sheet: the few display settings people change
// while reading. Everything else is under "More settings" (the full panel).
const THEMES: ReaderTheme[] = [
  { key: "auto", label: "Auto", backgroundColor: "", textColor: "" },
  {
    key: "light",
    label: "Light",
    backgroundColor: "rgba(255,255,255,1)",
    textColor: "rgba(0,0,0,1)",
  },
  {
    key: "sepia",
    label: "Sepia",
    backgroundColor: "rgba(246,239,224,1)",
    textColor: "rgba(77,62,44,1)",
  },
  // The engine's own dark background, which PDFs follow (isReaderDark in
  // containers/viewer)
  {
    key: "dark",
    label: "Dark",
    backgroundColor: "rgba(44,47,49,1)",
    textColor: "rgba(255,255,255,1)",
  },
  {
    key: "black",
    label: "Black",
    backgroundColor: "rgba(0,0,0,1)",
    textColor: "rgba(200,200,200,1)",
  },
];
const FONT_SIZE_MIN = 13;
const FONT_SIZE_MAX = 40;

const currentThemeKey = () => {
  const bg = ConfigService.getReaderConfig("backgroundColor") || "";
  const text = ConfigService.getReaderConfig("textColor") || "";
  const match = THEMES.find(
    (theme) =>
      theme.backgroundColor === bg &&
      (!theme.textColor || theme.textColor === text)
  );
  return match ? match.key : bg ? "custom" : "auto";
};

class DisplaySheet extends React.Component<
  DisplaySheetProps,
  DisplaySheetState
> {
  private fontTimer = 0;
  constructor(props: DisplaySheetProps) {
    super(props);
    this.state = {
      fontSize: parseInt(ConfigService.getReaderConfig("fontSize") || "17"),
      brightness: parseFloat(
        ConfigService.getReaderConfig("brightness") || "1"
      ),
      themeKey: currentThemeKey(),
    };
  }
  componentWillUnmount() {
    window.clearTimeout(this.fontTimer);
  }
  // The book isn't loaded on the first render after opening the reader
  isFixedLayout = () =>
    !!this.props.currentBook?.format &&
    (isReadingRawPDF(this.props.currentBook) ||
      this.props.currentBook.format.startsWith("CB"));

  // Re-laying out a book is slow, so a run of taps on A−/A+ renders once
  handleFontSize = (step: number) => {
    const fontSize = Math.min(
      FONT_SIZE_MAX,
      Math.max(FONT_SIZE_MIN, this.state.fontSize + step)
    );
    if (fontSize === this.state.fontSize) return;
    this.setState({ fontSize });
    ConfigService.setReaderConfig("fontSize", fontSize + "");
    window.clearTimeout(this.fontTimer);
    this.fontTimer = window.setTimeout(() => this.props.renderBookFunc(), 450);
  };
  handleTheme = (theme: ReaderTheme) => {
    ConfigService.setReaderConfig("backgroundColor", theme.backgroundColor);
    ConfigService.setReaderConfig("textColor", theme.textColor);
    this.props.handleBackgroundColor(theme.backgroundColor);
    this.setState({ themeKey: theme.key });
    this.props.renderBookFunc();
  };
  handleLayout = (mode: string) => {
    if (mode === this.props.readerMode) return;
    ConfigService.setReaderConfig(
      this.isFixedLayout() ? "pdfReaderMode" : "readerMode",
      mode
    );
    this.props.handleReaderMode(mode);
    this.props.renderBookFunc();
  };
  // Shown live on the page; saved when the slider is let go
  handleBrightness = (brightness: number) => {
    this.setState({ brightness });
    const page = document.querySelector(".background") as HTMLElement | null;
    if (page) {
      const invert =
        ConfigService.getReaderConfig("isInvert") === "yes" ? 1 : 0;
      page.style.filter = `brightness(${brightness}) invert(${invert})`;
    }
  };
  saveBrightness = () => {
    ConfigService.setReaderConfig("brightness", this.state.brightness + "");
  };
  render() {
    const { isOpen } = this.props;
    const isScroll = this.props.readerMode === "scroll";
    return (
      <>
        <div
          className={"display-sheet-backdrop" + (isOpen ? " is-open" : "")}
          onClick={this.props.onClose}
        ></div>
        <div
          className={"display-sheet" + (isOpen ? " is-open" : "")}
          role="dialog"
          aria-label={this.props.t("Display")}
        >
          <div className="display-sheet-grabber"></div>

          {!this.isFixedLayout() && (
            <div className="display-sheet-row">
              <button
                type="button"
                className="display-sheet-step"
                onClick={() => this.handleFontSize(-1)}
                aria-label={this.props.t("Smaller text")}
              >
                <span style={{ fontSize: 14 }}>A</span>
              </button>
              <div className="display-sheet-value">
                <span className="display-sheet-label">
                  <Trans>Text size</Trans>
                </span>
                <span className="display-sheet-number">
                  {this.state.fontSize}
                </span>
              </div>
              <button
                type="button"
                className="display-sheet-step"
                onClick={() => this.handleFontSize(1)}
                aria-label={this.props.t("Larger text")}
              >
                <span style={{ fontSize: 21 }}>A</span>
              </button>
            </div>
          )}

          <div className="display-sheet-themes" role="radiogroup">
            {THEMES.map((theme) => (
              <button
                type="button"
                key={theme.key}
                role="radio"
                aria-checked={this.state.themeKey === theme.key}
                className={
                  "display-sheet-theme" +
                  (this.state.themeKey === theme.key ? " is-active" : "") +
                  (theme.key === "auto" ? " is-auto" : "")
                }
                style={
                  theme.backgroundColor
                    ? {
                        backgroundColor: theme.backgroundColor,
                        color: theme.textColor,
                      }
                    : undefined
                }
                onClick={() => this.handleTheme(theme)}
              >
                <span className="display-sheet-theme-glyph">Aa</span>
                <span className="display-sheet-theme-name">
                  <Trans>{theme.label}</Trans>
                </span>
              </button>
            ))}
          </div>

          <div className="display-sheet-segmented" role="radiogroup">
            <button
              type="button"
              role="radio"
              aria-checked={isScroll}
              className={isScroll ? "is-active" : ""}
              onClick={() => this.handleLayout("scroll")}
            >
              <Trans>Scroll</Trans>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!isScroll}
              className={!isScroll ? "is-active" : ""}
              onClick={() => this.handleLayout("single")}
            >
              <Trans>Pages</Trans>
            </button>
          </div>

          <div className="display-sheet-brightness">
            <PhoneIcon name="sun" size={18} />
            <input
              type="range"
              min={0.3}
              max={1}
              step={0.05}
              value={this.state.brightness}
              aria-label={this.props.t("Brightness")}
              onChange={(event) =>
                this.handleBrightness(parseFloat(event.target.value))
              }
              onPointerUp={this.saveBrightness}
              onTouchEnd={this.saveBrightness}
              onKeyUp={this.saveBrightness}
            />
            <PhoneIcon name="sun" size={24} />
          </div>

          <button
            type="button"
            className="display-sheet-more"
            onClick={this.props.onMoreSettings}
          >
            <Trans>More settings</Trans>
          </button>
        </div>
      </>
    );
  }
}

export default DisplaySheet;
