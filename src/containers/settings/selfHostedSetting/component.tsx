import React from "react";
import "./selfHostedSetting.css";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { handleContextMenu, openInBrowser } from "../../../utils/common";
import {
  AccessRequest,
  connectSelfHostedServer,
  createAccessRequest,
  disconnectSelfHostedServer,
  fetchAccessRequests,
  fetchAccount,
  fetchPlans,
  DEFAULT_SERVER_URL,
  fetchServerInfo,
  getSelfHostedConfig,
  googleSignInUrl,
  redeemPromoCode,
  refreshSelfHostedStatus,
  requestPasswordReset,
  resendVerification,
  SelfHostedFeature,
  signInWithGoogleCode,
  signInWithPassword,
  signOutAccount,
  signOutDevice,
  signUp,
} from "../../../utils/request/selfHosted";
import { SelfHostedSettingProps, SelfHostedSettingState } from "./interface";

const FEATURE_LABELS: { feature: SelfHostedFeature | "drives"; label: string }[] =
  [
    { feature: "ai", label: "AI features" },
    { feature: "tts", label: "AI voices" },
    { feature: "ocr", label: "AI OCR" },
    { feature: "metadata", label: "Book metadata" },
    { feature: "vault", label: "Sync to your own storage" },
    { feature: "assets", label: "Font and dictionary downloads" },
    { feature: "drives", label: "Cloud drives" },
  ];

const LIMIT_LABELS: Record<string, string> = {
  ai_requests: "AI requests this month",
  tts_chars: "Voice characters this month",
  ocr_pages: "OCR pages this month",
};

const formatDate = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

class SelfHostedSetting extends React.Component<
  SelfHostedSettingProps,
  SelfHostedSettingState
> {
  constructor(props: SelfHostedSettingProps) {
    super(props);
    const config = getSelfHostedConfig();
    this.state = {
      step: "server",
      url: config?.url || DEFAULT_SERVER_URL,
      info: null,
      authMode: "signin",
      name: "",
      email: "",
      password: "",
      token: "",
      isGoogleWaiting: false,
      googleCode: "",
      notice: "",
      isBusy: false,
      config,
      account: null,
      plans: null,
      requests: [],
      promoCode: "",
      requestPackageId: 0,
      paymentReference: "",
      requestMessage: "",
      isSpecialOpen: false,
      specialMessage: "",
    };
  }

  componentDidMount() {
    window.addEventListener("message", this.handleLoginMessage);
    if (this.state.config?.account) {
      this.loadAccount();
    }
  }

  componentWillUnmount() {
    window.removeEventListener("message", this.handleLoginMessage);
  }

  // Google sign-in page handing the code back (web, when the server trusts
  // this app's origin)
  handleLoginMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; code?: string } | null;
    if (
      !this.state.isGoogleWaiting ||
      !data ||
      data.type !== "folio-login" ||
      !data.code ||
      !this.state.url ||
      !this.state.url.startsWith(event.origin)
    ) {
      return;
    }
    this.setState({ googleCode: data.code }, this.handleGoogleCode);
  };

  // Runs a step with the busy state and an error toast
  busy = async (action: () => Promise<void>) => {
    if (this.state.isBusy) return;
    this.setState({ isBusy: true });
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      this.setState({ isBusy: false });
    }
  };

  afterConnect = async () => {
    const config = getSelfHostedConfig();
    this.setState({
      config,
      password: "",
      token: "",
      googleCode: "",
      isGoogleWaiting: false,
      notice: "",
    });
    this.props.handleFetchPlugins();
    this.props.handleFetchAuthed();
    toast.success(this.props.t("Connected to the server"));
    if (config?.account) {
      await this.loadAccount();
    }
  };

  loadAccount = async () => {
    const [account, plans, requests] = await Promise.all([
      fetchAccount(),
      fetchPlans(),
      fetchAccessRequests(),
    ]);
    if (account.code === 401) {
      // Signed out elsewhere (password reset, admin)
      disconnectSelfHostedServer();
      this.setState({ config: null, account: null, step: "server" });
      this.props.handleFetchAuthed();
      toast(this.props.t("You were signed out; sign in again"));
      return;
    }
    this.setState({
      account: account.code === 200 && account.data ? account.data : null,
      plans,
      requests: requests.code === 200 && requests.data ? requests.data : [],
    });
    // The plan decides the features; keep the app in step
    await refreshSelfHostedStatus();
    this.setState({ config: getSelfHostedConfig() });
    this.props.handleFetchPlugins();
  };

  handleContinue = () =>
    this.busy(async () => {
      if (!this.state.url.trim()) {
        throw new Error(this.props.t("Please fill in all required fields"));
      }
      const info = await fetchServerInfo(this.state.url);
      // Servers without accounts only take the owner token
      this.setState({ info, step: info ? "account" : "token" });
    });

  handlePasswordAuth = () =>
    this.busy(async () => {
      const { url, name, email, password, authMode } = this.state;
      if (!email.trim() || !password) {
        throw new Error(this.props.t("Please fill in all required fields"));
      }
      const result =
        authMode === "signup"
          ? await signUp(url, name, email, password)
          : await signInWithPassword(url, email, password);
      if (result.verificationRequired) {
        this.setState({
          authMode: "signin",
          password: "",
          notice: this.props.t(
            "We sent a confirmation link to your email. Open it, then sign in."
          ),
        });
        return;
      }
      await this.afterConnect();
    });

  handleGoogleStart = () => {
    openInBrowser(googleSignInUrl(this.state.url));
    this.setState({ isGoogleWaiting: true, googleCode: "" });
  };

  handleGoogleCode = () =>
    this.busy(async () => {
      if (!this.state.googleCode.trim()) {
        throw new Error(this.props.t("Please fill in all required fields"));
      }
      await signInWithGoogleCode(this.state.url, this.state.googleCode);
      await this.afterConnect();
    });

  handleForgot = () =>
    this.busy(async () => {
      if (!this.state.email.trim()) {
        throw new Error(this.props.t("Enter your email first"));
      }
      await requestPasswordReset(this.state.url, this.state.email);
      this.setState({
        notice: this.props.t(
          "If an account uses this email, we sent it a link to choose a new password."
        ),
      });
    });

  handleResend = () =>
    this.busy(async () => {
      await resendVerification(this.state.url, this.state.email);
      toast.success(this.props.t("Sent"));
    });

  handleTokenConnect = () =>
    this.busy(async () => {
      if (!this.state.url.trim() || !this.state.token.trim()) {
        throw new Error(this.props.t("Please fill in all required fields"));
      }
      await connectSelfHostedServer(this.state.url, this.state.token);
      await this.afterConnect();
    });

  handleRefresh = () =>
    this.busy(async () => {
      if (this.state.config?.account) {
        await this.loadAccount();
      } else {
        await refreshSelfHostedStatus();
        this.setState({ config: getSelfHostedConfig() });
        this.props.handleFetchPlugins();
      }
      toast.success(this.props.t("Refresh successful"));
    });

  handleSignOut = () =>
    this.busy(async () => {
      if (this.state.config?.account) {
        await signOutAccount();
      } else {
        disconnectSelfHostedServer();
      }
      this.setState({ config: null, account: null, step: "server" });
      this.props.handleFetchPlugins();
      this.props.handleFetchAuthed();
      toast.success(this.props.t("Disconnected"));
    });

  handleRedeem = () =>
    this.busy(async () => {
      const response = await redeemPromoCode(this.state.promoCode);
      if (response.code !== 200) throw new Error(response.msg);
      this.setState({ promoCode: "" });
      toast.success(this.props.t("Code redeemed"));
      await this.loadAccount();
    });

  handleSendRequest = (kind: "subscription" | "special") =>
    this.busy(async () => {
      const response = await createAccessRequest(
        kind === "subscription"
          ? {
              kind,
              package_id: this.state.requestPackageId,
              payment_reference: this.state.paymentReference,
              message: this.state.requestMessage,
            }
          : { kind, message: this.state.specialMessage }
      );
      if (response.code !== 200) throw new Error(response.msg);
      this.setState({
        requests: response.data || [],
        requestPackageId: 0,
        paymentReference: "",
        requestMessage: "",
        isSpecialOpen: false,
        specialMessage: "",
      });
      toast.success(this.props.t("Request sent; you'll get access once it's approved"));
    });

  handleSignOutDevice = (id: number) =>
    this.busy(async () => {
      const response = await signOutDevice(id);
      if (response.code !== 200) throw new Error(response.msg);
      await this.loadAccount();
    });

  input = (
    id: string,
    value: string,
    onChange: (value: string) => void,
    options: {
      type?: string;
      placeholder?: string;
      onEnter?: () => void;
      autoComplete?: string;
    } = {}
  ) => (
    <input
      type={options.type || "text"}
      className="token-dialog-username-box"
      id={id}
      value={value}
      placeholder={options.placeholder}
      autoComplete={options.autoComplete}
      onContextMenu={() => handleContextMenu(id, true)}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && options.onEnter) options.onEnter();
      }}
    />
  );

  button = (
    label: string,
    onClick: () => void,
    primary: boolean = false
  ) => (
    <span
      role="button"
      tabIndex={0}
      className={"self-hosted-button" + (primary ? " primary" : "")}
      aria-disabled={this.state.isBusy}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      {this.state.isBusy && primary ? (
        <Trans>Loading...</Trans>
      ) : (
        this.props.t(label)
      )}
    </span>
  );

  // onlyIncluded: list just what's included (plan cards)
  renderFeatures = (
    features: Partial<Record<string, boolean>>,
    onlyIncluded: boolean = false
  ) => (
    <div className="self-hosted-features">
      {FEATURE_LABELS.filter(
        ({ feature }) => !onlyIncluded || features[feature]
      ).map(({ feature, label }) => (
        <span
          key={feature}
          className={
            "self-hosted-feature" + (features[feature] ? " is-on" : "")
          }
        >
          <span className={features[feature] ? "icon-check" : "icon-close"}></span>
          {this.props.t(label)}
        </span>
      ))}
    </div>
  );

  // ── Not connected ────────────────────────────────────────────────────────

  renderServerStep = () => (
    <div className="self-hosted-card self-hosted-form">
      <label className="ai-setting-label">
        <Trans>Server address</Trans>
      </label>
      {this.input(
        "self-hosted-url-box",
        this.state.url,
        (url) => this.setState({ url }),
        {
          placeholder: "https://folio.example.com",
          onEnter: this.handleContinue,
          autoComplete: "url",
        }
      )}
      <div className="self-hosted-row">
        {this.button("Continue", this.handleContinue, true)}
      </div>
    </div>
  );

  renderAccountStep = () => {
    const { info, authMode, isGoogleWaiting, notice } = this.state;
    const canSignUp = !!info?.registration_open;
    return (
      <div className="self-hosted-card self-hosted-form">
        <div className="self-hosted-row between">
          <span className="self-hosted-url">{this.state.url}</span>
          <span
            className="self-hosted-link"
            onClick={() => this.setState({ step: "server", notice: "" })}
          >
            <Trans>Change</Trans>
          </span>
        </div>
        {canSignUp && (
          <div className="self-hosted-tabs">
            {(["signin", "signup"] as const).map((mode) => (
              <span
                key={mode}
                className={authMode === mode ? "active" : ""}
                onClick={() => this.setState({ authMode: mode, notice: "" })}
              >
                {this.props.t(mode === "signin" ? "Sign in" : "Create account")}
              </span>
            ))}
          </div>
        )}
        {notice && (
          <div className="self-hosted-notice">
            {notice}{" "}
            {info?.email_verification && (
              <span className="self-hosted-link" onClick={this.handleResend}>
                <Trans>Send the email again</Trans>
              </span>
            )}
          </div>
        )}
        {authMode === "signup" &&
          this.input("self-hosted-name-box", this.state.name, (name) =>
            this.setState({ name }),
            { placeholder: this.props.t("Name"), autoComplete: "name" }
          )}
        {this.input(
          "self-hosted-email-box",
          this.state.email,
          (email) => this.setState({ email }),
          {
            type: "email",
            placeholder: this.props.t("Email"),
            autoComplete: "email",
          }
        )}
        {this.input(
          "self-hosted-password-box",
          this.state.password,
          (password) => this.setState({ password }),
          {
            type: "password",
            placeholder: this.props.t(
              authMode === "signup" ? "Password (8+ characters)" : "Password"
            ),
            onEnter: this.handlePasswordAuth,
            autoComplete:
              authMode === "signup" ? "new-password" : "current-password",
          }
        )}
        <div className="self-hosted-row between">
          {this.button(
            authMode === "signup" ? "Create account" : "Sign in",
            this.handlePasswordAuth,
            true
          )}
          {authMode === "signin" && info?.password_reset && (
            <span className="self-hosted-link" onClick={this.handleForgot}>
              <Trans>Forgot password?</Trans>
            </span>
          )}
        </div>
        {info?.google_enabled && (
          <>
            <div className="self-hosted-divider">
              <Trans>or</Trans>
            </div>
            {this.button("Continue with Google", this.handleGoogleStart)}
            {isGoogleWaiting && (
              <>
                <div className="self-hosted-muted">
                  <Trans>
                    Finish signing in in your browser, then paste the code it shows here.
                  </Trans>
                </div>
                <div className="self-hosted-row">
                  {this.input(
                    "self-hosted-google-code-box",
                    this.state.googleCode,
                    (googleCode) => this.setState({ googleCode }),
                    {
                      placeholder: "XXXXX-XXXXX",
                      onEnter: this.handleGoogleCode,
                    }
                  )}
                  {this.button("Sign in", this.handleGoogleCode, true)}
                </div>
              </>
            )}
          </>
        )}
        {info?.owner_token && (
          <span
            className="self-hosted-link"
            onClick={() => this.setState({ step: "token" })}
          >
            <Trans>I'm the server owner: use the access token</Trans>
          </span>
        )}
      </div>
    );
  };

  renderTokenStep = () => (
    <div className="self-hosted-card self-hosted-form">
      <div className="self-hosted-row between">
        <span className="self-hosted-url">{this.state.url}</span>
        <span
          className="self-hosted-link"
          onClick={() =>
            this.setState({ step: this.state.info ? "account" : "server" })
          }
        >
          <Trans>Back</Trans>
        </span>
      </div>
      <label className="ai-setting-label">
        <Trans>Access token</Trans>
      </label>
      {this.input(
        "self-hosted-token-box",
        this.state.token,
        (token) => this.setState({ token }),
        {
          type: "password",
          placeholder: this.props.t(
            "PRO_ACCESS_TOKEN from the server configuration"
          ),
          onEnter: this.handleTokenConnect,
        }
      )}
      <div className="self-hosted-row">
        {this.button("Connect", this.handleTokenConnect, true)}
      </div>
    </div>
  );

  // ── Connected ────────────────────────────────────────────────────────────

  renderOwner = () => {
    const config = this.state.config!;
    return (
      <div className="self-hosted-card">
        <div className="self-hosted-card-head">
          <div>
            <div className="self-hosted-url">{config.url}</div>
            <div className="self-hosted-muted">
              <Trans>Connected with the owner access token</Trans>
            </div>
          </div>
        </div>
        {this.renderFeatures(config.features)}
        <div className="self-hosted-row" style={{ marginTop: 12 }}>
          {this.button("Refresh", this.handleRefresh)}
          {this.button("Disconnect", this.handleSignOut)}
        </div>
      </div>
    );
  };

  renderRequest = (request: AccessRequest) => (
    <div className="self-hosted-list-item" key={request.id}>
      <div>
        <div>
          {request.kind === "special"
            ? this.props.t("Special access")
            : request.package_name}
        </div>
        <div className="self-hosted-muted">
          {formatDate(request.created_at)}
          {request.admin_note ? " · " + request.admin_note : ""}
        </div>
      </div>
      <span className={"self-hosted-status " + request.status}>
        {this.props.t(
          request.status === "pending"
            ? "Waiting for review"
            : request.status === "approved"
              ? "Approved"
              : "Declined"
        )}
      </span>
    </div>
  );

  renderAccount = () => {
    const { config, account, plans, requests } = this.state;
    if (!account) {
      return (
        <div className="self-hosted-card">
          <div className="self-hosted-url">{config!.account!.email}</div>
          <div className="self-hosted-muted">
            <Trans>Loading...</Trans>
          </div>
        </div>
      );
    }
    const sub = account.subscription;
    const limited = Object.keys(account.limits);
    const pending = requests.some((r) => r.status === "pending");
    return (
      <>
        <div className="self-hosted-card">
          <div className="self-hosted-card-head">
            <div>
              <div className="self-hosted-url">
                {account.user.name || account.user.email}
              </div>
              <div className="self-hosted-muted">
                {account.user.name ? account.user.email + " · " : ""}
                {config!.url}
              </div>
            </div>
            <span className="self-hosted-link" onClick={this.handleSignOut}>
              <Trans>Sign out</Trans>
            </span>
          </div>
          <div className="self-hosted-muted">
            <Trans>Your plan</Trans>
          </div>
          <div className="self-hosted-plan-name">
            {account.package ? account.package.name : this.props.t("No plan yet")}
          </div>
          {sub && (
            <div className="self-hosted-muted">
              {sub.ends_at
                ? this.props.t("Active until") + " " + formatDate(sub.ends_at)
                : this.props.t("No end date")}
            </div>
          )}
          {this.renderFeatures(account.features)}
          {limited.map((metric) => {
            const used = account.usage[metric] || 0;
            const limit = account.limits[metric];
            return (
              <div className="self-hosted-meter" key={metric}>
                <div className="self-hosted-row between">
                  <span>{this.props.t(LIMIT_LABELS[metric] || metric)}</span>
                  <span>
                    {used.toLocaleString()} / {limit.toLocaleString()}
                  </span>
                </div>
                <div
                  className={
                    "self-hosted-meter-bar" + (used >= limit ? " is-full" : "")
                  }
                >
                  <span
                    style={{
                      width: (limit ? Math.min(100, (used / limit) * 100) : 100) + "%",
                    }}
                  ></span>
                </div>
              </div>
            );
          })}
          <div className="self-hosted-row" style={{ marginTop: 12 }}>
            {this.button("Refresh", this.handleRefresh)}
          </div>
        </div>

        <div className="self-hosted-card self-hosted-form">
          <div className="self-hosted-card-title">
            <Trans>Have a promo code?</Trans>
          </div>
          <div className="self-hosted-row">
            {this.input(
              "self-hosted-promo-box",
              this.state.promoCode,
              (promoCode) => this.setState({ promoCode }),
              { placeholder: "XXXXX-XXXXX", onEnter: this.handleRedeem }
            )}
            {this.button("Redeem", this.handleRedeem, true)}
          </div>
        </div>

        {plans && plans.packages.length > 0 && (
          <div className="self-hosted-card">
            <div className="self-hosted-card-head">
              <span className="self-hosted-card-title">
                <Trans>Plans</Trans>
              </span>
            </div>
            <div className="self-hosted-plans">
              {plans.packages.map((plan) => {
                const isCurrent = account.package?.id === plan.id;
                const isOpen = this.state.requestPackageId === plan.id;
                return (
                  <div
                    key={plan.id}
                    className={"self-hosted-plan" + (isCurrent ? " is-current" : "")}
                  >
                    <div className="self-hosted-row between">
                      <span className="self-hosted-card-title">{plan.name}</span>
                      {plan.price_label && (
                        <span className="self-hosted-plan-price">
                          {plan.price_label}
                        </span>
                      )}
                    </div>
                    {plan.description && (
                      <p className="self-hosted-plan-desc">{plan.description}</p>
                    )}
                    {this.renderFeatures(
                      Object.fromEntries(plan.features.map((f) => [f, true])),
                      true
                    )}
                    {isOpen ? (
                      <div className="self-hosted-form" style={{ marginTop: 12 }}>
                        {plans.payment_instructions && (
                          <div className="self-hosted-instructions">
                            {plans.payment_instructions}
                          </div>
                        )}
                        {this.input(
                          "self-hosted-payment-box",
                          this.state.paymentReference,
                          (paymentReference) => this.setState({ paymentReference }),
                          { placeholder: this.props.t("Payment reference (transaction ID)") }
                        )}
                        <textarea
                          className="token-dialog-username-box"
                          placeholder={this.props.t("Message to the admin (optional)")}
                          value={this.state.requestMessage}
                          onChange={(e) => this.setState({ requestMessage: e.target.value })}
                        />
                        <div className="self-hosted-row">
                          {this.button("Send request", () => this.handleSendRequest("subscription"), true)}
                          {this.button("Cancel", () => this.setState({ requestPackageId: 0 }))}
                        </div>
                      </div>
                    ) : isCurrent && !account.subscription?.ends_at ? null : (
                      <div className="self-hosted-row" style={{ marginTop: 12 }}>
                        {this.button(
                          isCurrent ? "Extend" : "Get this plan",
                          () => this.setState({ requestPackageId: plan.id })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="self-hosted-card self-hosted-form">
          <div className="self-hosted-card-head" style={{ marginBottom: 0 }}>
            <span className="self-hosted-card-title">
              <Trans>Special access</Trans>
            </span>
            {!this.state.isSpecialOpen && (
              <span
                className="self-hosted-link"
                onClick={() => this.setState({ isSpecialOpen: true })}
              >
                <Trans>Ask the admin</Trans>
              </span>
            )}
          </div>
          <div className="self-hosted-muted">
            <Trans>For students, testers, or anything the plans don't cover.</Trans>
          </div>
          {this.state.isSpecialOpen && (
            <>
              <textarea
                className="token-dialog-username-box"
                placeholder={this.props.t("What do you need, and why?")}
                value={this.state.specialMessage}
                onChange={(e) => this.setState({ specialMessage: e.target.value })}
              />
              <div className="self-hosted-row">
                {this.button("Send request", () => this.handleSendRequest("special"), true)}
                {this.button("Cancel", () => this.setState({ isSpecialOpen: false }))}
              </div>
            </>
          )}
        </div>

        {requests.length > 0 && (
          <div className="self-hosted-card">
            <div className="self-hosted-card-head">
              <span className="self-hosted-card-title">
                <Trans>Your requests</Trans>
              </span>
              {pending && (
                <span className="self-hosted-muted">
                  <Trans>We'll update your plan once it's approved</Trans>
                </span>
              )}
            </div>
            {requests.slice(0, 5).map(this.renderRequest)}
          </div>
        )}

        {account.devices.length > 1 && (
          <div className="self-hosted-card">
            <div className="self-hosted-card-head">
              <span className="self-hosted-card-title">
                <Trans>Signed-in devices</Trans>
              </span>
            </div>
            {account.devices.map((device) => (
              <div className="self-hosted-list-item" key={device.id}>
                <div>
                  <div>{device.name || this.props.t("Device")}</div>
                  <div className="self-hosted-muted">
                    {this.props.t("Signed in")} {formatDate(device.created_at)}
                  </div>
                </div>
                {device.id === account.current_device ? (
                  <span className="self-hosted-muted">
                    <Trans>This device</Trans>
                  </span>
                ) : (
                  <span
                    className="self-hosted-link"
                    onClick={() => this.handleSignOutDevice(device.id)}
                  >
                    <Trans>Sign out</Trans>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  render() {
    const { config, step } = this.state;
    return (
      <div className="self-hosted-setting">
        <p className="self-hosted-setting-desc">
          <Trans>
            Folio's AI, voices, OCR, sync and downloads come from a Folio server. Sign in to your account on it, or create one.
          </Trans>
        </p>
        {config
          ? config.account
            ? this.renderAccount()
            : this.renderOwner()
          : step === "account"
            ? this.renderAccountStep()
            : step === "token"
              ? this.renderTokenStep()
              : this.renderServerStep()}
      </div>
    );
  }
}

export default SelfHostedSetting;
