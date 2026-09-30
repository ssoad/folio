import {
  AccessRequest,
  AccountPackage,
  AccountSummary,
  SelfHostedConfig,
  ServerInfo,
} from "../../../utils/request/selfHosted";

export interface SelfHostedSettingProps {
  handleFetchPlugins: () => void;
  handleFetchAuthed: () => void;
  t: (title: string) => string;
}

export type SelfHostedStep = "server" | "account" | "token";

export interface SelfHostedSettingState {
  // Not connected: which form shows
  step: SelfHostedStep;
  url: string;
  info: ServerInfo | null;
  authMode: "signin" | "signup";
  name: string;
  email: string;
  password: string;
  token: string;
  // Waiting for the code from Google sign-in in the browser
  isGoogleWaiting: boolean;
  googleCode: string;
  notice: string;
  isBusy: boolean;
  config: SelfHostedConfig | null;
  // Signed in with an account
  account: AccountSummary | null;
  plans: { packages: AccountPackage[]; payment_instructions: string } | null;
  requests: AccessRequest[];
  promoCode: string;
  // The plan whose request form is open
  requestPackageId: number;
  paymentReference: string;
  requestMessage: string;
  isSpecialOpen: boolean;
  specialMessage: string;
}
