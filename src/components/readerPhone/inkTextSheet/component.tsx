import React from "react";
import "./inkTextSheet.css";
import { InkTextSheetProps, InkTextSheetState } from "./interface";
import {
  INK_TEXT_EDIT_EVENT,
  InkTextEdit,
  deleteTextItem,
  measureTextHeight,
  saveTextItem,
} from "../../../utils/reader/markMode";
import { NATIVE_BACK_EVENT } from "../../../utils/native";

// Writes and edits a text box or sticky note on a PDF page (placed with the
// annotation toolbar's text and sticky-note tools, or a sticky note tapped
// while reading).

const TEXT_COLORS = [
  "#1f2937",
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#7c3aed",
  "#ea580c",
];
const NOTE_COLORS = ["#fde68a", "#fbcfe8", "#bbf7d0", "#bfdbfe", "#fed7aa"];
const SIZES = [
  { label: "Small", value: 0.024 },
  { label: "Medium", value: 0.032 },
  { label: "Large", value: 0.045 },
];

class InkTextSheet extends React.Component<
  InkTextSheetProps,
  InkTextSheetState
> {
  textarea = React.createRef<HTMLTextAreaElement>();
  constructor(props: InkTextSheetProps) {
    super(props);
    this.state = { edit: null, text: "", color: "", fontSize: 0.032 };
  }
  componentDidMount() {
    window.addEventListener(INK_TEXT_EDIT_EVENT, this.handleEdit);
    window.addEventListener(NATIVE_BACK_EVENT, this.handleBack);
  }
  componentWillUnmount() {
    window.removeEventListener(INK_TEXT_EDIT_EVENT, this.handleEdit);
    window.removeEventListener(NATIVE_BACK_EVENT, this.handleBack);
  }
  // The tap that opens the sheet is followed by its click, which would
  // land on the backdrop and close it again
  openedAt = 0;
  handleBackdrop = () => {
    if (Date.now() - this.openedAt > 500) this.save();
  };
  handleEdit = (event: Event) => {
    const edit = (event as CustomEvent<InkTextEdit>).detail;
    this.openedAt = Date.now();
    this.setState(
      {
        edit,
        text: edit.item.text || "",
        color: edit.item.color,
        fontSize: edit.item.fontSize || 0.032,
      },
      () => setTimeout(() => this.textarea.current?.focus(), 120)
    );
  };
  // Android back closes the sheet first
  handleBack = (event: Event) => {
    if (!this.state.edit || event.defaultPrevented) return;
    event.preventDefault();
    this.close();
  };
  close = () => this.setState({ edit: null });
  save = () => {
    const { edit, text, color, fontSize } = this.state;
    if (!edit) return;
    if (!text.trim()) {
      // An emptied box or note goes
      if (!edit.isNew) deleteTextItem(edit.page, edit.item);
      this.close();
      return;
    }
    const item = { ...edit.item, text, color, fontSize };
    if (item.tool === "text") {
      item.height = measureTextHeight(item, edit.pageWidth, edit.pageHeight);
    }
    saveTextItem(edit.page, item, edit.isNew);
    this.close();
  };
  remove = () => {
    const { edit } = this.state;
    if (edit && !edit.isNew) deleteTextItem(edit.page, edit.item);
    this.close();
  };
  render() {
    const { edit, text, color, fontSize } = this.state;
    const t = this.props.t;
    const isOpen = !!edit;
    const isSticky = edit?.item.tool === "sticky";
    return (
      <>
        <div
          className={"ink-text-backdrop" + (isOpen ? " is-open" : "")}
          onClick={this.handleBackdrop}
        />
        <div
          className={"ink-text-sheet" + (isOpen ? " is-open" : "")}
          role="dialog"
          aria-label={t(isSticky ? "Sticky note" : "Text box")}
        >
          <div className="ink-text-head">
            <span className="ink-text-title">
              {t(isSticky ? "Sticky note" : "Text box")}
            </span>
            {edit && !edit.isNew && (
              <button
                type="button"
                className="ink-text-delete"
                onClick={this.remove}
              >
                {t("Delete")}
              </button>
            )}
          </div>
          <textarea
            ref={this.textarea}
            className={"ink-text-input" + (isSticky ? " is-sticky" : "")}
            style={isSticky ? { background: color } : { color }}
            value={text}
            placeholder={t(isSticky ? "Write a note…" : "Type here…")}
            onChange={(event) => this.setState({ text: event.target.value })}
          />
          <div className="ink-text-row">
            <div className="ink-text-colors">
              {(isSticky ? NOTE_COLORS : TEXT_COLORS).map((c) => (
                <button
                  type="button"
                  key={c}
                  className={c === color ? "is-active" : ""}
                  style={{ background: c }}
                  aria-label={t("Colour")}
                  aria-pressed={c === color}
                  onClick={() => this.setState({ color: c })}
                />
              ))}
            </div>
            {!isSticky && (
              <div className="ink-text-sizes" aria-label={t("Font size")}>
                {SIZES.map((size, index) => (
                  <button
                    type="button"
                    key={size.value}
                    className={size.value === fontSize ? "is-active" : ""}
                    aria-label={t(size.label)}
                    aria-pressed={size.value === fontSize}
                    style={{ fontSize: 12 + index * 3 }}
                    onClick={() => this.setState({ fontSize: size.value })}
                  >
                    A
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="ink-text-actions">
            <button
              type="button"
              className="ink-text-cancel"
              onClick={this.close}
            >
              {t("Cancel")}
            </button>
            <button type="button" className="ink-text-save" onClick={this.save}>
              {t("Save")}
            </button>
          </div>
        </div>
      </>
    );
  }
}

export default InkTextSheet;
