import React from "react";
import "./colorOption.css";
import { ColorProps } from "./interface";
import {
  ConfigService,
  HighlightUtil,
  KookitConfig,
} from "../../assets/lib/kookit-extra-browser.min";

class ColorOption extends React.Component<ColorProps> {
  highlightUtil: any;
  constructor(props: ColorProps) {
    super(props);
    this.highlightUtil = new HighlightUtil(ConfigService);
  }
  handleStyleType = (styleType: string) => {
    const color = KookitConfig.HighlightPresetColors[styleType][0];
    const value = { styleType, color };
    this.props.handleHighlight(value);
    this.highlightUtil.saveNoteHighlightValue(value);
  };

  handlePresetColor = (index: number) => {
    const styleType = this.props.highlight.styleType;
    const color = KookitConfig.HighlightPresetColors[styleType][index];
    const value = { styleType, color };
    this.props.handleHighlight(value);
    this.highlightUtil.saveNoteHighlightValue(value);
    if (!this.props.isEdit) {
      setTimeout(() => {
        this.props.handleDigest();
      }, 100);
    }
  };

  render() {
    const { styleType, color } = this.props.highlight;
    const presetColors = KookitConfig.HighlightPresetColors[styleType];
    const t = this.props.t || ((s: string) => s);

    return (
      <div
        className={
          this.props.isEdit
            ? "color-option-container color-option-container-edit"
            : "color-option-container"
        }
      >
        <ul className="note-highlight-style-tabs" role="tablist">
          {KookitConfig.HighlightStyleTypes.map((item) => {
            const previewColor =
              item.value === styleType
                ? color
                : KookitConfig.HighlightPresetColors[item.value][0];
            const isActive = styleType === item.value;
            return (
              <li
                key={item.value}
                className={
                  isActive
                    ? "note-highlight-style-tab active-note-highlight-tab"
                    : "note-highlight-style-tab"
                }
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  this.handleStyleType(item.value);
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                title={t(item.label || item.value)}
                role="tab"
                aria-selected={isActive}
              >
                <span
                  className="note-highlight-style-preview"
                  style={{
                    ...this.highlightUtil.buildHighlightPreviewStyle(
                      item.value,
                      previewColor
                    ),
                    ...(item.value === "background"
                      ? { borderRadius: "4px" }
                      : {}),
                  }}
                >
                  Aa
                </span>
              </li>
            );
          })}
        </ul>
        <div className="note-highlight-divider" />
        <ul className="note-highlight-color-container" role="radiogroup">
          {presetColors.map((presetColor, index) => {
            const isActive = presetColors.indexOf(color) === index;
            return (
              <li
                key={presetColor}
                className={
                  isActive
                    ? "note-highlight-color-item active-note-highlight-color"
                    : "note-highlight-color-item"
                }
                style={{ backgroundColor: presetColor }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  this.handlePresetColor(index);
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                title={t("Highlight")}
                role="radio"
                aria-checked={isActive}
              />
            );
          })}
        </ul>
      </div>
    );
  }
}

export default ColorOption;
