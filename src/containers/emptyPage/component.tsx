import React from "react";
import "./emptyPage.css";
import { emptyList } from "../../constants/emptyList";
import { Trans } from "react-i18next";
import { EmptyPageProps, EmptyPageState } from "./interface";

class EmptyPage extends React.Component<EmptyPageProps, EmptyPageState> {
  constructor(props: EmptyPageProps) {
    super(props);
    this.state = {
      isOpenDelete: false,
    };
  }
  render() {
    const item = emptyList.find((entry) => entry.mode === this.props.mode);
    return (
      <div
        className={
          "empty-page-container" +
          (this.props.isCollapsed ? " empty-page-collapsed" : "")
        }
      >
        <div className="empty-page-icon" aria-hidden="true">
          {/* A short stack of books; strokes follow the theme */}
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 19.5V5a2 2 0 0 1 2-2h3v18H6a2 2 0 0 1-2-1.5z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="M9 3h4v18H9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="m14.2 4.6 3.6-1 3.6 13.6-3.6 1z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        {item && (
          <>
            <div className="empty-page-info-main">
              <Trans>{item.main}</Trans>
            </div>
            <div className="empty-page-info-sub">
              <Trans>{item.sub}</Trans>
            </div>
          </>
        )}
      </div>
    );
  }
}

export default EmptyPage;
