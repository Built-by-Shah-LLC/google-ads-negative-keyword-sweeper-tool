import type { AppConfig } from "../config/env.js";
import type { KeywordClassifier } from "./classifier.js";
import { GeminiKeywordClassifier } from "./gemini-classifier.js";
import { MoonshotKeywordClassifier } from "./moonshot-classifier.js";
import { OpenAIKeywordClassifier } from "./openai-classifier.js";

export function createKeywordClassifier(config: AppConfig["llm"]): KeywordClassifier {
  if (config.provider === "openai") return new OpenAIKeywordClassifier(config);
  if (config.provider === "gemini") return new GeminiKeywordClassifier(config);
  return new MoonshotKeywordClassifier(config);
}
