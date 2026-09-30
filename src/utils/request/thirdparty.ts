import toast from "react-hot-toast";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import i18n from "../../i18n";
import TokenService from "../storage/tokenService";
import {
  selfHostedDecryptToken,
  selfHostedEncryptToken,
  selfHostedOAuthRefresh,
  selfHostedOAuthToken,
} from "./selfHosted";

// Data-source credentials are encrypted by the Folio server; the app keeps
// only the encrypted token and asks the server to decrypt it when it syncs.
// Cloud drives sign in through the server's OAuth apps.

export const onSyncCallback = async (service: string, authCode: string) => {
  toast.loading(i18n.t("Adding"), { id: "adding-sync-id" });

  let response = await authThirdToken(service, authCode.trim());
  let result = response.data;
  if (!result || !result.refresh_token) {
    toast.error(i18n.t("Authorization failed"), { id: "adding-sync-id" });
    return;
  }
  let region = "0";
  if (service === "pcloud" && authCode.indexOf("$") > -1) {
    // pCloud uses authCode with region info
    let parts = authCode.split("$");
    region = parts[1];
  }
  // FOR PCLOUD, THE REFRESH TOKEN IS THE ACCESS TOKEN, ACCESS TOKEN NEVER EXPIRES
  let res = await encryptToken(
    service,
    service === "yiyiwu" || service === "dubox"
      ? {
          refresh_token: result.refresh_token,
          access_token: result.access_token || "",
          expires_at:
            new Date().getTime() +
            (service === "yiyiwu" ? 30 * 60 * 1000 : 2592000 * 1000),
          region,
          auth_date: new Date().getTime(),
          service: service,
          version: 1,
        }
      : {
          refresh_token: result.refresh_token,
          region,
          auth_date: new Date().getTime(),
          service: service,
          version: 1,
        }
  );
  if (res.code === 200) {
    ConfigService.setListConfig(service, "dataSourceList");
    toast.success(i18n.t("Binding successful"), { id: "adding-sync-id" });
  }
  return res;
};
export const encryptToken = async (service: string, config: any) => {
  let response = await selfHostedEncryptToken(JSON.stringify(config));
  if (response.code === 200 && response.data) {
    await TokenService.setToken(
      service + "_token",
      response.data.encrypted_token
    );
  } else {
    toast.error(i18n.t("Encryption failed, error code") + ": " + response.msg);
  }
  return response;
};
export const decryptToken = async (service: string) => {
  let encryptedToken = await TokenService.getToken(service + "_token");
  if (!encryptedToken || encryptedToken === "{}") {
    return { code: 0, msg: "No saved credentials", data: undefined };
  }
  let response = await selfHostedDecryptToken(encryptedToken);
  if (response.code !== 200) {
    toast.error(i18n.t("Decryption failed, error code") + ": " + response.msg);
  }
  return response;
};
export const authThirdToken = async (provider: string, code: string) => {
  let response = await selfHostedOAuthToken(provider, code);
  if (response.code !== 200) {
    toast.error(
      i18n.t("Authorization failed, error code") + ": " + response.msg
    );
  }
  return response;
};
export const refreshThirdToken = async (
  provider: string,
  refresh_token: string
) => {
  let response = await selfHostedOAuthRefresh(provider, refresh_token);
  if (response.code !== 200) {
    toast.error(
      i18n.t("Authorization failed, error code") + ": " + response.msg
    );
  }
  return response;
};
