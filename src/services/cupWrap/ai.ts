import { OPENAI_ROOT } from "../openAiEndpoint";
import { getGeminiApiRoot } from "../gemini";
import {
  startRequestConsoleEntry,
  updateRequestConsoleEntry,
} from "../requestConsole";
import type { AppSettings } from "../../types";
export async function adaptArtwork(
  settings: AppSettings,
  model: string,
  source: Blob,
  prompt: string,
  signal: AbortSignal,
  options?: { transparent: boolean; size?: string; requestSummary?: string },
): Promise<Blob> {
  const gemini = model.startsWith("gemini-"),
    key = gemini ? settings.apiKey : settings.openAiApiKey;
  if (!key) throw new Error("请在右上角配置相应服务商的 API Key");
  const id = startRequestConsoleEntry({
      model,
      connection: gemini ? settings.connectionMode : "direct",
      requestSummary: options?.requestSummary ?? "杯身刀模扩图 · 当前刀模图 · 单次请求，无自动重试",
      requestPrompt: prompt,
      inputImages: [source],
    }),
    start = performance.now();
  try {
    let response: Response;
    if (gemini) {
      const encode = async (blob: Blob) => {
        let text = "";
        for (const byte of new Uint8Array(await blob.arrayBuffer()))
          text += String.fromCharCode(byte);
        return { inlineData: { mimeType: blob.type, data: btoa(text) } };
      };
      const parts = await Promise.all([source].map(encode));
      response = await fetch(
        `${getGeminiApiRoot(settings.connectionMode === "proxy" ? settings.proxyUrl : "")}/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }, ...parts] }],
            generationConfig: {
              responseModalities: ["IMAGE"],
              imageConfig: { imageSize: settings.imageSize },
            },
          }),
          signal,
        },
      );
    } else {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", prompt);
      form.append("image[]", source, "source.png");
      form.append("size", options?.size || "auto");
      form.append("quality", "high");
      form.append("n", "1");
      form.append("output_format", "png");
      form.append(
        "background",
        options?.transparent ? "transparent" : "opaque",
      );
      response = await fetch(`${OPENAI_ROOT}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal,
      });
    }
    const data = await response.json();
    if (!response.ok)
      throw new Error(data?.error?.message || `HTTP ${response.status}`);
    const part = gemini
      ? data.candidates
          ?.flatMap((v: any) => v.content?.parts || [])
          .find((v: any) => v.inlineData?.data)?.inlineData
      : null;
    const encoded = part?.data || data.data?.[0]?.b64_json;
    let blob: Blob;
    if (encoded)
      blob = new Blob(
        [Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))],
        { type: part?.mimeType || "image/png" },
      );
    else if (data.data?.[0]?.url) {
      const r = await fetch(data.data[0].url, { signal });
      if (!r.ok) throw new Error("AI 图片下载失败");
      blob = await r.blob();
    } else throw new Error("模型未返回图片");
    updateRequestConsoleEntry(id, {
      status: "success",
      durationMs: performance.now() - start,
      outputImages: [blob],
      resultSummary: "返回 1 张杯身扩图候选",
    });
    return blob;
  } catch (e) {
    updateRequestConsoleEntry(id, {
      status: signal.aborted ? "stopped" : "failed",
      durationMs: performance.now() - start,
      message: String(e),
    });
    throw e;
  }
}
