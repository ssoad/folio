import React from "react";
import "./popupMenu.css";
import { isReadingRawPDF, isSameRect } from "../../../utils/common";
import PopupOption from "../popupOption";
import ColorOption from "../../colorOption";
import { PopupMenuProps, PopupMenuStates } from "./interface";
import {
  clearIframeSelection,
  getIframeDoc,
} from "../../../utils/reader/docUtil";
import {
  ConfigService,
  HighlightUtil,
} from "../../../assets/lib/kookit-extra-browser.min";
import {
  getSelection,
  getSelectionSentence,
} from "../../../utils/reader/mouseEvent";
import { createHighlight } from "../../../utils/reader/noteUtil";
import { KookitConfig } from "../../../assets/lib/kookit-extra-browser.min";
import { copyIframeSelection } from "../../../utils/reader/docUtil";
import { isCompact } from "../../../utils/platform";
import PhoneIcon from "../../readerPhone/phoneIcons";
import toast from "react-hot-toast";

declare var window: any;

const MENU_WIDTH = 252;
const MENU_HEIGHT = 141;

class PopupMenu extends React.Component<PopupMenuProps, PopupMenuStates> {
  highlighter: any;
  highlightUtil: any;
  timer!: NodeJS.Timeout;
  key: any;
  mode: string;
  showNote: boolean;
  isFirstShow: boolean;
  rect: any;
  constructor(props: PopupMenuProps) {
    super(props);
    this.highlightUtil = new HighlightUtil(ConfigService);
    this.showNote = false;
    this.isFirstShow = false;
    this.highlighter = null;
    this.mode = "";
    this.state = {
      deleteKey: "",
      rect: this.props.rect,
      isRightEdge: false,
      isExpanded: false,
    };
  }
  componentDidUpdate(prevProps: PopupMenuProps) {
    // The next selection starts from the short pill again
    if (
      prevProps.isOpenMenu &&
      !this.props.isOpenMenu &&
      this.state.isExpanded
    ) {
      this.setState({ isExpanded: false });
    }
  }
  // Phone pill: a colour highlights straight away and becomes the default
  handlePillColor = async (color: string) => {
    const value = { styleType: this.props.highlight.styleType, color };
    this.props.handleHighlight(value);
    this.highlightUtil.saveNoteHighlightValue(value);
    await createHighlight({
      currentBook: this.props.currentBook,
      htmlBook: this.props.htmlBook,
      chapterDocIndex: this.props.chapterDocIndex,
      chapter: this.props.chapter,
      color: this.highlightUtil.formatHighlightValue(value),
      t: this.props.t,
      onNoteClick: (event: Event) => {
        this.props.handleNoteKey((event.target as any).dataset.key);
        this.props.handleMenuMode("note");
        this.props.handleOpenMenu(true);
      },
      onSuccess: () => {
        this.props.handleOpenMenu(false);
        this.props.handleFetchNotes();
        this.props.handleMenuMode("");
        clearIframeSelection(this.props.currentBook.format);
      },
    });
  };
  handlePillCopy = () => {
    const format = this.props.currentBook.format;
    const isCopied = copyIframeSelection(
      format,
      getSelection(format),
      isReadingRawPDF(this.props.currentBook)
    );
    if (!isCopied) return;
    this.props.handleOpenMenu(false);
    this.props.handleMenuMode("");
    clearIframeSelection(format);
    toast.success(this.props.t("Copying successful"));
  };
  renderPill = () => {
    const styleType = this.props.highlight.styleType;
    const colors = (KookitConfig.HighlightPresetColors[styleType] || []).slice(
      0,
      4
    );
    // Taps act on press, before the selection in the book can collapse
    const press =
      (action: () => void) =>
      (event: React.PointerEvent | React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      };
    const stop = (event: React.SyntheticEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    return (
      <div
        className="popup-pill"
        role="toolbar"
        onTouchStart={stop}
        onClick={stop}
      >
        {colors.map((color) => (
          <button
            type="button"
            key={color}
            className={
              "popup-pill-color" +
              (color === this.props.highlight.color ? " is-active" : "")
            }
            style={{ backgroundColor: color }}
            aria-label={this.props.t("Highlight")}
            onPointerDown={press(() => this.handlePillColor(color))}
          />
        ))}
        <span className="popup-pill-divider" />
        <button
          type="button"
          className="popup-pill-action"
          aria-label={this.props.t("Note")}
          onPointerDown={press(() => {
            this.props.handleMenuMode("note");
            this.props.handleOpenMenu(true);
          })}
        >
          <PhoneIcon name="note" />
        </button>
        <button
          type="button"
          className="popup-pill-action"
          aria-label={this.props.t("Copy")}
          onPointerDown={press(this.handlePillCopy)}
        >
          <PhoneIcon name="copy" />
        </button>
        <button
          type="button"
          className="popup-pill-action"
          aria-label={this.props.t("More")}
          onPointerDown={press(() => this.setState({ isExpanded: true }))}
        >
          <PhoneIcon name="moreHorizontal" />
        </button>
      </div>
    );
  };
  UNSAFE_componentWillReceiveProps(nextProps: PopupMenuProps) {
    if (!nextProps.rect && this.props.rect) {
      this.setState({ rect: null });
      if (this.props.isOpenMenu && this.props.menuMode === "menu") {
        this.props.handleOpenMenu(false);
        this.props.handleMenuMode("");
      }
      return;
    }
    if (nextProps.rect && !isSameRect(this.props.rect, nextProps.rect)) {
      this.setState(
        {
          rect: nextProps.rect,
        },
        () => {
          if (
            this.props.isOpenMenu &&
            this.props.menuMode !== "menu" &&
            this.props.menuMode !== ""
          ) {
            return;
          }
          if (this.props.isOpenMenu && this.props.menuMode === "menu") {
            this.showMenu();
          } else if (!this.props.isOpenMenu) {
            this.openMenu();
          }
        }
      );
    }
  }

  handleShowDelete = (deleteKey: string) => {
    this.setState({ deleteKey });
  };
  showMenu = () => {
    let rect = this.state.rect;
    if (!rect) return;
    let { posX, posY } = this.getHtmlPosition(rect);
    this.setState({ isRightEdge: false, posX, posY });
    this.props.handleOpenMenu(true);
  };
  getHtmlPosition(rect: any) {
    let pageSize = this.props.rendition.getPageSize(this.props.chapterDocIndex);
    let posY = rect.bottom - pageSize.scrollTop;
    let posX = rect.left + rect.width / 2;
    // fix popup position when crossing pages
    if (rect.width > pageSize.sectionWidth && rect.left < 0) {
      posX = rect.left + rect.width;
    }
    if (
      rect.top < MENU_HEIGHT &&
      pageSize.height - rect.top - rect.height < MENU_HEIGHT &&
      this.props.readerMode !== "scroll"
    ) {
      this.props.handleChangeDirection(true);
      posY = rect.top + 16 + pageSize.top;
    } else if (
      pageSize.height - rect.height < MENU_HEIGHT &&
      pageSize.height - rect.height > -10
    ) {
      this.props.handleChangeDirection(true);
      posY = rect.top - pageSize.scrollTop + 16;
    } else if (
      rect.height - pageSize.height > 0 &&
      this.props.readerMode === "scroll"
    ) {
      posY = 40;
    } else if (posY < pageSize.height - MENU_HEIGHT + pageSize.top) {
      this.props.handleChangeDirection(true);
      posY = posY + 16 + pageSize.top;
    } else {
      posY = posY - rect.height - MENU_HEIGHT + pageSize.top;
    }
    posX = posX - MENU_WIDTH / 2 + pageSize.left;
    if (
      isReadingRawPDF(this.props.currentBook) &&
      this.props.readerMode === "double" &&
      this.props.chapterDocIndex % 2 === 1
    ) {
      posX = posX + pageSize.sectionWidth + pageSize.gap;
    }
    if (
      isReadingRawPDF(this.props.currentBook) &&
      this.props.readerMode === "scroll" &&
      posY < 0
    ) {
      posY = posY + pageSize.offsetTop;
    }
    if (posY < 0) {
      posY = 16;
    }
    if (posY > pageSize.height - MENU_HEIGHT) {
      posY = pageSize.height - MENU_HEIGHT;
    }
    if (
      this.props.readerMode === "scroll" &&
      this.props.currentBook.format === "PDF"
    ) {
      posX = posX - pageSize.scrollLeft;
    }
    return {
      posX: Math.min(Math.max(12, posX), window.innerWidth - 12 - MENU_WIDTH),
      posY,
    } as any;
  }

  openMenu = () => {
    this.setState({ deleteKey: "" });
    let docs = getIframeDoc(this.props.currentBook.format);
    let sel: Selection | null = null;
    for (let i = 0; i < docs.length; i++) {
      let doc = docs[i];
      if (!doc) continue;
      if (isReadingRawPDF(this.props.currentBook)) {
        let targetIframe = doc?.defaultView?.frameElement;
        let id = targetIframe?.getAttribute("id") || "";
        let chapterDocIndex = id ? parseInt(id.split("-").reverse()[0]) : 0;
        if (chapterDocIndex !== this.props.chapterDocIndex) {
          continue;
        }
      }

      sel = doc.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        break;
      }
    }
    this.props.handleChangeDirection(false);
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      if (this.props.isOpenMenu) {
        this.props.handleMenuMode("");
        this.props.handleOpenMenu(false);
        this.props.handleNoteKey("");
      }
      return;
    }

    const selectAction = ConfigService.getReaderConfig("selectAction");
    if (selectAction && selectAction !== "") {
      this.handleSelectAction(selectAction, sel);
      return;
    }

    this.showMenu();
    this.props.handleMenuMode("menu");
  };

  handleDigest = async () => {
    await createHighlight({
      currentBook: this.props.currentBook,
      htmlBook: this.props.htmlBook,
      chapterDocIndex: this.props.chapterDocIndex,
      chapter: this.props.chapter,
      color: this.highlightUtil.formatHighlightValue(this.props.highlight),
      t: this.props.t,
      onNoteClick: (event: Event) => {
        this.props.handleNoteKey((event.target as any).dataset.key);
        this.props.handleMenuMode("note");
        this.props.handleOpenMenu(true);
      },
      onSuccess: () => {
        this.props.handleOpenMenu(false);
        this.props.handleFetchNotes();
        this.props.handleMenuMode("");
        clearIframeSelection(this.props.currentBook.format);
      },
    });
  };

  handleSelectAction = async (action: string, sel: Selection) => {
    const format = this.props.currentBook.format;
    const text = getSelection(format);
    if (!text) return;

    switch (action) {
      case "translation":
        this.props.handleOriginalText(text);
        this.props.handleMenuMode("trans");
        this.props.handleOpenMenu(true);
        break;
      case "dict":
        this.props.handleOriginalText(text);
        this.props.handleOriginalSentence(getSelectionSentence(format));
        this.props.handleMenuMode("dict");
        this.props.handleOpenMenu(true);
        break;
      case "highlight":
        await createHighlight({
          currentBook: this.props.currentBook,
          htmlBook: this.props.htmlBook,
          chapterDocIndex: this.props.chapterDocIndex,
          chapter: this.props.chapter,
          color: this.highlightUtil.formatHighlightValue(this.props.highlight),
          t: this.props.t,
          onSuccess: () => {
            this.props.handleOpenMenu(false);
          },
        });
        break;
      case "note":
        this.props.handleMenuMode("note");
        this.showMenu();
        this.props.handleOpenMenu(true);
        break;
      case "speaker":
        const msg = new SpeechSynthesisUtterance();
        msg.text = text;
        if (window.speechSynthesis && window.speechSynthesis.getVoices) {
          msg.voice = window.speechSynthesis.getVoices()[0];
          window.speechSynthesis.speak(msg);
        }
        break;
      default:
        this.showMenu();
        this.props.handleMenuMode("menu");
        break;
    }
  };

  render() {
    const PopupProps = {
      chapterDocIndex: this.props.chapterDocIndex,
      chapter: this.props.chapter,
    };
    const ColorProps = {
      handleDigest: this.handleDigest,
      t: this.props.t,
    };
    const isVisible = this.props.isOpenMenu && this.props.menuMode === "menu";
    const containerStyle: React.CSSProperties = isVisible
      ? {
          left:
            this.state.posX !== undefined ? `${this.state.posX}px` : undefined,
          top:
            this.state.posY !== undefined ? `${this.state.posY}px` : undefined,
        }
      : { display: "none" };
    return (
      <div>
        <div className="popup-menu-container" style={containerStyle}>
          {isCompact() && !this.state.isExpanded ? (
            this.renderPill()
          ) : (
            <div
              className="popup-menu-card"
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="popup-color-box">
                <ColorOption {...(ColorProps as any)} />
              </div>
              <div className="popup-menu-divider" />
              <div className="popup-menu-box">
                <PopupOption {...(PopupProps as any)} />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
}

export default PopupMenu;
