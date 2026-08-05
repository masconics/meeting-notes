// Back-compat shim — all LLM traffic goes through multi-provider llm-client.
export {
  callDeepSeek,
  fetchDeepSeekStream,
  callLLM,
  fetchLLMStream,
  LLMError,
  DeepSeekError,
} from "@/lib/llm-client"
export type { ChatMessage, LLMOptions } from "@/lib/llm-client"
