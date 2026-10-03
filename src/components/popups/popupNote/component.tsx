import React from "react";
import "./popupNote.css";
import { isReadingRawPDF } from "../../../utils/common";
import Note from "../../../models/Note";
import _ from "underscore";
import { PopupNoteProps, PopupNoteState } from "./interface";
import NoteTag from "../../noteTag";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { clearIframeSelection, getIframeDoc } from "../../../utils/reader/docUtil";
import {
  ConfigService,
  HighlightUtil,
  NoteSyncManager,
} from "../../../assets/lib/kookit-extra-browser.min";
import DatabaseService from "../../../utils/storage/databaseService";
import ColorOption from "../../colorOption";
import copy from "copy-text-to-clipboard";
class PopupNote extends React.Component<PopupNoteProps, PopupNoteState> {
  highlightUtil: any;
  constructor(props: PopupNoteProps) {
    super(props);
    this.highlightUtil = new HighlightUtil(ConfigService);
    this.state = { tag: [], text: "", note: null };
  }
  highlightRange: string = "{}";
  actualChapterDocIndex: number = 0;

  async componentDidMount() {
    let textArea: any = document.querySelector(".editor-box");
    textArea && textArea.focus();
    if (this.props.noteKey) {
      let note: Note = await DatabaseService.getRecord(
        this.props.noteKey,
        "notes"
      );
      this.setState({
        text: note.text,
        tag: note.tag,
        note: note,
      });
      textArea.value = note.notes;
      let { styleType, color } = this.highlightUtil.getHighlightValue(
        note.color || "background-#FEF3CD"
      );
      this.props.handleHighlight({
        styleType,
        color,
      });
    } else {
      let docs = getIframeDoc(this.props.currentBook.format);
      let text = "";
      let actualChapterDocIndex = this.props.chapterDocIndex;
      for (let i = 0; i < docs.length; i++) {
        let doc = docs[i];
        if (!doc) continue;
        const sel = doc.getSelection();
        if (sel && sel.rangeCount > 0 && sel.toString().trim()) {
          text = sel.toString();
          if (isReadingRawPDF(this.props.currentBook)) {
            let frame = doc.defaultView?.frameElement;
            let id = frame?.getAttribute("id") || "";
            if (id) {
              actualChapterDocIndex = parseInt(id.split("-").reverse()[0]);
            }
          }
          break;
        }
      }
      if (!text) return;

      text = text.replace(/\s\s/g, "");
      text = text.replace(/\r/g, "");
      text = text.replace(/\n/g, "");
      text = text.replace(/\t/g, "");
      text = text.replace(/\f/g, "");
      this.setState({ text });

      let coords = null;
      try {
        if (this.props.htmlBook?.rendition?.getHighlightCoords) {
          coords = await this.props.htmlBook.rendition.getHighlightCoords(
            actualChapterDocIndex
          );
        }
      } catch (e) {}
      this.highlightRange = JSON.stringify(coords || {});
      this.actualChapterDocIndex = actualChapterDocIndex;
    }
  }
  handleTag = (tag: string[]) => {
    this.setState({ tag });
  };

  handleNoteClick = (event: Event) => {
    this.props.handleNoteKey((event.target as any).dataset.key);
    this.props.handleMenuMode("note");
    this.props.handleOpenMenu(true);
  };
  async createNote() {
    let notes = (document.querySelector(".editor-box") as HTMLInputElement)
      .value;

    if (this.props.noteKey) {
      let newNote = await DatabaseService.getRecord(
        this.props.noteKey,
        "notes"
      );
      newNote.notes = notes;
      newNote.tag = this.state.tag;
      newNote.color =
        this.highlightUtil.formatHighlightValue(this.props.highlight) ||
        newNote.color;
      DatabaseService.updateRecord(newNote, "notes").then(() => {
        this.props.handleOpenMenu(false);
        this.props.handleFetchNotes();
        this.props.handleMenuMode("");
        this.props.handleNoteKey("");
        this.props.handleShowPopupNote(false);
        clearIframeSelection(this.props.currentBook.format);
        if (this.props.htmlBook && this.props.htmlBook.rendition) {
          try {
            this.props.htmlBook.rendition.removeOneNote(
              this.props.noteKey,
              this.props.chapterDocIndex
            );
            this.props.htmlBook.rendition.createOneNote(
              newNote,
              this.handleNoteClick
            );
          } catch (e) {
            console.warn("Update note rendition failed:", e);
          }
        }
      });
    } else {
      let cfi = JSON.stringify(
        ConfigService.getObjectConfig(
          this.props.currentBook.key,
          "recordLocation",
          {}
        )
      );
      let actualChapterDocIndex =
        this.actualChapterDocIndex !== undefined
          ? this.actualChapterDocIndex
          : this.props.chapterDocIndex;
      if (isReadingRawPDF(this.props.currentBook)) {
        let bookLocation = this.props.htmlBook.rendition.getPositionByChapter(
          actualChapterDocIndex
        );
        cfi = JSON.stringify(bookLocation);
      }
      let bookKey = this.props.currentBook.key;
      let range = this.highlightRange;
      if (!range || range === "{}") {
        let coords = null;
        try {
          if (this.props.htmlBook?.rendition?.getHighlightCoords) {
            coords = await this.props.htmlBook.rendition.getHighlightCoords(
              actualChapterDocIndex
            );
          }
        } catch (e) {}
        range = JSON.stringify(coords || {});
      }

      let percentage = ConfigService.getObjectConfig(
        this.props.currentBook.key,
        "recordLocation",
        {}
      ).percentage
        ? ConfigService.getObjectConfig(
            this.props.currentBook.key,
            "recordLocation",
            {}
          ).percentage
        : "0";

      let color =
        this.highlightUtil.formatHighlightValue(this.props.highlight) ||
        "background-#FEF3CD";
      let tag = this.state.tag;

      let note = new Note(
        bookKey,
        this.props.chapter,
        actualChapterDocIndex,
        this.state.text,
        cfi,
        range,
        notes,
        percentage,
        color,
        tag
      );
      DatabaseService.saveRecord(note, "notes").then(async () => {
        this.props.handleOpenMenu(false);
        this.props.handleFetchNotes();
        this.props.handleMenuMode("");
        clearIframeSelection(this.props.currentBook.format);
        try {
          await this.props.htmlBook?.rendition?.createOneNote(
            note,
            this.handleNoteClick
          );
        } catch (e) {
          console.warn("createOneNote failed:", e);
        }
        // Auto-sync note to enabled destinations
        let noteSyncManager = new NoteSyncManager(
          DatabaseService,
          ConfigService,
          window.electronAPI?.fs,
          window.electronAPI?.path
        );
        noteSyncManager.syncNote(note, bookKey);
      });
    }
  }
  handleUpdateHighlight = () => {};
  handleClose = () => {
    if (this.props.noteKey) {
      DatabaseService.deleteRecord(this.props.noteKey, "notes").then(() => {
        toast.success(this.props.t("Deletion successful"));
        this.props.handleMenuMode("");
        this.props.handleFetchNotes();
        this.props.handleNoteKey("");
        clearIframeSelection(this.props.currentBook.format);
        if (this.props.htmlBook && this.props.htmlBook.rendition) {
          this.props.htmlBook.rendition.removeOneNote(
            this.props.noteKey,
            this.props.chapterDocIndex
          );
        }

        this.props.handleOpenMenu(false);
        this.props.handleShowPopupNote(false);
      });
    } else {
      this.props.handleOpenMenu(false);
      this.props.handleMenuMode("");
      this.props.handleNoteKey("");
      clearIframeSelection(this.props.currentBook.format);
    }
  };

  render() {
    const colorOptionProps = {
      handleDigest: this.handleUpdateHighlight,
      isEdit: true,
      noteItem: this.state.note,
      t: this.props.t,
    };
    let note = this.state.note;
    const t = this.props.t;

    return (
      <div className="note-editor">
        {/* Header bar with title and close icon */}
        <div className="note-header-bar">
          <span className="note-header-title">
            {this.props.noteKey
              ? t("Edit Note") || t("Take a note")
              : t("Take a note")}
          </span>
          <button
            type="button"
            className="note-header-close"
            onClick={this.handleClose}
            aria-label={t("Cancel")}
          >
            <span className="icon-close" />
          </button>
        </div>

        {/* Selected Quote / Highlight Text */}
        {this.state.text && (
          <div className="note-original-text">
            <span className="note-quote-bar" />
            <div className="note-quote-text">{this.state.text}</div>
          </div>
        )}

        {/* Text Input Area */}
        <div className="editor-box-parent">
          <textarea
            className="editor-box"
            placeholder={t("Write a note...") || t("Take a note")}
            defaultValue={note ? note.notes : ""}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.ctrlKey || event.metaKey) &&
                !(event.nativeEvent as any).isComposing
              ) {
                event.preventDefault();
                this.createNote();
              }
            }}
          />
        </div>

        {/* Highlight Color & Style Controls */}
        <div className="note-color-row">
          <ColorOption {...(colorOptionProps as any)} />
        </div>

        {/* Tag Selector */}
        <div className="note-tags-row">
          <NoteTag
            {...({
              handleTag: this.handleTag,
              tag: this.props.noteKey && note ? note.tag : [],
            } as any)}
          />
        </div>

        {/* Bottom Actions Bar */}
        <div className="note-button-container">
          <button
            type="button"
            className="note-btn note-btn-copy"
            onClick={() => {
              copy(this.state.text);
              toast.success(t("Copying successful"));
            }}
          >
            <span className="icon-copy" />
            <span>{t("Copy quotes")}</span>
          </button>

          <div className="note-btn-group-right">
            <button
              type="button"
              className={`note-btn ${this.props.noteKey ? "note-btn-delete" : "note-btn-cancel"}`}
              onClick={this.handleClose}
            >
              {this.props.noteKey ? t("Delete") : t("Cancel")}
            </button>
            <button
              type="button"
              className="note-btn note-btn-confirm"
              onClick={() => {
                this.createNote();
              }}
            >
              <span>{t("Confirm")}</span>
              <span className="note-hint-desktop"> (↵)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
export default PopupNote;
