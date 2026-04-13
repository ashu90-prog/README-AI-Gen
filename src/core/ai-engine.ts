/**
 * AI Engine — unified multi-provider chat-completion client.
 *
 * Supported providers:
 *   • OpenAI      (native SDK)
 *   • Anthropic   (native SDK)
 *   • Gemini      (native SDK)
 *   • OpenRouter  (OpenAI-compatible, via `openai` SDK with custom baseUrl)
 *   • NVIDIA      (OpenAI-compatible, via `openai` SDK with custom baseUrl)
 *
 * Features:
 *   • Exponential-backoff retries
 *   • Rate-limit (429) detection with `Retry-After` header support
 *   • Provider-agnostic `AIRequest → AIResponse` interface
 *   • Clean error mapping into `AIError`
 *
 * @module core/ai-engine
 */

import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

import {
  AIProvider,
  AIEngineConfig,
  AIRequest,
  AIResponse,
  ChatMessage,
  AIError,
  ProviderConfig,
  DEFAULT_RETRY,
  RetryConfig,
} from './ai-types.js';

// ─────────────────────────── Default models ───────────────────────────

/**
 * Sensible default model per provider when the user doesn't specify one.
 */
const DEFAULT_MODELS: Readonly<Record<AIProvider, string>> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.0-flash',
  openrouter: 'openrouter/auto',
  nvidia: 'meta/llama-3.1-405b-instruct',
};

/** Default max tokens. */
const DEFAULT_MAX_TOKENS = 4096;
/** Default temperature. */
const DEFAULT_TEMPERATURE = 0.7;

// ─────────────────────────── Resolved config helper ───────────────────────────

/**
 * Merge global defaults with per-provider config to produce a fully-resolved
 * `ProviderConfig` (guarantees every field is present).
 */
function resolveProviderConfig(
  provider: AIProvider,
  cfg: AIEngineConfig['providers'][AIProvider]
): ProviderConfig {
  const apiKey = cfg?.apiKey ?? '';
  return {
    apiKey,
    baseUrl: cfg?.baseUrl,
    model: cfg?.model ?? DEFAULT_MODELS[provider],
    maxTokens: cfg?.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: cfg?.temperature ?? DEFAULT_TEMPERATURE,
  };
}

/**
 * Resolve retry config (falls back to `DEFAULT_RETRY`).
 */
function resolveRetry(cfg: AIEngineConfig): RetryConfig {
  return cfg.retry ?? DEFAULT_RETRY;
}

// ─────────────────────────── Sleep helper ───────────────────────────

/**
 * Promise-based sleep.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────── Provider clients (lazy) ───────────────────────────

/**
 * Holds instantiated SDK clients so we don't recreate them per request.
 */
interface Clients {
  openai?: OpenAI;
  anthropic?: Anthropic;
  gemini?: GoogleGenerativeAI;
}

// ─────────────────────────── AIEngine class ───────────────────────────

/**
 * Unified AI engine for sending chat-completion requests.
 *
 * @example
 * ```ts
 * import { AIEngine } from './ai-engine.js';
 *
 * const engine = new AIEngine({
 *   provider: 'openai',
 *   providers: { openai: { apiKey: process.env.OPENAI_API_KEY } },
 * });
 *
 * const res = await engine.chat({
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 *
 * console.log(res.content);
 * ```
 */
export class AIEngine {
  private config: AIEngineConfig;
  private clients: Clients = {};

  constructor(config: Omit<AIEngineConfig, 'retry'> & { retry?: RetryConfig }) {
    this.config = {
      ...config,
      retry: config.retry ?? DEFAULT_RETRY,
    };
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Send a chat-completion request and return normalised text.
   *
   * Handles retries, rate-limit back-off, and provider-specific formatting
   * automatically.
   *
   * @param request - The chat request.
   * @param retries - Optional retry override for this call only.
   */
  public async chat(
    request: AIRequest,
    retries?: RetryConfig
  ): Promise<AIResponse> {
    const provider = this.config.provider;
    const retryCfg = retries ?? resolveRetry(this.config);
    const providerCfg = resolveProviderConfig(
      provider,
      this.config.providers[provider]
    );

    if (!providerCfg.apiKey) {
      throw new AIError(
        provider,
        `No API key found for provider "${provider}". Set it via --api-key flag or ${provider.toUpperCase()}_API_KEY environment variable.`,
        { retryable: false }
      );
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryCfg.maxRetries; attempt++) {
      if (attempt > 0) {
        const delayMs = this.calculateBackoff(attempt - 1, retryCfg);
        // biome-ignore lint/suspicious/noConsoleLog: user-facing progress
        console.log(
          `  ⏳ Retrying (${attempt}/${retryCfg.maxRetries}) after ${delayMs} ms…`
        );
        await sleep(delayMs);
      }

      try {
        return await this.dispatch(provider, providerCfg, request);
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Non-retryable → bail immediately
        if (err instanceof AIError && !err.retryable) {
          throw err;
        }
        // If we exhausted retries, throw a mapped AIError
        if (attempt >= retryCfg.maxRetries) {
          throw new AIError(
            provider,
            `Request failed after ${retryCfg.maxRetries} retries: ${lastError.message}`,
            { cause: lastError, retryable: false }
          );
        }
      }
    }

    // Should be unreachable, but TypeScript needs it
    throw new AIError(
      provider,
      `Request failed unexpectedly: ${lastError?.message ?? 'unknown'}`,
      { cause: lastError ?? undefined }
    );
  }

  /**
   * Return the currently active provider.
   */
  public getProvider(): AIProvider {
    return this.config.provider;
  }

  /**
   * Switch the active provider at runtime.
   */
  public setProvider(provider: AIProvider): void {
    this.config.provider = provider;
  }

  /**
   * List all providers that currently have API keys configured.
   */
  public getAvailableProviders(): AIProvider[] {
    return (Object.keys(this.config.providers) as AIProvider[]).filter(
      (p) => !!this.config.providers[p]?.apiKey
    );
  }

  // ── Back-off calculation ──────────────────────────────────────

  /**
   * Exponential back-off with jitter (capped at `maxDelayMs`).
   */
  private calculateBackoff(
    attempt: number,
    cfg: RetryConfig
  ): number {
    const exponential = cfg.initialDelayMs * 2 ** attempt;
    // Add up to 25 % jitter
    const jitter = exponential * 0.25 * Math.random();
    return Math.min(exponential + jitter, cfg.maxDelayMs);
  }

  // ── Dispatch to provider-specific SDK ───────────────────────────

  private async dispatch(
    provider: AIProvider,
    cfg: ProviderConfig,
    request: AIRequest
  ): Promise<AIResponse> {
    switch (provider) {
      case 'openai':
        return this.chatOpenAI(cfg, request);
      case 'openrouter':
        return this.chatOpenRouter(cfg, request);
      case 'nvidia':
        return this.chatNvidia(cfg, request);
      case 'anthropic':
        return this.chatAnthropic(cfg, request);
      case 'gemini':
        return this.chatGemini(cfg, request);
    }
  }

  // ─── OpenAI ──────────────────────────────────────────────────

  private async chatOpenAI(
    cfg: ProviderConfig,
    request: AIRequest
  ): Promise<AIResponse> {
    const client = this.getOpenAIClient(cfg);

    const completion = await client.chat.completions.create({
      model: request.model ?? cfg.model,
      messages: request.messages as OpenAI.Chat.ChatCompletionMessageParam[],
      temperature: request.temperature ?? cfg.temperature,
      max_tokens: request.maxTokens ?? cfg.maxTokens,
    });

    const choice = completion.choices[0];
    if (!choice?.message?.content) {
      throw new AIError('openai', 'Empty response from OpenAI', {
        statusCode: completion._request_id ? 200 : undefined,
      });
    }

    return {
      content: choice.message.content,
      model: completion.model ?? cfg.model,
      usage: completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : undefined,
    };
  }

  // ─── OpenRouter (OpenAI-compatible) ──────────────────────────

  private async chatOpenRouter(
    cfg: ProviderConfig,
    request: AIRequest
  ): Promise<AIResponse> {
    const client = this.getOpenAIClient({
      ...cfg,
      baseUrl: cfg.baseUrl ?? 'https://openrouter.ai/api/v1',
    });

    const completion = await client.chat.completions.create({
      model: request.model ?? cfg.model,
      messages: request.messages as OpenAI.Chat.ChatCompletionMessageParam[],
      temperature: request.temperature ?? cfg.temperature,
      max_tokens: request.maxTokens ?? cfg.maxTokens,
    });

    const choice = completion.choices[0];
    if (!choice?.message?.content) {
      throw new AIError('openrouter', 'Empty response from OpenRouter');
    }

    return {
      content: choice.message.content,
      model: completion.model ?? cfg.model,
      usage: completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : undefined,
    };
  }

  // ─── NVIDIA (OpenAI-compatible) ──────────────────────────────

  private async chatNvidia(
    cfg: ProviderConfig,
    request: AIRequest
  ): Promise<AIResponse> {
    const client = this.getOpenAIClient({
      ...cfg,
      baseUrl: cfg.baseUrl ?? 'https://integrate.api.nvidia.com/v1',
    });

    const completion = await client.chat.completions.create({
      model: request.model ?? cfg.model,
      messages: request.messages as OpenAI.Chat.ChatCompletionMessageParam[],
      temperature: request.temperature ?? cfg.temperature,
      max_tokens: request.maxTokens ?? cfg.maxTokens,
    });

    const choice = completion.choices[0];
    if (!choice?.message?.content) {
      throw new AIError('nvidia', 'Empty response from NVIDIA');
    }

    return {
      content: choice.message.content,
      model: completion.model ?? cfg.model,
      usage: completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : undefined,
    };
  }

  // ─── Anthropic ───────────────────────────────────────────────

  private async chatAnthropic(
    cfg: ProviderConfig,
    request: AIRequest
  ): Promise<AIResponse> {
    const client = this.getAnthropicClient(cfg);

    // Anthropic requires a `max_tokens` at the top level and does not accept
    // a `system` role in the messages array — we extract it separately.
    const systemMsg = request.messages.find((m) => m.role === 'system');
    const nonSystemMsgs = request.messages.filter((m) => m.role !== 'system');

    if (nonSystemMsgs.length === 0) {
      throw new AIError(
        'anthropic',
        'Anthropic requires at least one user message.',
        { retryable: false }
      );
    }

    const response = await client.messages.create({
      model: request.model ?? cfg.model,
      max_tokens: request.maxTokens ?? cfg.maxTokens,
      temperature: request.temperature ?? cfg.temperature,
      system: systemMsg?.content,
      messages: nonSystemMsgs as Anthropic.MessageParam[],
    });

    // Extract text from content blocks
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n');

    if (!text) {
      throw new AIError('anthropic', 'Empty response from Anthropic');
    }

    return {
      content: text,
      model: response.model ?? cfg.model,
      usage: response.usage
        ? {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            totalTokens:
              response.usage.input_tokens + response.usage.output_tokens,
          }
        : undefined,
    };
  }

  // ─── Gemini ──────────────────────────────────────────────────

  private async chatGemini(
    cfg: ProviderConfig,
    request: AIRequest
  ): Promise<AIResponse> {
    const client = this.getGeminiClient(cfg);

    const model = client.getGenerativeModel({
      model: request.model ?? cfg.model,
      generationConfig: {
        temperature: request.temperature ?? cfg.temperature,
        maxOutputTokens: request.maxTokens ?? cfg.maxTokens,
      },
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    });

    // Gemini: system prompt is prepended to the first user message.
    const systemMsg = request.messages.find((m) => m.role === 'system');
    const userMsgs = request.messages.filter((m) => m.role === 'user');
    const assistantMsgs = request.messages.filter(
      (m) => m.role === 'assistant'
    );

    if (userMsgs.length === 0) {
      throw new AIError('gemini', 'Gemini requires at least one user message.', {
        retryable: false,
      });
    }

    // Build chat history
    const chat = model.startChat({
      history: assistantMsgs.map((m) => ({
        role: 'model' as const,
        parts: [{ text: m.content }],
      })),
    });

    const prompt = systemMsg
      ? `${systemMsg.content}\n\n${userMsgs[userMsgs.length - 1].content}`
      : userMsgs[userMsgs.length - 1].content;

    const result = await chat.sendMessage(prompt);
    const text = result.response.text();

    if (!text) {
      throw new AIError('gemini', 'Empty response from Gemini');
    }

    return {
      content: text,
      model: request.model ?? cfg.model,
      usage: result.response.usageMetadata
        ? {
            promptTokens: result.response.usageMetadata.promptTokenCount,
            completionTokens: result.response.usageMetadata.candidatesTokenCount,
            totalTokens:
              result.response.usageMetadata.promptTokenCount +
              result.response.usageMetadata.candidatesTokenCount,
          }
        : undefined,
    };
  }

  // ── Lazy client factories ──────────────────────────────────────

  private getOpenAIClient(cfg: ProviderConfig): OpenAI {
    if (!this.clients.openai) {
      this.clients.openai = new OpenAI({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseUrl,
      });
    }
    // If baseUrl changed, recreate
    if (cfg.baseUrl && this.clients.openai.baseURL !== cfg.baseUrl) {
      this.clients.openai = new OpenAI({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseUrl,
      });
    }
    return this.clients.openai;
  }

  private getAnthropicClient(cfg: ProviderConfig): Anthropic {
    if (!this.clients.anthropic) {
      this.clients.anthropic = new Anthropic({
        apiKey: cfg.apiKey,
      });
    }
    return this.clients.anthropic;
  }

  private getGeminiClient(cfg: ProviderConfig): GoogleGenerativeAI {
    if (!this.clients.gemini) {
      this.clients.gemini = new GoogleGenerativeAI(cfg.apiKey);
    }
    return this.clients.gemini;
  }
}
