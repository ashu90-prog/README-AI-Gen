/**
 * AI Engine types — shared interfaces for all AI providers.
 *
 * @module core/ai-types
 */

// ─────────────────────────── Provider IDs ───────────────────────────

/**
 * Supported AI providers.
 */
export type AIProvider = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'nvidia';

// ─────────────────────────── Configuration ───────────────────────────

/**
 * Per-provider configuration.
 */
export interface ProviderConfig {
  /** API key (resolved from env or CLI flag). */
  apiKey: string;
  /** Optional custom base URL (for proxies / OpenRouter / NVIDIA). */
  baseUrl?: string;
  /** Model identifier, e.g. "gpt-4o", "claude-sonnet-4-20250514". */
  model: string;
  /** Maximum tokens to generate. */
  maxTokens: number;
  /** Temperature (0-2). */
  temperature: number;
}

/**
 * Global AI engine configuration.
 */
export interface AIEngineConfig {
  /** Active provider. */
  provider: AIProvider;
  /** Per-provider settings. */
  providers: Partial<Record<AIProvider, Omit<ProviderConfig, 'apiKey'> & { apiKey?: string }>>;
  /** Retry settings. */
  retry: RetryConfig;
}

// ─────────────────────────── Retry / Rate-limit ───────────────────────────

/**
 * Retry configuration for failed AI requests.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts. */
  maxRetries: number;
  /** Initial back-off in milliseconds. */
  initialDelayMs: number;
  /** Maximum back-off in milliseconds (cap). */
  maxDelayMs: number;
}

/** Default: 3 retries, 1 s initial, 30 s cap. */
export const DEFAULT_RETRY: Readonly<RetryConfig> = Object.freeze({
  maxRetries: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
});

// ─────────────────────────── Request / Response ───────────────────────────

/**
 * A single chat message.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Normalised request sent *to* the AI engine.
 */
export interface AIRequest {
  messages: ChatMessage[];
  /** Override model for this request only. */
  model?: string;
  /** Override temperature for this request only. */
  temperature?: number;
  /** Override max tokens for this request only. */
  maxTokens?: number;
}

/**
 * Normalised response received *from* the AI engine.
 */
export interface AIResponse {
  /** Generated text content. */
  content: string;
  /** Model that produced the output. */
  model: string;
  /** Approximate token usage (if available). */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ─────────────────────────── Errors ───────────────────────────

/**
 * Custom error class that carries provider context.
 */
export class AIError extends Error {
  /** The provider that raised the error. */
  public readonly provider: AIProvider;
  /** HTTP status code (if applicable). */
  public readonly statusCode?: number;
  /** Whether retrying is likely to help. */
  public readonly retryable: boolean;

  constructor(
    provider: AIProvider,
    message: string,
    options?: { statusCode?: number; retryable?: boolean; cause?: Error }
  ) {
    super(message, { cause: options?.cause });
    this.name = 'AIError';
    this.provider = provider;
    this.statusCode = options?.statusCode;
    this.retryable = options?.retryable ?? true;
  }
}
