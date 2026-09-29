export interface AIChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Mirrors the model entry saved by the AI settings page (aiModelConfig)
export interface AIProviderConfig {
  endpoint: string;
  providerId: string;
  apiKey: string;
  modelId: string;
}

export interface AIChatRequest {
  system?: string;
  messages: AIChatMessage[];
  signal?: AbortSignal;
}

export type AIStreamCallback = (result: { text: string }) => void;

export interface AIModelInfo {
  id: string;
  name: string;
}

export interface AIProviderAdapter {
  streamChat: (
    config: AIProviderConfig,
    request: AIChatRequest,
    onMessage: AIStreamCallback
  ) => Promise<{ done: boolean }>;
  listModels: (
    config: AIProviderConfig,
    modelsEndpoint?: string
  ) => Promise<AIModelInfo[]>;
  // Resolves with a short reply from the model, throws on failure
  testConnection: (config: AIProviderConfig) => Promise<string>;
}
