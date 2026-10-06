import React from "react";
import "./onboarding.css";
import { Trans } from "react-i18next";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import FolioLogo from "../folioLogo";
import { NATIVE_BACK_EVENT } from "../../utils/native";
import { isServerLocked } from "../../utils/request/selfHosted";
import { OnboardingProps, OnboardingState } from "./interface";
import {
  LibraryScene,
  ListenScene,
  ReadingScene,
  SyncScene,
} from "./illustrations";

const ONBOARDED_KEY = "hasOnboarded";

// First launch with an empty library; anyone who already has books has
// found their way around
export const shouldShowOnboarding = (totalBooks: number) => {
  if (ConfigService.getReaderConfig(ONBOARDED_KEY) === "yes") return false;
  if (totalBooks > 0) {
    ConfigService.setReaderConfig(ONBOARDED_KEY, "yes");
    return false;
  }
  return true;
};

const slides = [
  {
    Scene: LibraryScene,
    title: "Your library, beautifully kept",
    body: "EPUB, PDF, comics and more, with covers, progress and shelves, all in one calm place.",
  },
  {
    Scene: ReadingScene,
    title: "Read the way you like",
    body: "Pick your font, size and theme. Highlight, take notes and write in the margins.",
  },
  {
    Scene: ListenScene,
    title: "Listen, ask, translate",
    body: "Have any book read aloud, ask the AI about a passage, or translate it in a tap.",
  },
  {
    Scene: SyncScene,
    title: "Everywhere, and private",
    body: "Your books, notes and progress follow you across devices, encrypted on your own Folio server.",
  },
];

// Past this share of the screen width, a swipe turns the page
const SWIPE_RATIO = 0.18;

class Onboarding extends React.Component<OnboardingProps, OnboardingState> {
  private startX = 0;
  private startY = 0;
  private width = 1;
  // Vertical drags scroll the text instead of turning the page
  private axis: "x" | "y" | null = null;
  private nextRef = React.createRef<HTMLButtonElement>();

  constructor(props: OnboardingProps) {
    super(props);
    this.state = { index: 0, dragX: 0, isDragging: false, isLeaving: false };
  }

  componentDidMount() {
    window.addEventListener("keydown", this.handleKey);
    window.addEventListener(NATIVE_BACK_EVENT, this.handleBack);
    this.nextRef.current?.focus({ preventScroll: true });
  }

  componentWillUnmount() {
    window.removeEventListener("keydown", this.handleKey);
    window.removeEventListener(NATIVE_BACK_EVENT, this.handleBack);
  }

  isLast = () => this.state.index === slides.length - 1;

  goTo = (index: number) => {
    this.setState({
      index: Math.max(0, Math.min(slides.length - 1, index)),
      dragX: 0,
    });
  };

  // Fades out, then the library takes over
  finish = (then?: () => void) => {
    ConfigService.setReaderConfig(ONBOARDED_KEY, "yes");
    this.setState({ isLeaving: true });
    then && then();
    setTimeout(this.props.onDone, 320);
  };

  handleImport = () =>
    // The click has to happen within the tap for the file picker to open
    this.finish(() => {
      const input = document.querySelector(
        ".import-from-local .import-book-box"
      ) as HTMLElement | null;
      input?.click();
    });

  handleConnect = () =>
    this.finish(() => {
      this.props.handleSettingMode("account");
      this.props.handleSetting(true);
    });

  handleKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight") this.goTo(this.state.index + 1);
    else if (event.key === "ArrowLeft") this.goTo(this.state.index - 1);
    else if (event.key === "Escape") this.finish();
  };

  // Android back: the previous page; on the first, leave it to the app
  handleBack = (event: Event) => {
    if (this.state.index > 0) {
      event.preventDefault();
      this.goTo(this.state.index - 1);
    }
  };

  handleTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    this.startX = touch.clientX;
    this.startY = touch.clientY;
    this.width = (event.currentTarget as HTMLElement).clientWidth || 1;
    this.axis = null;
  };

  handleTouchMove = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    const dx = touch.clientX - this.startX;
    const dy = touch.clientY - this.startY;
    if (!this.axis && Math.abs(dx) + Math.abs(dy) > 8) {
      this.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (this.axis !== "x") return;
    const atEdge =
      (this.state.index === 0 && dx > 0) || (this.isLast() && dx < 0);
    // Resists past the first and last page
    this.setState({ dragX: atEdge ? dx * 0.25 : dx, isDragging: true });
  };

  handleTouchEnd = () => {
    const { dragX, index } = this.state;
    this.setState({ isDragging: false });
    if (this.axis === "x" && Math.abs(dragX) > this.width * SWIPE_RATIO) {
      this.goTo(dragX < 0 ? index + 1 : index - 1);
    } else {
      this.setState({ dragX: 0 });
    }
    this.axis = null;
  };

  render() {
    const { index, dragX, isDragging, isLeaving } = this.state;
    const isLast = this.isLast();
    return (
      <div
        className={"onboarding" + (isLeaving ? " is-leaving" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={this.props.t("Welcome to Folio")}
      >
        <div className="ob-aurora" aria-hidden="true">
          <span className="ob-blob ob-blob-1" />
          <span className="ob-blob ob-blob-2" />
          <span className="ob-blob ob-blob-3" />
        </div>

        <header className="ob-header">
          <FolioLogo size={24} className="ob-brand" />
          <button
            className={"ob-skip" + (isLast ? " is-hidden" : "")}
            onClick={() => this.finish()}
            tabIndex={isLast ? -1 : 0}
          >
            <Trans>Skip</Trans>
          </button>
        </header>

        <div
          className="ob-viewport"
          aria-roledescription="carousel"
          onTouchStart={this.handleTouchStart}
          onTouchMove={this.handleTouchMove}
          onTouchEnd={this.handleTouchEnd}
          onTouchCancel={this.handleTouchEnd}
        >
          <div
            className={"ob-track" + (isDragging ? " is-dragging" : "")}
            style={{
              transform: `translate3d(calc(${-index * 100}% + ${dragX}px), 0, 0)`,
            }}
          >
            {slides.map(({ Scene, title, body }, i) => (
              <section
                key={title}
                className={"ob-slide" + (i === index ? " is-active" : "")}
                aria-roledescription="slide"
                aria-label={`${i + 1} / ${slides.length}`}
                aria-hidden={i !== index}
              >
                <div className="ob-scene">
                  <Scene />
                </div>
                <div className="ob-copy">
                  <h1 className="ob-title">{this.props.t(title)}</h1>
                  <p className="ob-body">{this.props.t(body)}</p>
                </div>
              </section>
            ))}
          </div>
        </div>

        <footer className="ob-footer">
          <div className="ob-dots" role="tablist">
            {slides.map((slide, i) => (
              <button
                key={slide.title}
                role="tab"
                aria-selected={i === index}
                aria-label={`${i + 1} / ${slides.length}`}
                className={"ob-dot" + (i === index ? " is-active" : "")}
                onClick={() => this.goTo(i)}
              />
            ))}
          </div>

          {isLast ? (
            <div className="ob-actions">
              <button
                className="ob-primary"
                onClick={this.handleImport}
                ref={this.nextRef}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <Trans>Add your first book</Trans>
              </button>
              <div className="ob-secondary-row">
                <button className="ob-secondary" onClick={this.handleConnect}>
                  {this.props.t(
                    isServerLocked() ? "Sign in" : "Connect a server"
                  )}
                </button>
                <button className="ob-secondary" onClick={() => this.finish()}>
                  <Trans>Explore first</Trans>
                </button>
              </div>
            </div>
          ) : (
            <div className="ob-actions">
              <button
                className="ob-primary"
                onClick={() => this.goTo(index + 1)}
                ref={this.nextRef}
              >
                {this.props.t(index === 0 ? "Get started" : "Next")}
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          )}
        </footer>
      </div>
    );
  }
}

export default Onboarding;
