import { SelfHostedConfig } from "../../../utils/request/selfHosted";

export interface SelfHostedSettingProps {
  handleFetchPlugins: () => void;
  t: (title: string) => string;
}

export interface SelfHostedSettingState {
  url: string;
  token: string;
  isConnecting: boolean;
  config: SelfHostedConfig | null;
}
