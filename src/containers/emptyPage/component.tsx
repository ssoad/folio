import React from "react";
import "./emptyPage.css";
import { emptyList } from "../../constants/emptyList";
import { Trans } from "react-i18next";
import { EmptyPageProps, EmptyPageState } from "./interface";
import { isTouchDevice, signalAppReady } from "../../utils/platform";
import EmptyArt from "../../components/emptyArt";

class EmptyPage extends React.Component<EmptyPageProps, EmptyPageState> {
  constructor(props: EmptyPageProps) {
    super(props);
    this.state = {
      isOpenDelete: false,
    };
  }
  componentDidMount() {
    signalAppReady();
  }
  // The same file picker as the Import button
  handleAdd = () => {
    const input = document.querySelector(
      ".import-from-local .import-book-box"
    ) as HTMLElement | null;
    input?.click();
  };
  render() {
    const item = emptyList.find((entry) => entry.mode === this.props.mode);
    return (
      <div
        className={
          "empty-page-container" +
          (this.props.isCollapsed ? " empty-page-collapsed" : "")
        }
      >
        <EmptyArt mode={this.props.mode} />
        {item && (
          <>
            <div className="empty-page-info-main">
              <Trans>{item.main}</Trans>
            </div>
            <div className="empty-page-info-sub">
              {this.props.t(isTouchDevice() ? item.touch : item.sub)}
            </div>
            {this.props.mode === "home" && (
              <button className="empty-page-action" onClick={this.handleAdd}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <Trans>Add books</Trans>
              </button>
            )}
          </>
        )}
      </div>
    );
  }
}

export default EmptyPage;
