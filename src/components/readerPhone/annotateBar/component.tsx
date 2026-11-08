import React from "react";
import "../../dialogs/annotationDialog/annotationDialog.css";
import "./annotateBar.css";
import toast from "react-hot-toast";
import {
  ConfigService,
  HighlightUtil,
  KookitConfig,
} from "../../../assets/lib/kookit-extra-browser.min";
import PhoneIcon, { PhoneIconName } from "../phoneIcons";
import { AnnotateBarProps, AnnotateBarState } from "./interface";
import {
  ANNOTATE_HISTORY_EVENT,
  AnnotateTool,
  ERASE_NOTE_EVENT,
  EraseNoteDetail,
  HistoryEntry,
  InkTool,
  TextTool,
  canRedo,
  canUndo,
  getInkStyle,
  isInkTool,
  isTextTool,
  pushHistory,
  redo,
  setAnnotateTool,
  setInkStyle,
  undo,
} from "../../../utils/reader/markMode";
import { isReadingRawPDF } from "../../../utils/common";
import DatabaseService from "../../../utils/storage/databaseService";

// Phone annotation toolbar, in the style of notes apps: pen and marker draw
// on PDF pages, the highlighter and line tools mark text (snapped to whole
// words), the eraser rubs out both, with undo and redo. The tools act on
// the page through utils/reader/markMode.

const PEN_COLORS = [
  "#1f2937",
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#ea580c",
  "#7c3aed",
  "#db2777",
  "#ffffff",
];
const MARKER_COLORS = ["#facc15", "#4ade80", "#f472b6", "#60a5fa", "#fb923c"];
const WIDTHS: Record<InkTool, { label: string; value: number }[]> = {
  pen: [
    { label: "Thin", value: 0.0025 },
    { label: "Medium", value: 0.004 },
    { label: "Thick", value: 0.007 },
  ],
  marker: [
    { label: "Thin", value: 0.014 },
    { label: "Medium", value: 0.022 },
    { label: "Thick", value: 0.034 },
  ],
};
const LINE_STYLES: { value: TextTool; icon: PhoneIconName; label: string }[] = [
  { value: "underline", icon: "underline", label: "Underline" },
  { value: "strikethrough", icon: "strikethrough", label: "Strikethrough" },
  { value: "wavy", icon: "wavy", label: "Wavy underline" },
];
const isLineTool = (tool: AnnotateTool) =>
  tool === "underline" || tool === "strikethrough" || tool === "wavy";

const highlightUtil = new HighlightUtil(ConfigService);
const presetColors = (styleType: string): string[] =>
  (KookitConfig.HighlightPresetColors[styleType] || []).slice(0, 4);

class AnnotateBar extends React.Component<AnnotateBarProps, AnnotateBarState> {
  // The line tool remembers its last style (underline, strikethrough, wavy)
  lineTool: TextTool = "underline";
  constructor(props: AnnotateBarProps) {
    super(props);
    const { styleType, color } = props.highlight;
    this.state = {
      tool: "background",
      isOptionsOpen: false,
      canUndo: canUndo(),
      canRedo: canRedo(),
      textColors: { [styleType]: color },
      hint: "",
    };
  }
  componentDidMount() {
    window.addEventListener(ANNOTATE_HISTORY_EVENT, this.handleHistory);
    window.addEventListener(ERASE_NOTE_EVENT, this.handleEraseNote);
    this.selectTool("background", true);
  }
  componentWillUnmount() {
    window.removeEventListener(ANNOTATE_HISTORY_EVENT, this.handleHistory);
    window.removeEventListener(ERASE_NOTE_EVENT, this.handleEraseNote);
    setAnnotateTool(null);
  }
  isPDF = () => isReadingRawPDF(this.props.currentBook);
  handleHistory = () =>
    this.setState({ canUndo: canUndo(), canRedo: canRedo() });

  textColor = (styleType: string) => {
    const colors = presetColors(styleType);
    const saved = this.state.textColors[styleType];
    return saved && colors.includes(saved) ? saved : colors[0];
  };
  selectTool = (tool: AnnotateTool, isFirst = false) => {
    if (!isFirst && tool === this.state.tool) {
      // A second tap on the tool opens its options, as in notes apps
      if (tool !== "eraser") {
        this.setState({ isOptionsOpen: !this.state.isOptionsOpen });
      }
      return;
    }
    if (isLineTool(tool)) this.lineTool = tool as TextTool;
    setAnnotateTool(tool, this.props.currentBook.key);
    if (isTextTool(tool)) this.applyTextStyle(tool, this.textColor(tool));
    const hint = isTextTool(tool)
      ? "Drag over text to mark it"
      : isInkTool(tool)
        ? "Draw on the page"
        : "Rub over ink or highlights to erase them";
    this.setState({ tool, isOptionsOpen: false, hint });
  };
  applyTextStyle = (styleType: string, color: string) => {
    const value = { styleType, color };
    this.props.handleHighlight(value);
    highlightUtil.saveNoteHighlightValue(value);
    this.setState({
      textColors: { ...this.state.textColors, [styleType]: color },
    });
  };
  pickColor = (color: string) => {
    const { tool } = this.state;
    if (isTextTool(tool)) this.applyTextStyle(tool, color);
    else if (isInkTool(tool)) setInkStyle(tool, { color });
    this.forceUpdate();
  };
  pickWidth = (width: number) => {
    if (isInkTool(this.state.tool)) setInkStyle(this.state.tool, { width });
    this.forceUpdate();
  };

  /* highlights: erase, undo, redo */
  onNoteClick = (event: Event) => {
    this.props.handleNoteKey((event.target as any).dataset.key);
    this.props.handleMenuMode("note");
    this.props.handleOpenMenu(true);
  };
  removeNote = async (note: any) => {
    this.props.htmlBook?.rendition?.removeOneNote(note.key, note.chapterIndex);
    await DatabaseService.deleteRecord(note.key, "notes");
    this.props.handleFetchNotes();
  };
  restoreNote = async (note: any) => {
    await DatabaseService.saveRecord(note, "notes");
    await this.props.htmlBook?.rendition?.createOneNote(note, this.onNoteClick);
    this.props.handleFetchNotes();
  };
  handleEraseNote = async (event: Event) => {
    const { key, group } = (event as CustomEvent<EraseNoteDetail>).detail;
    const note = await DatabaseService.getRecord(key, "notes");
    if (!note) return;
    await this.removeNote(note);
    pushHistory({ kind: "note", note, added: false, group });
  };
  applyHistory = async (entries: HistoryEntry[]) => {
    try {
      for (const entry of entries) {
        if (entry.kind !== "note") continue;
        if (entry.added) await this.restoreNote(entry.note);
        else await this.removeNote(entry.note);
      }
    } catch (error) {
      console.error(error);
      toast.error(this.props.t("Couldn't undo that"));
    }
  };

  renderOptions = () => {
    const { tool } = this.state;
    const t = this.props.t;
    if (isTextTool(tool)) {
      const current = this.textColor(tool);
      return (
        <div className="annotation-phone-options" role="dialog">
          {isLineTool(tool) && (
            <div className="annotation-phone-shapes">
              {LINE_STYLES.map((style) => (
                <button
                  type="button"
                  key={style.value}
                  className={tool === style.value ? "is-active" : ""}
                  aria-label={t(style.label)}
                  aria-pressed={tool === style.value}
                  onClick={() => this.selectTool(style.value)}
                >
                  <PhoneIcon name={style.icon} />
                </button>
              ))}
            </div>
          )}
          <div className="annotation-phone-colors">
            {presetColors(tool).map((color) => (
              <button
                type="button"
                key={color}
                className={color === current ? "is-active" : ""}
                style={{ background: color }}
                aria-label={t("Colour")}
                aria-pressed={color === current}
                onClick={() => this.pickColor(color)}
              />
            ))}
          </div>
        </div>
      );
    }
    if (isInkTool(tool)) {
      const style = getInkStyle(tool);
      const colors = tool === "pen" ? PEN_COLORS : MARKER_COLORS;
      return (
        <div className="annotation-phone-options" role="dialog">
          <div className="annotation-phone-colors annotate-bar-wrap">
            {colors.map((color) => (
              <button
                type="button"
                key={color}
                className={color === style.color ? "is-active" : ""}
                style={{ background: color }}
                aria-label={t("Colour")}
                aria-pressed={color === style.color}
                onClick={() => this.pickColor(color)}
              />
            ))}
          </div>
          <div className="annotation-phone-widths" aria-label={t("Thickness")}>
            {WIDTHS[tool].map((width, index) => (
              <button
                type="button"
                key={width.value}
                className={width.value === style.width ? "is-active" : ""}
                aria-label={t(width.label)}
                aria-pressed={width.value === style.width}
                onClick={() => this.pickWidth(width.value)}
              >
                <span
                  className="annotate-bar-width"
                  style={{
                    height: 2 + index * 3 + (tool === "marker" ? 3 : 0),
                    background: style.color,
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  render() {
    const { tool, isOptionsOpen } = this.state;
    const t = this.props.t;
    const isPDF = this.isPDF();
    const lineStyle =
      LINE_STYLES.find((style) => style.value === this.lineTool) ||
      LINE_STYLES[0];
    const tools: { key: AnnotateTool; icon: PhoneIconName; label: string }[] = [
      ...(isPDF
        ? [
            {
              key: "pen" as AnnotateTool,
              icon: "pen" as PhoneIconName,
              label: "Pen",
            },
            {
              key: "marker" as AnnotateTool,
              icon: "marker" as PhoneIconName,
              label: "Marker",
            },
          ]
        : []),
      { key: "background", icon: "highlighter", label: "Highlighter" },
      { key: this.lineTool, icon: lineStyle.icon, label: lineStyle.label },
      { key: "eraser", icon: "eraser", label: "Eraser" },
    ];
    const toolColor = isTextTool(tool)
      ? this.textColor(tool)
      : isInkTool(tool)
        ? getInkStyle(tool).color
        : "transparent";
    return (
      <div className="annotation-phone annotate-bar">
        <div className="annotation-phone-bar" role="toolbar">
          {tools.map((item) => {
            const isActive =
              item.key === tool || (isLineTool(item.key) && isLineTool(tool));
            return (
              <button
                type="button"
                key={item.label}
                className={
                  "annotation-phone-tool" + (isActive ? " is-active" : "")
                }
                aria-label={t(item.label)}
                aria-pressed={isActive}
                onClick={() => this.selectTool(item.key)}
              >
                <PhoneIcon name={item.icon} />
                {item.key === "background" && (
                  <span
                    className="annotate-bar-swatch"
                    style={{ background: this.textColor("background") }}
                  />
                )}
              </button>
            );
          })}
          <span className="annotation-phone-divider" />
          <button
            type="button"
            className="annotation-phone-color"
            aria-label={t("Colour")}
            disabled={tool === "eraser"}
            onClick={() => this.setState({ isOptionsOpen: !isOptionsOpen })}
          >
            <span style={{ background: toolColor }}></span>
          </button>
          <button
            type="button"
            className="annotation-phone-tool"
            aria-label={t("Undo")}
            disabled={!this.state.canUndo}
            onClick={() => this.applyHistory(undo())}
          >
            <PhoneIcon name="undo" />
          </button>
          <button
            type="button"
            className="annotation-phone-tool"
            aria-label={t("Redo")}
            disabled={!this.state.canRedo}
            onClick={() => this.applyHistory(redo())}
          >
            <PhoneIcon name="redo" />
          </button>
          <button
            type="button"
            className="annotation-phone-tool annotation-phone-done"
            aria-label={t("Done")}
            onClick={this.props.onDone}
          >
            <PhoneIcon name="check" />
          </button>
        </div>
        {isOptionsOpen && this.renderOptions()}
        {!isOptionsOpen && this.state.hint && (
          <div className="annotation-phone-hint" key={this.state.hint}>
            {t(this.state.hint)}
          </div>
        )}
      </div>
    );
  }
}

export default AnnotateBar;
