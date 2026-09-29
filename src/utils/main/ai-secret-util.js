const { safeStorage } = require("electron");

const AI_SECRET_PREFIX = "enc:v1:";
const AI_SECRET_MAX_LENGTH = 4096;

// On Linux without a keyring safeStorage falls back to a hardcoded password,
// which gives no real protection, so keys stay as they were in that case
const isAiSecretStorageAvailable = () => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return false;
    }
    if (
      process.platform === "linux" &&
      typeof safeStorage.getSelectedStorageBackend === "function" &&
      safeStorage.getSelectedStorageBackend() === "basic_text"
    ) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
};

module.exports = {
  AI_SECRET_PREFIX,
  AI_SECRET_MAX_LENGTH,
  isAiSecretStorageAvailable,
};
