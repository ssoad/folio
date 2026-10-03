import React from "react";
import "./popupOptionDialog.css";
import { ReactSortable } from "react-sortablejs";
import toast from "react-hot-toast";
import {
  PopupOptionDialogItem,
  PopupOptionDialogProps,
  PopupOptionDialogState,
} from "./interface";
import {
  getPopupOptionSettingList,
  POPUP_OPTION_LIMIT,
  savePopupOptionSettingList,
} from "../../../constants/popupList";
import { NATIVE_BACK_EVENT } from "../../../utils/native";

const isPhoneWidth = () =>
  window.innerWidth <= 576 ||
  document.body.classList.contains("is-compact") ||
  document.documentElement.classList.contains("is-compact");

class PopupOptionDialog extends React.Component<
  PopupOptionDialogProps,
  PopupOptionDialogState
> {
  constructor(props: PopupOptionDialogProps) {
    super(props);
    this.state = {
      popupOptionList: getPopupOptionSettingList(),
    };
  }

  componentDidMount() {
    window.addEventListener(NATIVE_BACK_EVENT, this.handleNativeBack, {
      capture: true,
    });
  }

  componentWillUnmount() {
    window.removeEventListener(
      NATIVE_BACK_EVENT,
      this.handleNativeBack,
      { capture: true } as any
    );
  }

  handleNativeBack = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    this.handleClose();
  };

  handleClose = () => {
    this.props.handlePopupOptionDialog(false);
  };

  handleToggleOption = (targetKey: string) => {
    const enabledCount = this.state.popupOptionList.filter(
      (item) => item.enabled
    ).length;
    const targetOption = this.state.popupOptionList.find(
      (item) => item.key === targetKey
    );

    if (!targetOption) return;

    if (!targetOption.enabled && enabledCount >= POPUP_OPTION_LIMIT) {
      toast(
        this.props.t("You can enable up to {{count}} options", {
          count: POPUP_OPTION_LIMIT,
        })
      );
      return;
    }

    const popupOptionList = this.state.popupOptionList.map((item) => {
      if (item.key !== targetKey) {
        return item;
      }

      return {
        ...item,
        enabled: !item.enabled,
      };
    });

    this.setState({ popupOptionList });
    savePopupOptionSettingList(popupOptionList);
    this.props.handlePopupOptionUpdate(Date.now());
  };

  render() {
    const isPhone = isPhoneWidth();

    return (
      <>
        <div
          className="popup-option-dialog-backdrop"
          onClick={this.handleClose}
          onPointerDown={(event) => {
            event.stopPropagation();
            this.handleClose();
          }}
        />
        <div
          className="popup-option-dialog-container"
          onDragEnter={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {isPhone && <div className="popup-sheet-grabber" />}
          <div className="popup-option-dialog-header">
            <div className="popup-option-dialog-title">
              {this.props.t("Customize popup menu")}
            </div>
            <button
              type="button"
              className="popup-option-dialog-close"
              onClick={this.handleClose}
              aria-label={this.props.t("Close")}
            >
              <span className="icon-close"></span>
            </button>
          </div>

          <div className="popup-option-dialog-list">
            <ReactSortable<PopupOptionDialogItem>
              list={this.state.popupOptionList}
              setList={(popupOptionList) => {
                this.setState({ popupOptionList });
                savePopupOptionSettingList(
                  popupOptionList as unknown as PopupOptionDialogState["popupOptionList"]
                );
                this.props.handlePopupOptionUpdate(Date.now());
              }}
              animation={200}
              delayOnTouchStart={true}
              delay={2}
              scroll={true}
              scrollSensitivity={140}
              scrollSpeed={20}
              bubbleScroll={true}
              handle=".popup-option-dialog-drag-handle"
            >
              {this.state.popupOptionList.map((item) => {
                return (
                  <div
                    key={item.key}
                    className={`popup-option-dialog-item ${
                      item.enabled ? "is-enabled" : "is-disabled"
                    }`}
                    onClick={() => this.handleToggleOption(item.key)}
                  >
                    <div className="popup-option-dialog-item-left">
                      <div className="popup-option-dialog-item-icon-box">
                        <span
                          className={`icon-${item.icon} popup-option-dialog-item-icon`}
                        ></span>
                      </div>
                      <span className="popup-option-dialog-item-label">
                        {this.props.t(item.title)}
                      </span>
                    </div>

                    <div
                      className="popup-option-dialog-item-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div
                        className={`popup-option-dialog-switch ${
                          item.enabled ? "is-enabled" : ""
                        }`}
                        onClick={() => this.handleToggleOption(item.key)}
                        role="switch"
                        aria-checked={item.enabled}
                      >
                        <div className="popup-option-dialog-switch-knob" />
                      </div>
                      <div
                        className="popup-option-dialog-drag-handle"
                        title={this.props.t("Drag to sort")}
                      >
                        <span className="icon-menu popup-option-dialog-drag"></span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </ReactSortable>
          </div>

          <div className="popup-option-dialog-footer">
            <span className="popup-option-dialog-limit-tip">
              {this.props.t("You can enable up to {{count}} options", {
                count: POPUP_OPTION_LIMIT,
              })}
            </span>
            <span className="popup-option-dialog-sort-tip">
              {this.props.t("Drag to sort")}
            </span>
          </div>
        </div>
      </>
    );
  }
}

export default PopupOptionDialog;
