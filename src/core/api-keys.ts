/**
 * API Key Manager — resolves API keys from multiple sources.
 *
 * Resolution order (highest precedence first):
 *   1. Explicit CLI flag value (passed via `--api-key` or `--provider-api-key`)
 *   2. Provider-specific environment variable (e.g. `OPENAI_API_KEY`)
 *   3. Generic environment variable (`AI_API_KEY`)
 *   4. `.env` file (loaded via `dotenv` on first call)
 *
 * @module core/api-keys
 */

import dotenv from 'dotenv';
import { AIProvider } from './ai-types.js';

// ─────────────────────────── Env-var map ───────────────────────────

/**
 * Maps each provider to its conventional environment-variable name.
 */
const PROVIDER_ENV_VAR: Readonly<Record<AIProvider, string>> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
};

/**
 * Tracks whether `.env` has been loaded (singleton guard).
 */
let envLoaded = false;

/**
 * Lazily loads `.env` from the current working directory.
 * Safe to call multiple times — only loads once.
 */
function ensureEnvLoaded(): void {
  if (envLoaded) return;
  dotenv.config();
  envLoaded = true;
}

// ─────────────────────────── Public API ───────────────────────────

/**
 * Resolve an API key for a given provider.
 *
 * @param provider     - The AI provider to resolve a key for.
 * @param cliKey       - Optional key passed directly via CLI flag.
 * @returns            - The resolved API key, or `undefined` if none found.
 *
 * @example
 * ```ts
 * const key = resolveApiKey('openai', process.env.OPENAI_API_KEY);
 * ```
 */
export function resolveApiKey(
  provider: AIProvider,
  cliKey?: string
): string | undefined {
  // 1. CLI flag (highest priority)
  if (cliKey && cliKey.trim().length > 0) {
    return cliKey.trim();
  }

  ensureEnvLoaded();

  // 2. Provider-specific env variable
  const providerEnv = PROVIDER_ENV_VAR[provider];
  const providerKey = process.env[providerEnv];
  if (providerKey && providerKey.trim().length > 0) {
    return providerKey.trim();
  }

  // 3. Generic AI_API_KEY fallback
  const genericKey = process.env.AI_API_KEY;
  if (genericKey && genericKey.trim().length > 0) {
    return genericKey.trim();
  }

  // 4. Nothing found
  return undefined;
}

/**
 * Resolve API keys for **all** providers at once.
 *
 * Useful for displaying which providers are currently configured.
 *
 * @returns Record of provider → key-present boolean.
 */
export function resolveAllApiKeys(): Record<AIProvider, boolean> {
  ensureEnvLoaded();

  const result = {} as Record<AIProvider, boolean>;

  for (const provider of Object.keys(PROVIDER_ENV_VAR) as AIProvider[]) {
    const key = resolveApiKey(provider);
    result[provider] = key !== undefined;
  }

  return result;
}

/**
 * Return the conventional env-var name for a provider.
 */
export function getProviderEnvVar(provider: AIProvider): string {
  return PROVIDER_ENV_VAR[provider];
}
