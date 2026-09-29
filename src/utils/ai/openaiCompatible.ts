import toast from "react-hot-toast";
import { SSE } from "sse.js";
import { CommonTool } from "../../assets/lib/kookit-extra-browser.min";
import {
  AIChatRequest,
  AIModelInfo,
  AIProviderAdapter,
  AIProviderConfig,
  AIStreamCallback,
} from "./types";

const LOCAL_PROVIDERS = ["ollama", "lmstudio", "vllm"];

const joinUrl = (endpoint: string, path: string) =>
  endpoint.endsWith("/") ? endpoint + path : endpoint + "/" + path;

const aiRequest = async (
  url: string,
  method: "GET" | "POST",
  headers: Record<string, string>,
  body?: string
) => {
  const response = await fetch(url, {
    method,
    headers,
    body: method === "POST" ? body : undefined,
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
  };
};

const buildHeaders =(apiKey: string): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = "Bearer " + apiKey;
  }
  return headers;
};

const buildMessages = (request: AIChatRequest) =>
  request.system
    ? [{ role: "system", content: request.system }, ...request.messages]
    : request.messages;

const streamChat = (
  config: AIProviderConfig,
  request: AIChatRequest,
  onMessage: AIStreamCallback
) => {
  const payload = JSON.stringify({
    model: config.modelId,
    messages: buildMessages(request),
    stream: true,
    ...CommonTool.getDisableThinkingParams(config.providerId || ""),
  });

  return new Promise<{ done: boolean }>((resolve, reject) => {
    let settled = false;
    const source = new SSE(joinUrl(config.endpoint, "chat/completions"), {
      headers: buildHeaders(config.apiKey),
      payload,
      method: "POST",
    });

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      source.close();
      resolve({ done: true });
    };

    if (request.signal) {
      if (request.signal.aborted) {
        finish();
        return;
      }
      request.signal.addEventListener("abort", finish, { once: true });
    }

    // 流式剔除 <think>...</think> 思考内容，只透传最终回答
    const OPEN_TAG = "<think>";
    const CLOSE_TAG = "</think>";
    let inThink = false;
    let thinkPassed = false;
    let tagBuffer = "";

    const flushText = (text: string) => {
      if (text) {
        onMessage({ text });
      }
    };

    const processDelta = (raw: string) => {
      if (thinkPassed) {
        flushText(raw);
        return;
      }
      tagBuffer += raw;
      let output = "";
      while (tagBuffer) {
        const tag = inThink ? CLOSE_TAG : OPEN_TAG;
        const idx = tagBuffer.indexOf(tag);
        if (idx !== -1) {
          if (!inThink) {
            output += tagBuffer.slice(0, idx);
          }
          tagBuffer = tagBuffer.slice(idx + tag.length);
          inThink = !inThink;
          thinkPassed = !inThink;
          if (thinkPassed) {
            tagBuffer = tagBuffer.replace(/^\s+/, "");
          }
          continue;
        }
        // 保留可能是半个标签的尾部，等下一个分片拼齐后再判断
        let keep = 0;
        for (
          let len = Math.min(tagBuffer.length, tag.length - 1);
          len > 0;
          len--
        ) {
          if (tag.startsWith(tagBuffer.slice(-len))) {
            keep = len;
            break;
          }
        }
        if (!inThink) {
          output += tagBuffer.slice(0, tagBuffer.length - keep);
        }
        tagBuffer = tagBuffer.slice(tagBuffer.length - keep);
        break;
      }
      flushText(output);
    };

    source.addEventListener("open", () => {
      console.info("ChatStream connection established.");
    });

    source.addEventListener("message", (e: any) => {
      if (!e.data) return;
      if (e.data.trim() === "[DONE]") {
        finish();
        return;
      }
      try {
        const json = JSON.parse(e.data);
        const text = json?.choices?.[0]?.delta?.content;
        if (text) {
          processDelta(text);
        }
        const finishReason = json?.choices?.[0]?.finish_reason;
        if (finishReason) {
          finish();
        }
      } catch (err) {
        console.error("ChatStream parse error:", err);
      }
    });

    source.addEventListener("error", (e: any) => {
      if (settled) {
        return;
      }
      settled = true;
      console.error("ChatStream error:", e);
      toast.error(e.data ? JSON.stringify(e.data) : "Unknown error", {
        id: "chat-stream-error",
        duration: 5000,
      });
      source.close();
      reject(e);
    });

    // SSE 连接结束时（无论服务端是否发送 [DONE]）都要结束流，
    // 否则上层 stopUpdateInterval 不会被调用，自动滚底定时器会一直运行
    source.addEventListener("readystatechange", () => {
      if (source.readyState === SSE.CLOSED) {
        finish();
      }
    });
  });
};

const listModels = async (
  config: AIProviderConfig,
  modelsEndpoint?: string
): Promise<AIModelInfo[]> => {
  if (!modelsEndpoint) {
    throw new Error("Model list is not supported by this provider");
  }
  if (!config.apiKey && !LOCAL_PROVIDERS.includes(config.providerId)) {
    throw new Error("Missing API key");
  }
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }
  const response = await aiRequest(modelsEndpoint, "GET", headers);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = JSON.parse(response.body);
  const rawModels = data.data || data.models || data.results || data || [];
  return rawModels.map((m: any) => ({
    id: m.id || m.model || m.name,
    name: m.id || m.display_name || m.name || m.model,
  }));
};

const testConnection = async (config: AIProviderConfig) => {
  const response = await aiRequest(
    joinUrl(config.endpoint, "chat/completions"),
    "POST",
    buildHeaders(config.apiKey),
    JSON.stringify({
      model: config.modelId,
      messages: [{ role: "user", content: "Hi, just testing. Reply with OK." }],
      max_tokens: 10,
    })
  );
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${response.body.substring(0, 200)}`
    );
  }
  const data = JSON.parse(response.body);
  return (
    data.choices?.[0]?.message?.content ||
    JSON.stringify(data).substring(0, 100)
  );
};

const openaiCompatibleAdapter: AIProviderAdapter = {
  streamChat,
  listModels,
  testConnection,
};
export default openaiCompatibleAdapter;
