import React from "react";
import "./popupAssist.css";
import {
  PopupAssistProps,
  PopupAssistState,
  AiChatMessage,
  AssistMode,
} from "./interface";
import {
  ConfigService,
  KookitConfig,
} from "../../../assets/lib/kookit-extra-browser.min";
import Parser, { DOMNode, Element } from "html-react-parser";
import DOMPurify from "dompurify";
import { Trans } from "react-i18next";
import { handleContextMenu } from "../../../utils/common";
import toast from "react-hot-toast";
import { saveAs } from "file-saver";
import { getAnswerStream } from "../../../utils/request/reader";
import { streamChat } from "../../../utils/ai";
import {
  isSpoilerProtectionOn,
  jumpToPassage,
  prepareBookQuestion,
} from "../../../utils/ai/bookAssistant";
import { CITATION_REGEX } from "../../../utils/ai/bookContext";
import { marked } from "marked";
import { sampleQuestion } from "../../../constants/settingList";
const ASSIST_TABS: { mode: AssistMode; icon: string; label: string }[] = [
  { mode: "ask", icon: "icon-bookmark", label: "Reading Assistant" },
  { mode: "chat", icon: "icon-idea", label: "Chat Assistant" },
  { mode: "book", icon: "icon-bookshelf-line", label: "Book Assistant" },
];

class PopupAssist extends React.Component<PopupAssistProps, PopupAssistState> {
  chatBoxRef: React.RefObject<HTMLDivElement>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  answerTextAccumulator: string = "";
  updateInterval: ReturnType<typeof setInterval> | null = null;
  abortController: AbortController | null = null;
  isHydrating = false;

  constructor(props: PopupAssistProps) {
    super(props);
    this.state = {
      answer: "",
      aiService: ConfigService.getReaderConfig("aiService") || "",
      isAddNew: false,
      isWaiting: false,
      question: "",
      chatHistory: [],
      askHistory: [],
      bookHistory: [],
      isSpoilerFree: isSpoilerProtectionOn(),
      summaryProgress: "",
      mode: "ask",
      inputQuestion: "",
      isStreaming: false,
    };
    this.chatBoxRef = React.createRef();
    this.textareaRef = React.createRef();
  }

  MAX_HISTORY_LENGTH = 50;
  // Number of recent messages sent to the model as conversation context
  MAX_CONTEXT_MESSAGES = 20;

  AI_ASK_HISTORY_KEY = "aiAskHistory";
  AI_CHAT_HISTORY_KEY = "aiChatHistory";
  AI_BOOK_HISTORY_KEY = "aiBookHistory";

  MODES: AssistMode[] = ["ask", "chat", "book"];

  HISTORY_KEY_BY_MODE: Record<AssistMode, string> = {
    ask: this.AI_ASK_HISTORY_KEY,
    chat: this.AI_CHAT_HISTORY_KEY,
    book: this.AI_BOOK_HISTORY_KEY,
  };

  HISTORY_FIELD_BY_MODE: Record<
    AssistMode,
    "askHistory" | "chatHistory" | "bookHistory"
  > = {
    ask: "askHistory",
    chat: "chatHistory",
    book: "bookHistory",
  };

  getHistory = (mode: AssistMode = this.state.mode): AiChatMessage[] =>
    this.state[this.HISTORY_FIELD_BY_MODE[mode]];

  // Replaces the current mode's history together with other state updates
  setHistory = (
    messages: AiChatMessage[],
    extra: Partial<PopupAssistState> = {},
    callback?: () => void
  ) => {
    const field = this.HISTORY_FIELD_BY_MODE[this.state.mode];
    this.setState(
      { ...extra, [field]: messages } as PopupAssistState,
      callback
    );
  };

  appendHistory = (
    messages: AiChatMessage[],
    extra: Partial<PopupAssistState> = {},
    callback?: () => void
  ) => {
    this.setHistory([...this.getHistory(), ...messages], extra, callback);
  };

  loadHistory = (bookKey: string, mode: AssistMode): AiChatMessage[] => {
    if (!bookKey) {
      return [];
    }
    const key = this.HISTORY_KEY_BY_MODE[mode];
    return ConfigService.getObjectConfig(bookKey, key, []);
  };

  clearHistory = (bookKey: string, mode: AssistMode): void => {
    if (!bookKey) {
      return;
    }
    const key = this.HISTORY_KEY_BY_MODE[mode];
    ConfigService.setObjectConfig(bookKey, [], key);
  };

  saveHistory = (
    bookKey: string,
    mode: AssistMode,
    messages: AiChatMessage[]
  ): void => {
    if (!bookKey) {
      return;
    }
    const key = this.HISTORY_KEY_BY_MODE[mode];
    const trimmed =
      messages.length <= this.MAX_HISTORY_LENGTH
        ? messages
        : messages.slice(messages.length - this.MAX_HISTORY_LENGTH);
    ConfigService.setObjectConfig(bookKey, trimmed, key);
  };

  startUpdateInterval() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    this.updateInterval = setInterval(() => {
      if (this.answerTextAccumulator) {
        this.setState({ answer: this.answerTextAccumulator });
        if (ConfigService.getReaderConfig("isManualScroll") !== "yes") {
          this.scrollToBottom();
        }
      }
    }, 150);
  }

  stopUpdateInterval(finalAnswer?: string) {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (finalAnswer !== undefined) {
      this.setState({ answer: finalAnswer });
    }
  }
  loadChatHistory() {
    const bookKey = this.props.currentBook?.key;
    if (!bookKey) {
      return;
    }
    this.isHydrating = true;
    this.setState(
      {
        askHistory: this.loadHistory(bookKey, "ask"),
        chatHistory: this.loadHistory(bookKey, "chat"),
        bookHistory: this.loadHistory(bookKey, "book"),
      },
      () => {
        this.isHydrating = false;
        if (ConfigService.getReaderConfig("isManualScroll") !== "yes") {
          this.scrollToBottom();
        }
      }
    );
  }
  saveChatHistory() {
    const bookKey = this.props.currentBook?.key;
    if (!bookKey || this.isHydrating) {
      return;
    }
    for (const mode of this.MODES) {
      this.saveHistory(bookKey, mode, this.getHistory(mode));
    }
  }
  componentDidMount(): void {
    this.loadChatHistory();
    if (this.props.quoteText) {
      this.setState({ inputQuestion: this.props.quoteText + "\n" }, () => {
        this.autoResizeTextarea();
        const el = this.textareaRef.current;
        if (el) {
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      });
      this.props.handleQuoteText("");
    }
    if (!this.state.aiService) {
      let pluginList = this.props.plugins.filter(
        (item) =>
          item.type === "assistant" && !item.key.startsWith("official-ai-")
      );
      if (pluginList.length > 0) {
        this.setState({
          aiService: pluginList[0].key,
        });
        ConfigService.setReaderConfig("aiService", pluginList[0].key);
      } else if (this.props.isAuthed) {
        this.setState({
          aiService: "official-ai-assistant-plugin",
          isAddNew: false,
        });
        ConfigService.setReaderConfig("aiService", "official-ai-assistant-plugin");
      } else {
        this.setState({
          isAddNew: true,
        });
      }
    }
  }
  componentDidUpdate(
    prevProps: PopupAssistProps,
    prevState: PopupAssistState
  ): void {
    if (prevProps.currentBook?.key !== this.props.currentBook?.key) {
      this.loadChatHistory();
      return;
    }
    if (this.isHydrating) {
      return;
    }
    const bookKey = this.props.currentBook?.key;
    if (!bookKey) {
      return;
    }
    for (const mode of this.MODES) {
      const field = this.HISTORY_FIELD_BY_MODE[mode];
      if (prevState[field] !== this.state[field]) {
        this.saveHistory(bookKey, mode, this.state[field]);
      }
    }
  }
  componentWillUnmount(): void {
    this.abortController?.abort();
    this.saveChatHistory();
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
  autoResizeTextarea = () => {
    const el = this.textareaRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const maxLines = 5;
    const maxHeight = lineHeight * maxLines + paddingTop + paddingBottom;
    // 先重置为最小高度，让 scrollHeight 反映真实内容高度
    el.style.height = "0px";
    const contentHeight = el.scrollHeight;
    if (contentHeight >= maxHeight) {
      el.style.height = maxHeight + "px";
      el.style.overflowY = "auto";
    } else {
      el.style.height = contentHeight + "px";
      el.style.overflowY = "hidden";
    }
  };
  scrollToBottom = () => {
    if (this.chatBoxRef.current) {
      const scrollHeight = this.chatBoxRef.current.scrollHeight;
      const height = this.chatBoxRef.current.clientHeight;
      const maxScrollTop = scrollHeight - height;
      this.chatBoxRef.current.scrollTop = maxScrollTop > 0 ? maxScrollTop : 0;
    }
  };
  async handleAnswer() {
    let originalText =
      this.state.mode === "ask"
        ? this.props.originalText
            .replace(/(\r\n|\n|\r)/gm, "")
            .replace(/-/gm, "")
            // Remove common garbage characters
            .replace(
              /[^\x20-\x7E\u00A0-\u00FF\u0100-\u017F\u4E00-\u9FFF\u3000-\u303F]/g,
              ""
            )
            // Remove consecutive spaces
            .replace(/\s{2,}/g, " ")
            .trim()
        : "";
    if (
      (!ConfigService.getReaderConfig("aiService") ||
        this.props.plugins.findIndex(
          (item) => item.key === ConfigService.getReaderConfig("aiService")
        ) === -1) &&
      !this.props.isAuthed
    ) {
      this.setState({ isAddNew: true });
    }
    if (this.state.mode === "ask" && !originalText) {
      originalText = await this.props.htmlBook.rendition.chapterText();
    }
    this.handleDoAnswer(originalText);
  }
  handleDoAnswer = async (text: string) => {
    try {
      if (
        ConfigService.getReaderConfig("aiService") &&
        ConfigService.getReaderConfig("aiService") === "custom-ai-assistant-plugin"
      ) {
        let plugin = this.props.plugins.find(
          (item) => item.key === "custom-ai-assistant-plugin"
        );
        if (!plugin) {
          return;
        }
        let systemPrompt =
          ConfigService.getReaderConfig("aiAssistancePrompt") ||
          KookitConfig.DefaultPrompts.aiAssistance;
        if (this.state.mode === "ask") {
          systemPrompt = systemPrompt.replace("{text}", text);
        } else {
          systemPrompt = systemPrompt.replace("{text}", "");
        }
        let config: any = plugin.config || {};
        let chatHistory = this.getHistory();
        // The latest entry is the question the user just asked
        const question = chatHistory[chatHistory.length - 1]?.content;
        if (!question) {
          return;
        }
        const providerConfig = {
          endpoint: config.endpoint,
          providerId: config.providerId,
          apiKey: config.apiKey,
          modelId: config.modelId,
        };
        const messages = chatHistory
          .slice(-this.MAX_CONTEXT_MESSAGES)
          .filter((item) => item.content);
        this.answerTextAccumulator = "";
        this.startUpdateInterval();
        this.abortController = new AbortController();
        const signal = this.abortController.signal;
        this.setState({ isStreaming: true });
        try {
          if (this.state.mode === "book") {
            const prepared = await prepareBookQuestion({
              book: this.props.currentBook,
              rendition: this.props.htmlBook?.rendition,
              question,
              config: providerConfig,
              signal,
              onSummaryProgress: (done, total) => {
                this.setState({
                  summaryProgress:
                    this.props.t(
                      "Summarizing chapters, only needed once for this book"
                    ) + ` (${done}/${total})`,
                });
              },
            });
            this.setState({ summaryProgress: "" });
            // Stopped while summarizing
            if (!prepared) {
              return;
            }
            systemPrompt = prepared.system;
          }
          await streamChat(
            providerConfig,
            { system: systemPrompt, messages, signal },
            (result) => {
              if (result && result.text) {
                if (!this.answerTextAccumulator) {
                  this.setState({ isWaiting: false });
                }
                this.answerTextAccumulator += result.text;
              }
            }
          );
        } finally {
          this.abortController = null;
          this.stopUpdateInterval(this.answerTextAccumulator);
          this.setState({
            isStreaming: false,
            isWaiting: false,
            summaryProgress: "",
          });
        }
        const finalAnswer = this.answerTextAccumulator;
        this.answerTextAccumulator = "";
        const reply: AiChatMessage[] = finalAnswer
          ? [{ role: "assistant", content: finalAnswer }]
          : [];
        this.appendHistory(reply, {
          answer: "",
          question: "",
          isWaiting: false,
        });
        if (ConfigService.getReaderConfig("isManualScroll") !== "yes") {
          this.scrollToBottom();
        }
      } else if (
        ConfigService.getReaderConfig("aiService") &&
        ConfigService.getReaderConfig("aiService") !== "official-ai-assistant-plugin"
      ) {
      } else if (this.props.isAuthed) {
        let plugin = this.props.plugins.find(
          (item) => item.key === "official-ai-assistant-plugin"
        );
        if (!plugin) {
          return;
        }
        this.answerTextAccumulator = "";
        this.startUpdateInterval();
        let res = await getAnswerStream(
          text,
          this.state.question,
          this.getHistory(),
          this.state.mode,
          (result) => {
            if (result && result.text) {
              if (!this.answerTextAccumulator) {
                this.setState({ isWaiting: false });
              }
              this.answerTextAccumulator += result.text;
            }
          }
        );
        this.stopUpdateInterval(this.answerTextAccumulator);
        const finalAnswer = this.answerTextAccumulator;
        this.answerTextAccumulator = "";
        if (res.data && res.done) {
          this.appendHistory([{ role: "assistant", content: finalAnswer }], {
            answer: "",
            question: "",
            isWaiting: false,
          });
        }
        if (ConfigService.getReaderConfig("isManualScroll") !== "yes") {
          this.scrollToBottom();
        }
      }
    } catch (error) {
      toast.error(
        this.props.t("Error happened") +
          ": " +
          (error instanceof Error ? error.message : String(error))
      );
      console.error(error);
      this.setState({
        answer: this.props.t("Error happened"),
      });
    }
  };
  handleChangeAiService = (aiService: string) => {
    if (
      aiService === "official-ai-assistant-plugin" &&
      !this.props.isAuthed
    ) {
      toast(this.props.t("Please upgrade to Pro to use this feature"));
      this.props.handleSetting(true);
      this.props.handleSettingMode("account");
      return;
    }
    let plugin = this.props.plugins.find((item) => item.key === aiService);
    if (!plugin) {
      return;
    }
    this.setState(
      {
        aiService: aiService,
        isAddNew: false,
      },
      () => {
        ConfigService.setReaderConfig("aiService", aiService);
        if (!plugin) return;
        this.handleAnswer();
      }
    );
  };
  handleCopyAnswer = (content: string) => {
    navigator.clipboard.writeText(content || "").then(() => {
      toast.success(this.props.t("Copied"));
    });
  };
  isUsingOwnModel = () =>
    ConfigService.getReaderConfig("aiService") ===
      "custom-ai-assistant-plugin" &&
    this.props.plugins.some(
      (item) => item.key === "custom-ai-assistant-plugin"
    );

  isBookModeUnavailable = () =>
    this.state.mode === "book" && !this.isUsingOwnModel();

  handleToggleSpoilerFree = () => {
    const isSpoilerFree = !this.state.isSpoilerFree;
    ConfigService.setReaderConfig("isAiSpoilerFree", isSpoilerFree ? "yes" : "no");
    this.setState({ isSpoilerFree });
  };

  handleCitationClick = async (id: string) => {
    try {
      await jumpToPassage(
        this.props.currentBook,
        this.props.htmlBook?.rendition,
        id
      );
    } catch (error) {
      console.error(error);
      toast.error(this.props.t("Failed to jump to the passage"));
    }
  };

  // Turns [p3-12] markers into footnote-style numbers, one per distinct passage
  linkCitations = (html: string) => {
    const numbers = new Map<string, number>();
    return html.replace(CITATION_REGEX, (_match, ids: string) =>
      ids
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map((id) => {
          if (!numbers.has(id)) {
            numbers.set(id, numbers.size + 1);
          }
          return `<sup data-passage="${id}" data-label="${numbers.get(id)}"></sup>`;
        })
        .join("")
    );
  };

  renderMarkdown = (content: string) => {
    let html = marked.parse(content || "", { async: false }) as string;
    if (this.state.mode === "book") {
      html = this.linkCitations(html);
    }
    return Parser(DOMPurify.sanitize(html + "<address></address>") || " ", {
      replace: (domNode: DOMNode) => {
        if (
          domNode instanceof Element &&
          domNode.name === "sup" &&
          domNode.attribs["data-passage"]
        ) {
          const id = domNode.attribs["data-passage"];
          return (
            <sup
              className="popup-assist-citation"
              data-tooltip-id="my-tooltip"
              data-tooltip-content={this.props.t("Go to passage")}
              onClick={() => this.handleCitationClick(id)}
            >
              {domNode.attribs["data-label"]}
            </sup>
          );
        }
      },
    });
  };

  handleRenderHistoryMessage = (message: any[]) => {
    return message.map((item, index) => {
      return (
        <div
          key={index}
          className={
            item.role === "assistant"
              ? "popup-message-assistant"
              : "popup-message-user"
          }
        >
          {this.renderMarkdown(item.content)}
          {item.role === "assistant" && (
            <div
              className="popup-assist-copy-button"
              onClick={() => this.handleCopyAnswer(item.content)}
            >
              <span className="icon-copy-line"></span>
            </div>
          )}
        </div>
      );
    });
  };
  handleExportChatHistory = () => {
    const messages = this.getHistory();
    if (messages.length === 0) {
      toast(this.props.t("Nothing to export"));
      return;
    }
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const dateStr = `${year}-${month <= 9 ? "0" + month : month}-${
      day <= 9 ? "0" + day : day
    }`;
    const modeLabel = { ask: "Reading", chat: "Chat", book: "Book" }[
      this.state.mode
    ];
    const bookName = this.props.currentBook?.name || "Unknown";
    const exportData = {
      bookName,
      mode: this.state.mode,
      exportedAt: now.toISOString(),
      messages,
    };
    saveAs(
      new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json;charset=UTF-8",
      }),
      `KoodoReader-${modeLabel}-Assistant-${bookName}-${dateStr}.json`
    );
    toast.success(this.props.t("Export successful"), { id: "exporting" });
  };
  handleDeleteChatHistory = () => {
    this.clearHistory(this.props.currentBook?.key || "", this.state.mode);
    toast.success(this.props.t("Deletion successful"));
    this.setHistory([]);
  };
  handleNewQuestion = (question: string) => {
    if (this.state.mode === "book" && !this.isUsingOwnModel()) {
      return;
    }
    this.appendHistory(
      [{ role: "user", content: this.props.t(question) }],
      {
        question: this.props.t(question),
        answer: "",
        isWaiting: true,
      },
      () => {
        this.handleAnswer();
      }
    );
    setTimeout(() => {
      if (ConfigService.getReaderConfig("isManualScroll") !== "yes") {
        this.scrollToBottom();
      }
    }, 100);
  };
  openAISettings = () => {
    this.props.handleOpenMenu(false);
    this.props.handleMenuMode("");
    this.props.handleSetting(true);
    this.props.handleSettingMode("ai");
  };

  handleSend = () => {
    if (this.state.isStreaming) {
      this.abortController?.abort();
      return;
    }
    if (this.state.answer || this.state.isWaiting) {
      return;
    }
    this.handleNewQuestion(this.state.inputQuestion);
    this.setState({ inputQuestion: "" }, () => {
      const el = this.textareaRef.current;
      if (el) {
        el.style.height = "40px";
        el.style.overflowY = "hidden";
      }
    });
  };

  renderGreeting = () => {
    if (this.state.mode === "ask") {
      return this.props.t(
        "Hi there! What questions do you have about this chapter?"
      );
    }
    if (this.state.mode === "book") {
      return this.props.t(
        "Hi there! Ask me anything about this book. I'll point you to the passages my answers come from."
      );
    }
    return this.props.t(
      "Hi there! I'm happy to help with any questions about reading or learning"
    );
  };

  render() {
    return (
      <div className="dict-container popup-assist-container">
        <div className="popup-assist-header">
          <div className="popup-assist-tabs">
            {ASSIST_TABS.map((tab) => (
              <div
                key={tab.mode}
                className={
                  (this.state.mode === tab.mode
                    ? "trans-service-selector"
                    : "trans-service-selector-inactive") + " popup-assist-tab"
                }
                title={this.props.t(tab.label)}
                onClick={() => {
                  this.setState({ isAddNew: false, mode: tab.mode });
                }}
              >
                <span className={`${tab.icon} trans-icon`}></span>
                <span className="popup-assist-tab-label">
                  {this.props.t(tab.label)}
                </span>
              </div>
            ))}
          </div>

          <div className="popup-assist-actions">
            <div
              className="popup-assist-export-button"
              style={{ fontSize: 18 }}
              onClick={this.handleDeleteChatHistory}
            >
              <span
                data-tooltip-id="my-tooltip"
                data-tooltip-content={this.props.t("Clear chat history")}
              >
                <span className="icon-trash-line"></span>
              </span>
            </div>
            <div
              className="popup-assist-export-button"
              onClick={this.handleExportChatHistory}
            >
              <span
                data-tooltip-id="my-tooltip"
                data-tooltip-content={this.props.t("Export chat history")}
              >
                <span className="icon-share"></span>
              </span>
            </div>
            <select
              className="dict-service-selector popup-assist-model-selector"
              value={this.state.aiService}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                if (event.target.value === "add-new") {
                  this.openAISettings();
                  return;
                }
                this.handleChangeAiService(event.target.value);
              }}
            >
              <option
                value={""}
                key={"select"}
                className="add-dialog-shelf-list-option"
              >
                {this.props.t("Please select")}
              </option>
              {this.props.plugins
                .filter((item) => item.type === "assistant")
                .map((item) => (
                  <option
                    value={item.key}
                    key={item.key}
                    className="add-dialog-shelf-list-option"
                  >
                    {this.props.t(item.displayName) +
                      (item.key === "official-ai-assistant-plugin"
                        ? " (Pro)"
                        : "")}
                  </option>
                ))}
              <option
                value={"add-new"}
                key={"add-new"}
                className="add-dialog-shelf-list-option"
              >
                {this.props.t("Add new plugin")}
              </option>
            </select>
          </div>
        </div>

        {this.state.isAddNew && (
          <div className="popup-assist-empty">
            <span
              className="popup-assist-book-notice-link"
              onClick={this.openAISettings}
            >
              <Trans>Add new plugin</Trans>
            </span>
          </div>
        )}
        {!this.state.isAddNew && this.isBookModeUnavailable() && (
          <div className="popup-assist-empty popup-assist-book-notice">
            <p>
              {this.props.t(
                "The book assistant sends parts of this book to an AI model you configure yourself. Add a model in the AI settings and select it here to use it."
              )}
            </p>
            <span
              className="popup-assist-book-notice-link"
              onClick={this.openAISettings}
            >
              <Trans>Add new model</Trans>
            </span>
          </div>
        )}
        {!this.state.isAddNew && !this.isBookModeUnavailable() && (
          <>
            <div
              className="dict-text-box popup-assist-messages"
              ref={this.chatBoxRef}
            >
              {this.handleRenderHistoryMessage(this.getHistory())}
              {this.state.isWaiting ? (
                <div className="popup-message-assistant">
                  <span className="icon-loading popup-assistant-loading"></span>
                  <span>
                    {this.state.summaryProgress ||
                      this.props.t("Thinking, please wait...")}
                  </span>
                </div>
              ) : this.getHistory().length > 0 ? (
                <div className="popup-message-assistant">
                  {this.renderMarkdown(this.state.answer)}
                </div>
              ) : (
                <div className="popup-message-assistant">
                  {this.renderGreeting()}
                </div>
              )}
            </div>
            <div className="popup-assist-footer">
              {this.state.mode === "book" && (
                <label className="popup-assist-spoiler-toggle">
                  <input
                    type="checkbox"
                    checked={this.state.isSpoilerFree}
                    onChange={this.handleToggleSpoilerFree}
                  />
                  {this.props.t(
                    "Spoiler-free: only use the book up to the current chapter"
                  )}
                </label>
              )}
              <div className="popup-assist-shortcut-container">
                {sampleQuestion
                  .filter((item) => item.mode === this.state.mode)
                  .map((item) => (
                    <div
                      key={item.question}
                      className="popup-assist-shortcut"
                      onClick={() => {
                        this.handleNewQuestion(item.question);
                      }}
                    >
                      {item.emoji + " " + this.props.t(item.question)}
                    </div>
                  ))}
              </div>
              <div className="popup-assist-input-row">
                <textarea
                  ref={this.textareaRef}
                  name="url"
                  placeholder={this.props.t(
                    this.state.mode === "ask"
                      ? "Ask anything about this chapter"
                      : this.state.mode === "book"
                        ? "Ask anything about this book"
                        : "Ask anything about reading or learning"
                  )}
                  id="trans-add-content-box"
                  className="trans-add-content-box"
                  onContextMenu={() => {
                    handleContextMenu("trans-add-content-box");
                  }}
                  value={this.state.inputQuestion}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                    this.setState({ inputQuestion: event.target.value }, () => {
                      this.autoResizeTextarea();
                    });
                  }}
                />
                <div
                  className="popup-assistant-send-button"
                  onClick={this.handleSend}
                >
                  {this.state.isStreaming
                    ? this.props.t("Stop")
                    : this.props.t("Send")}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }
}
export default PopupAssist;
