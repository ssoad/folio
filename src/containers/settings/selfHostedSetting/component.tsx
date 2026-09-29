import React from "react";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { handleContextMenu } from "../../../utils/common";
import {
  connectSelfHostedServer,
  disconnectSelfHostedServer,
  getSelfHostedConfig,
  refreshSelfHostedStatus,
  SelfHostedFeature,
} from "../../../utils/request/selfHosted";
import { SelfHostedSettingProps, SelfHostedSettingState } from "./interface";

const FEATURE_LABELS: { feature: SelfHostedFeature; label: string }[] = [
  { feature: "ai", label: "AI features" },
  { feature: "tts", label: "AI voices" },
  { feature: "ocr", label: "AI OCR" },
  { feature: "metadata", label: "Book metadata" },
];

class SelfHostedSetting extends React.Component<
  SelfHostedSettingProps,
  SelfHostedSettingState
> {
  constructor(props: SelfHostedSettingProps) {
    super(props);
    const config = getSelfHostedConfig();
    this.state = {
      url: config?.url || "",
      token: "",
      isConnecting: false,
      config,
    };
  }

  handleConnect = async () => {
    if (!this.state.url.trim() || !this.state.token.trim()) {
      toast.error(this.props.t("Please fill in all required fields"));
      return;
    }
    this.setState({ isConnecting: true });
    try {
      await connectSelfHostedServer(this.state.url, this.state.token);
      this.setState({ config: getSelfHostedConfig(), token: "" });
      this.props.handleFetchPlugins();
      toast.success(this.props.t("Connected to the self-hosted server"));
    } catch (error) {
      toast.error(
        this.props.t("Connection failed") +
          ": " +
          (error instanceof Error ? error.message : String(error))
      );
    } finally {
      this.setState({ isConnecting: false });
    }
  };

  handleRefresh = async () => {
    this.setState({ isConnecting: true });
    await refreshSelfHostedStatus();
    this.setState({ config: getSelfHostedConfig(), isConnecting: false });
    this.props.handleFetchPlugins();
    toast.success(this.props.t("Refresh successful"));
  };

  handleDisconnect = () => {
    disconnectSelfHostedServer();
    this.setState({ config: null, token: "" });
    this.props.handleFetchPlugins();
    toast.success(this.props.t("Disconnected"));
  };

  render() {
    const { config } = this.state;
    return (
      <div className="self-hosted-setting">
        <div className="setting-dialog-new-title self-hosted-setting-title">
          <Trans>Self-hosted server</Trans>
        </div>
        <p className="self-hosted-setting-desc">
          {this.props.t(
            "Use Pro features through your own Koodo Reader server: AI with your own model, AI voices, OCR, book metadata and sync to your own storage."
          )}
        </p>

        {config ? (
          <div className="self-hosted-setting-body">
            <div className="self-hosted-setting-url">{config.url}</div>
            <div className="self-hosted-setting-features">
              {FEATURE_LABELS.map(({ feature, label }) => (
                <span
                  key={feature}
                  className={
                    "self-hosted-setting-feature" +
                    (config.features[feature] ? " is-on" : "")
                  }
                  data-tooltip-id="my-tooltip"
                  data-tooltip-content={this.props.t(
                    config.features[feature]
                      ? "Available"
                      : "Not configured on the server"
                  )}
                >
                  <span
                    className={
                      config.features[feature] ? "icon-check" : "icon-close"
                    }
                  ></span>
                  {this.props.t(label)}
                </span>
              ))}
            </div>
            <div className="self-hosted-setting-actions">
              <span
                className="change-location-button"
                onClick={this.handleRefresh}
              >
                {this.state.isConnecting ? (
                  <Trans>Loading...</Trans>
                ) : (
                  <Trans>Refresh</Trans>
                )}
              </span>
              <span
                className="change-location-button"
                onClick={this.handleDisconnect}
              >
                <Trans>Disconnect</Trans>
              </span>
            </div>
          </div>
        ) : (
          <div className="self-hosted-setting-body">
            <div className="ai-setting-form-row">
              <label className="ai-setting-label">
                <Trans>Server address</Trans>
              </label>
              <input
                type="text"
                className="token-dialog-username-box"
                id="self-hosted-url-box"
                placeholder="https://reader.example.com"
                value={this.state.url}
                onContextMenu={() => {
                  handleContextMenu("self-hosted-url-box", true);
                }}
                onChange={(e) => this.setState({ url: e.target.value })}
              />
            </div>
            <div className="ai-setting-form-row">
              <label className="ai-setting-label">
                <Trans>Access token</Trans>
              </label>
              <input
                type="password"
                className="token-dialog-username-box"
                id="self-hosted-token-box"
                placeholder={this.props.t(
                  "PRO_ACCESS_TOKEN from the server configuration"
                )}
                value={this.state.token}
                onContextMenu={() => {
                  handleContextMenu("self-hosted-token-box", true);
                }}
                onChange={(e) => this.setState({ token: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") this.handleConnect();
                }}
              />
            </div>
            <span
              className="change-location-button"
              onClick={this.handleConnect}
            >
              {this.state.isConnecting ? (
                <Trans>Loading...</Trans>
              ) : (
                <Trans>Connect</Trans>
              )}
            </span>
          </div>
        )}
      </div>
    );
  }
}

export default SelfHostedSetting;
