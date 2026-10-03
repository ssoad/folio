import React from "react";
import "./popupOption.css";

import { PopupOptionProps } from "./interface";
import {
  getEnabledPopupOptionKeys,
  popupOptionMap,
  PopupOptionKey,
} from "../../../constants/popupList";
import {
  ConfigService,
  HighlightUtil,
} from "../../../assets/lib/kookit-extra-browser.min";
import toast from "react-hot-toast";
import {
  getSelection,
  getSelectionSentence,
  searchInTheBook,
} from "../../../utils/reader/mouseEvent";
import copy from "copy-text-to-clipboard";
import { clearIframeSelection, getIframeDoc } from "../../../utils/reader/docUtil";
import { isReadingRawPDF, openExternalUrl } from "../../../utils/common";
import { createHighlight } from "../../../utils/reader/noteUtil";
import { Tooltip } from "react-tooltip";

declare var window: any;

class PopupOption extends React.Component<PopupOptionProps> {
  highlightUtil: any;
  constructor(props: PopupOptionProps) {
    super(props);
    this.highlightUtil = new HighlightUtil(ConfigService);
  }
  handleNote = () => {
    this.props.handleMenuMode("note");
    this.props.handleOpenMenu(true);
  };
  handleCopy = () => {
    const format = this.props.currentBook.format;
    let text = getSelection(format);
    if (!text) return;
    if (isReadingRawPDF(this.props.currentBook)) {
      text = text.split("\n").join(" ").trim();
    }
    let copied = false;
    const docs = getIframeDoc(format);
    for (let i = 0; i < docs.length && !copied; i++) {
      const doc = docs[i];
      if (!doc) continue;
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.toString().trim()) continue;
      try {
        copied = doc.execCommand("copy");
      } catch (e) {}
    }
    if (!copied) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {
          copy(text);
        });
      } else {
        copy(text);
      }
    }
    this.props.handleOpenMenu(false);
    this.props.handleMenuMode("");
    clearIframeSelection(format);
    toast.success(this.props.t("Copying successful"));
  };
  handleTrans = () => {
    this.props.handleMenuMode("trans");
    this.props.handleOriginalText(getSelection(this.props.currentBook.format));
    this.props.handleOpenMenu(true);
  };
  handleDict = () => {
    this.props.handleMenuMode("dict");
    this.props.handleOriginalText(getSelection(this.props.currentBook.format));
    this.props.handleOriginalSentence(
      getSelectionSentence(this.props.currentBook.format)
    );
    this.props.handleOpenMenu(true);
  };
  handleDigest = async () => {
    await createHighlight({
      currentBook: this.props.currentBook,
      htmlBook: this.props.htmlBook,
      chapterDocIndex: this.props.chapterDocIndex,
      chapter: this.props.chapter,
      color: this.highlightUtil.formatHighlightValue(this.props.highlight),
      t: this.props.t,
      onNoteClick: this.handleNoteClick,
      onSuccess: () => {
        this.props.handleOpenMenu(false);
        this.props.handleFetchNotes();
        this.props.handleMenuMode("");
        clearIframeSelection(this.props.currentBook.format);
      },
    });
  };

  handleNoteClick = (event: Event) => {
    this.props.handleNoteKey((event.target as any).dataset.key);
    this.props.handleMenuMode("note");
    this.props.handleOpenMenu(true);
  };
  handleJump = (url: string) => {
    openExternalUrl(url);
  };
  handleSearchInternet = () => {
    switch (ConfigService.getReaderConfig("searchEngine")) {
      case "google":
        this.handleJump(
          "https://www.google.com/search?q=" +
            getSelection(this.props.currentBook.format)
        );
        break;
      case "baidu":
        this.handleJump(
          "https://www.baidu.com/s?wd=" +
            getSelection(this.props.currentBook.format)
        );
        break;
      case "bing":
        this.handleJump(
          "https://www.bing.com/search?q=" +
            getSelection(this.props.currentBook.format)
        );
        break;
      case "duckduckgo":
        this.handleJump(
          "https://duckduckgo.com/?q=" +
            getSelection(this.props.currentBook.format)
        );
        break;
      case "yandex":
        this.handleJump(
          "https://yandex.com/search/?text=" +
            getSelection(this.props.currentBook.format)
        );
        break;
      case "yahoo":
        this.handleJump(
          "https://search.yahoo.com/search?p=" +
            getSelection(this.props.currentBook.format)
        );
        break;
      case "naver":
        this.handleJump(
          "https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=1&ie=utf8&query=" +
            getSelection(this.props.currentBook.format)
        );
        break;
      case "baike":
        this.handleJump(
          "https://baike.baidu.com/item/" +
            getSelection(this.props.currentBook.format)
        );
        break;
      case "wiki":
        this.handleJump(
          "https://en.wikipedia.org/wiki/" +
            getSelection(this.props.currentBook.format)
        );
        break;
      default:
        this.handleJump(
          navigator.language === "zh-CN"
            ? "https://www.baidu.com/s?wd=" +
                getSelection(this.props.currentBook.format)
            : "https://www.google.com/search?q=" +
                getSelection(this.props.currentBook.format)
        );
        break;
    }
    this.props.handleOpenMenu(false);
    this.props.handleMenuMode("");
    clearIframeSelection(this.props.currentBook.format);
  };
  handleSearchBook = () => {
    searchInTheBook("", this.props.currentBook.format, true);
    this.props.handleOpenMenu(false);
    this.props.handleMenuMode("");
    clearIframeSelection(this.props.currentBook.format);
  };

  handleSpeak = () => {
    var msg = new SpeechSynthesisUtterance();
    msg.text = getSelection(this.props.currentBook.format);
    if (window.speechSynthesis && window.speechSynthesis.getVoices) {
      msg.voice = window.speechSynthesis.getVoices()[0];
      window.speechSynthesis.speak(msg);
    }
    this.props.handleOpenMenu(false);
    this.props.handleMenuMode("");
    clearIframeSelection(this.props.currentBook.format);
  };

  handleReadFromHere = () => {
    const text =
      getSelectionSentence(this.props.currentBook.format) ||
      getSelection(this.props.currentBook.format);
    if (!text) return;

    this.props.handleSpeechStartText(text);
    this.props.handleSpeechAutoStart(true);
    this.props.handleSpeechDialog(true);
    this.props.handleOpenMenu(false);
    this.props.handleMenuMode("");
    clearIframeSelection(this.props.currentBook.format);
  };

  handleAssistant = () => {
    const text = getSelection(this.props.currentBook.format);
    if (!text) return;

    this.props.handleQuoteText(text);
    this.props.handleMenuMode("assistant");
    this.props.handleOpenMenu(true);
  };

  handleOpenPopupOptionDialog = () => {
    this.props.handleOpenMenu(false);
    this.props.handleMenuMode("");
    this.props.handlePopupOptionDialog(true);
    clearIframeSelection(this.props.currentBook.format);
  };

  handleOptionClick = (optionKey: PopupOptionKey) => {
    switch (optionKey) {
      case "note":
        this.handleNote();
        break;
      case "highlight":
        this.handleDigest();
        break;
      case "translation":
        this.handleTrans();
        break;
      case "copy":
        this.handleCopy();
        break;
      case "search-book":
        this.handleSearchBook();
        break;
      case "dict":
        this.handleDict();
        break;
      case "browser":
        this.handleSearchInternet();
        break;
      case "speaker":
        this.handleSpeak();
        break;
      case "speech-start":
        this.handleReadFromHere();
        break;
      case "assistant":
        this.handleAssistant();
        break;
      default:
        break;
    }
  };

  getOptionLabel = (key: PopupOptionKey | "setting", title: string): string => {
    const t = this.props.t;
    const isEn = !navigator.language || navigator.language.startsWith("en");
    if (isEn) {
      switch (key) {
        case "copy":
          return "Copy";
        case "highlight":
          return "Highlight";
        case "note":
          return "Note";
        case "translation":
          return "Translate";
        case "dict":
          return "Dictionary";
        case "search-book":
          return "In Book";
        case "browser":
          return "Web";
        case "speaker":
          return "Speak";
        case "speech-start":
          return "Read";
        case "assistant":
          return "Ask AI";
        case "setting":
          return "More";
        default:
          return title;
      }
    }
    switch (key) {
      case "copy":
        return t("Copy");
      case "highlight":
        return t("Highlight");
      case "note":
        return t("Note");
      case "translation":
        return t("Translate");
      case "dict":
        return t("Dictionary");
      case "search-book":
        return t("Search in the Book");
      case "browser":
        return t("Search on the Internet");
      case "speaker":
        return t("Speak the text");
      case "speech-start":
        return t("Read from here");
      case "assistant":
        return t("Ask AI");
      case "setting":
        return t("More");
      default:
        return t(title);
    }
  };

  render() {
    const popupOptionKeys = getEnabledPopupOptionKeys().filter((item) => {
      return !(
        item === "assistant" &&
        ConfigService.getReaderConfig("isDisableAI") === "yes"
      );
    });
    return (
      <div className="menu-list">
        <Tooltip id="option-tooltip" style={{ zIndex: 25 }} />
        {popupOptionKeys.map((itemKey) => {
          const item = popupOptionMap[itemKey];
          return (
            <button
              type="button"
              key={item.key}
              className={`menu-option-btn ${item.name}-option`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                this.handleOptionClick(item.key);
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              data-tooltip-id="option-tooltip"
              data-tooltip-content={this.props.t(item.title)}
              title={this.props.t(item.title)}
              aria-label={this.props.t(item.title)}
            >
              <span className={`menu-icon-badge ${item.name}-badge`}>
                <span
                  className={`icon-${item.icon} ${item.name}-icon`}
                  style={{ pointerEvents: "none" }}
                ></span>
              </span>
              <span className="menu-item-label">
                {this.getOptionLabel(item.key, item.title)}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          className="menu-option-btn setting-option"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            this.handleOpenPopupOptionDialog();
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          data-tooltip-id="option-tooltip"
          data-tooltip-content={this.props.t("Customize popup menu")}
          title={this.props.t("Customize popup menu")}
          aria-label={this.props.t("Customize popup menu")}
        >
          <span className="menu-icon-badge setting-badge">
            <span
              className="icon-setting setting-icon"
              style={{ pointerEvents: "none" }}
            ></span>
          </span>
          <span className="menu-item-label">
            {this.getOptionLabel("setting", "Customize popup menu")}
          </span>
        </button>
      </div>
    );
  }
}

export default PopupOption;
