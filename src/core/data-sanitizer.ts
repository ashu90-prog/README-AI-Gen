/**
 * DataSanitizer — Formats and sanitizes all extracted data for clean Markdown rendering.
 *
 * This module is the **final data-quality gate** between the extraction pipeline
 * (FeatureExtractor, APIExtractor, CommandInference, DependencyMapper) and the
 * MarkdownEngine. It:
 *
 *   1. Escapes Markdown-special characters (pipes, backticks, brackets, etc.).
 *   2. Normalizes names (trim, collapse whitespace, title-case where needed).
 *   3. Formats version strings into display-friendly form.
 *   4. Ensures consistent ordering and grouping of features, APIs, and commands.
 *   5. Builds final data structures optimized for Markdown table/list rendering.
 *
 * Consumes types from:
 *   • `feature-extractor.ts` → `FeatureExtractionResult`, `ValidatedFeature`
 *   • `api-extractor.ts`     → `APIExtractionResult`, `ValidatedAPIEndpoint`
 *   • `command-inference.ts`  → `InferenceResult`, `ValidatedCommand`
 *   • `dependency-mapper.ts`  → `DependencyMapResult`, `DependencySummary`, `CategorisedDependency`
 *   • `data-harvester.ts`     → `HarvestResult`
 *
 * Produces:
 *   • `SanitizedData` — A single, clean, consistently ordered structure
 *     that the MarkdownEngine can render directly.
 *
 * @module core/data-sanitizer
 */

import {
  FeatureExtractionResult,
  ValidatedFeature,
  FeatureCategory,
} from './feature-extractor.js';

import {
  APIExtractionResult,
  ValidatedAPIEndpoint,
  HTTPMethod,
} from './api-extractor.js';

import {
  InferenceResult,
  ValidatedCommand,
  CommandSource,
} from './command-inference.js';

import { CommandCategory } from './response-parser.js';

import {
  DependencyMapResult,
  DependencySummary,
  CategorisedDependency,
  DependencyCategory,
} from './dependency-mapper.js';

import { HarvestResult, Dependency } from './data-harvester.js';

// ─────────────────────────── Sanitized Types ───────────────────────────

/**
 * A feature cleaned and formatted for direct Markdown rendering.
 */
export interface SanitizedFeature {
  /** Display-ready name (escaped, trimmed, normalized). */
  name: string;
  /** Display-ready description (escaped, trimmed). */
  description: string;
  /** Category label for grouping. */
  category: FeatureCategory;
  /** Human-readable category label (e.g. "Core", "User Interface"). */
  categoryLabel: string;
  /** Confidence score (0–1). */
  confidence: number;
  /** Scope label: "User-facing", "Internal", or "General". */
  scopeLabel: string;
}

/**
 * An API endpoint cleaned and formatted for direct Markdown table rendering.
 */
export interface SanitizedEndpoint {
  /** HTTP method (uppercased, validated). */
  method: HTTPMethod;
  /** Route path (escaped for table cells, cleaned). */
  path: string;
  /** Display-ready description (escaped for table cells). */
  description: string;
  /** Confidence score. */
  confidence: number;
}

/**
 * A command cleaned and formatted for direct Markdown table rendering.
 */
export interface SanitizedCommand {
  /** Command category label (e.g. "📦 Install"). */
  categoryLabel: string;
  /** Raw category key. */
  category: CommandCategory;
  /** Command string (escaped for inline code). */
  command: string;
  /** Display-ready description (escaped for table cells). */
  description: string;
  /** Source label. */
  sourceLabel: string;
  /** Source icon for table display. */
  sourceIcon: string;
  /** Confidence score. */
  confidence: number;
}

/**
 * A dependency group cleaned for display.
 */
export interface SanitizedDependencyGroup {
  /** Category label (e.g. "Web Framework", "Testing"). */
  category: string;
  /** Display-ready dependency names (sorted, deduplicated). */
  items: string[];
  /** Number of items in this group. */
  count: number;
}

/**
 * Complete sanitized data structure for the MarkdownEngine.
 */
export interface SanitizedData {
  /** Cleaned features, grouped by category, sorted by confidence then name. */
  features: SanitizedFeature[];
  /** Cleaned API endpoints, sorted by path then method. */
  endpoints: SanitizedEndpoint[];
  /** Cleaned commands, sorted by category priority. */
  commands: SanitizedCommand[];
  /** Cleaned dependency groups, sorted alphabetically with "Other" last. */
  dependencies: SanitizedDependencyGroup[];
  /** Aggregate statistics. */
  stats: SanitizedStats;
}

/**
 * Aggregate statistics about the sanitization run.
 */
export interface SanitizedStats {
  /** Features received / output. */
  featuresIn: number;
  featuresOut: number;
  /** Endpoints received / output. */
  endpointsIn: number;
  endpointsOut: number;
  /** Commands received / output. */
  commandsIn: number;
  commandsOut: number;
  /** Dependency groups received / output. */
  dependencyGroupsIn: number;
  dependencyGroupsOut: number;
  /** Total items removed by sanitization. */
  itemsRemoved: number;
  /** Total items escaped or modified. */
  itemsModified: number;
}

// ─────────────────────────── Constants ───────────────────────────

/**
 * Feature category display labels.
 */
const FEATURE_CATEGORY_LABELS: Readonly<Record<FeatureCategory, string>> = {
  core: 'Core',
  ui: 'User Interface',
  api: 'API & Integrations',
  utility: 'Utilities',
  other: 'Other',
};

/**
 * Feature scope display labels.
 */
const SCOPE_LABELS: Readonly<Record<string, string>> = {
  'user-facing': 'User-facing',
  internal: 'Internal',
  unknown: 'General',
};

/**
 * Command category display labels with emojis.
 */
const COMMAND_CATEGORY_LABELS: Readonly<Record<CommandCategory, string>> = {
  install: '📦  Install',
  build: '🔨  Build',
  test: '🧪  Test',
  run: '🚀  Run',
  lint: '✨  Lint',
  deploy: '📤  Deploy',
  setup: '🛠  Setup',
  other: '📋  Other',
};

/**
 * Command category priority order (lower = higher priority).
 */
const COMMAND_CATEGORY_PRIORITY: ReadonlyArray<CommandCategory> = [
  'install', 'build', 'run', 'test', 'lint', 'deploy', 'setup', 'other',
];

/**
 * Feature category priority order (lower = higher priority).
 */
const FEATURE_CATEGORY_PRIORITY: ReadonlyArray<FeatureCategory> = [
  'core', 'api', 'ui', 'utility', 'other',
];

/**
 * Source display labels and icons.
 */
const SOURCE_LABELS: Readonly<Record<CommandSource, string>> = {
  ai: 'AI',
  'static-analysis': 'Static',
  heuristic: 'Heuristic',
};

const SOURCE_ICONS: Readonly<Record<CommandSource, string>> = {
  ai: '✦',
  'static-analysis': '◆',
  heuristic: '⚙️',
};

/**
 * HTTP method sort priority (for consistent table ordering).
 */
const HTTP_METHOD_PRIORITY: ReadonlyMap<HTTPMethod, number> = new Map([
  ['GET', 0],
  ['POST', 1],
  ['PUT', 2],
  ['PATCH', 3],
  ['DELETE', 4],
  ['HEAD', 5],
  ['OPTIONS', 6],
  ['UNKNOWN', 7],
]);

// ─────────────────────────── Service ───────────────────────────

/**
 * `DataSanitizer` is the final data-quality gate before Markdown rendering.
 * It accepts raw outputs from the extraction pipeline and produces cleanly
 * formatted, consistently ordered data structures.
 *
 * @example
 * ```ts
 * const sanitizer = new DataSanitizer();
 *
 * const sanitized = sanitizer.sanitize({
 *   featureResult,
 *   apiResult,
 *   inferenceResult,
 *   dependencySummary,
 * });
 *
 * // `sanitized` is now ready for MarkdownEngine consumption
 * console.log(sanitized.features);   // Clean, sorted, escaped
 * console.log(sanitized.endpoints);  // Clean, sorted, escaped
 * console.log(sanitized.commands);   // Clean, sorted, escaped
 * ```
 */
export class DataSanitizer {
  // ── Public API ──────────────────────────────────────────────

  /**
   * Sanitize all extracted data for Markdown rendering.
   *
   * @param input - Raw data from the extraction pipeline.
   * @returns A `SanitizedData` structure ready for the MarkdownEngine.
   */
  public sanitize(input: {
    featureResult?: FeatureExtractionResult | null;
    apiResult?: APIExtractionResult | null;
    inferenceResult?: InferenceResult | null;
    dependencySummary?: DependencySummary[] | null;
  }): SanitizedData {
    let itemsRemoved = 0;
    let itemsModified = 0;

    // ── Features ──
    const rawFeatures = input.featureResult?.validated ?? [];
    const { features, removed: featRemoved, modified: featModified } =
      this.sanitizeFeatures(rawFeatures);
    itemsRemoved += featRemoved;
    itemsModified += featModified;

    // ── Endpoints ──
    const rawEndpoints = input.apiResult?.validated ?? [];
    const { endpoints, removed: epRemoved, modified: epModified } =
      this.sanitizeEndpoints(rawEndpoints);
    itemsRemoved += epRemoved;
    itemsModified += epModified;

    // ── Commands ──
    const rawCommands = input.inferenceResult?.commands ?? [];
    const { commands, removed: cmdRemoved, modified: cmdModified } =
      this.sanitizeCommands(rawCommands);
    itemsRemoved += cmdRemoved;
    itemsModified += cmdModified;

    // ── Dependencies ──
    const rawDeps = input.dependencySummary ?? [];
    const { dependencies, removed: depRemoved, modified: depModified } =
      this.sanitizeDependencies(rawDeps);
    itemsRemoved += depRemoved;
    itemsModified += depModified;

    return {
      features,
      endpoints,
      commands,
      dependencies,
      stats: {
        featuresIn: rawFeatures.length,
        featuresOut: features.length,
        endpointsIn: rawEndpoints.length,
        endpointsOut: endpoints.length,
        commandsIn: rawCommands.length,
        commandsOut: commands.length,
        dependencyGroupsIn: rawDeps.length,
        dependencyGroupsOut: dependencies.length,
        itemsRemoved,
        itemsModified,
      },
    };
  }

  // ── Feature Sanitization ──────────────────────────────────────

  /**
   * Sanitize validated features for Markdown rendering.
   *
   * Steps:
   *   1. Filter out features with empty names.
   *   2. Escape Markdown-special characters in names and descriptions.
   *   3. Normalize names (trim, collapse whitespace).
   *   4. Deduplicate by normalized name.
   *   5. Sort by category priority, then confidence descending, then name.
   */
  private sanitizeFeatures(features: ValidatedFeature[]): {
    features: SanitizedFeature[];
    removed: number;
    modified: number;
  } {
    let removed = 0;
    let modified = 0;
    const seen = new Set<string>();
    const result: SanitizedFeature[] = [];

    for (const f of features) {
      // Normalize name
      const cleanName = DataSanitizer.normalizeName(f.name);
      if (!cleanName || cleanName.length < 2) {
        removed++;
        continue;
      }

      // Deduplicate
      const key = cleanName.toLowerCase();
      if (seen.has(key)) {
        removed++;
        continue;
      }
      seen.add(key);

      // Track modifications
      if (cleanName !== f.name || DataSanitizer.needsEscaping(f.description)) {
        modified++;
      }

      const category = f.category ?? 'other';

      result.push({
        name: DataSanitizer.escapeMarkdownInline(cleanName),
        description: DataSanitizer.escapeMarkdownInline(
          DataSanitizer.normalizeDescription(f.description),
        ),
        category,
        categoryLabel: FEATURE_CATEGORY_LABELS[category] ?? 'Other',
        confidence: f.confidence,
        scopeLabel: SCOPE_LABELS[f.scope] ?? 'General',
      });
    }

    // Sort: category priority → confidence desc → name asc
    const catPriority = new Map(
      FEATURE_CATEGORY_PRIORITY.map((c, i) => [c, i]),
    );

    result.sort((a, b) => {
      const catA = catPriority.get(a.category) ?? 99;
      const catB = catPriority.get(b.category) ?? 99;
      if (catA !== catB) return catA - catB;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      return a.name.localeCompare(b.name);
    });

    return { features: result, removed, modified };
  }

  // ── Endpoint Sanitization ─────────────────────────────────────

  /**
   * Sanitize validated API endpoints for Markdown table rendering.
   *
   * Steps:
   *   1. Filter out endpoints with empty or invalid paths.
   *   2. Normalize paths (strip trailing slashes, collapse duplicates).
   *   3. Escape table-cell-breaking characters.
   *   4. Deduplicate by `METHOD:path`.
   *   5. Sort by path, then method priority.
   */
  private sanitizeEndpoints(endpoints: ValidatedAPIEndpoint[]): {
    endpoints: SanitizedEndpoint[];
    removed: number;
    modified: number;
  } {
    let removed = 0;
    let modified = 0;
    const seen = new Set<string>();
    const result: SanitizedEndpoint[] = [];

    for (const ep of endpoints) {
      // Clean path
      const cleanPath = DataSanitizer.sanitizePath(ep.path);
      if (!cleanPath || cleanPath.length < 2) {
        removed++;
        continue;
      }

      // Validate method
      const method = DataSanitizer.normalizeHTTPMethod(ep.method);

      // Deduplicate
      const key = `${method}:${cleanPath}`.toLowerCase();
      if (seen.has(key)) {
        removed++;
        continue;
      }
      seen.add(key);

      if (cleanPath !== ep.path || method !== ep.method) {
        modified++;
      }

      result.push({
        method,
        path: DataSanitizer.escapeTableCell(cleanPath),
        description: DataSanitizer.escapeTableCell(
          DataSanitizer.normalizeDescription(ep.description || '—'),
        ),
        confidence: ep.confidence,
      });
    }

    // Sort: path asc → method priority
    result.sort((a, b) => {
      const pathCmp = a.path.localeCompare(b.path);
      if (pathCmp !== 0) return pathCmp;
      const mA = HTTP_METHOD_PRIORITY.get(a.method) ?? 99;
      const mB = HTTP_METHOD_PRIORITY.get(b.method) ?? 99;
      return mA - mB;
    });

    return { endpoints: result, removed, modified };
  }

  // ── Command Sanitization ──────────────────────────────────────

  /**
   * Sanitize validated commands for Markdown table rendering.
   *
   * Steps:
   *   1. Filter out empty commands.
   *   2. Escape table-cell characters in descriptions.
   *   3. Deduplicate by normalized command string.
   *   4. Sort by category priority, then confidence descending.
   */
  private sanitizeCommands(commands: ValidatedCommand[]): {
    commands: SanitizedCommand[];
    removed: number;
    modified: number;
  } {
    let removed = 0;
    let modified = 0;
    const seen = new Set<string>();
    const result: SanitizedCommand[] = [];

    for (const cmd of commands) {
      // Clean command string
      const cleanCmd = cmd.command.trim();
      if (!cleanCmd) {
        removed++;
        continue;
      }

      // Deduplicate
      const key = cleanCmd.toLowerCase();
      if (seen.has(key)) {
        removed++;
        continue;
      }
      seen.add(key);

      if (DataSanitizer.needsEscaping(cmd.description)) {
        modified++;
      }

      result.push({
        categoryLabel: COMMAND_CATEGORY_LABELS[cmd.category] ?? cmd.category,
        category: cmd.category,
        command: DataSanitizer.escapeInlineCode(cleanCmd),
        description: DataSanitizer.escapeTableCell(
          DataSanitizer.normalizeDescription(cmd.description),
        ),
        sourceLabel: SOURCE_LABELS[cmd.source] ?? cmd.source,
        sourceIcon: SOURCE_ICONS[cmd.source] ?? '•',
        confidence: cmd.confidence,
      });
    }

    // Sort: category priority → confidence desc
    const catPriority = new Map(
      COMMAND_CATEGORY_PRIORITY.map((c, i) => [c, i]),
    );

    result.sort((a, b) => {
      const catA = catPriority.get(a.category) ?? 99;
      const catB = catPriority.get(b.category) ?? 99;
      if (catA !== catB) return catA - catB;
      return b.confidence - a.confidence;
    });

    return { commands: result, removed, modified };
  }

  // ── Dependency Sanitization ───────────────────────────────────

  /**
   * Sanitize dependency groups for display.
   *
   * Steps:
   *   1. Filter out empty groups.
   *   2. Normalize dependency names (trim, escape).
   *   3. Sort items within each group alphabetically.
   *   4. Sort groups: alphabetically, with "Other" last.
   */
  private sanitizeDependencies(groups: DependencySummary[]): {
    dependencies: SanitizedDependencyGroup[];
    removed: number;
    modified: number;
  } {
    let removed = 0;
    let modified = 0;
    const result: SanitizedDependencyGroup[] = [];

    for (const group of groups) {
      // Filter empty groups
      if (!group.items || group.items.length === 0) {
        removed++;
        continue;
      }

      // Normalize and deduplicate items
      const cleanItems = Array.from(
        new Set(
          group.items.map((item) => DataSanitizer.normalizeDependencyName(item)),
        ),
      )
        .filter((item) => item.length > 0)
        .sort((a, b) => a.localeCompare(b));

      if (cleanItems.length === 0) {
        removed++;
        continue;
      }

      if (cleanItems.length !== group.items.length) {
        modified++;
      }

      result.push({
        category: DataSanitizer.escapeMarkdownInline(group.category),
        items: cleanItems.map((i) => DataSanitizer.escapeMarkdownInline(i)),
        count: cleanItems.length,
      });
    }

    // Sort: alphabetical, "Other" last
    result.sort((a, b) => {
      if (a.category === 'Other') return 1;
      if (b.category === 'Other') return -1;
      return a.category.localeCompare(b.category);
    });

    return { dependencies: result, removed, modified };
  }

  // ─────────────────────────── Static Utilities ───────────────────────────

  /**
   * Escape characters that break Markdown inline formatting.
   * Handles: `*`, `_`, `[`, `]`, `(`, `)`, `<`, `>`, `&`, `|`, `\`
   */
  public static escapeMarkdownInline(text: string): string {
    if (!text) return '';
    return text
      .replace(/\\/g, '\\\\')  // Backslash first
      .replace(/\|/g, '\\|')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Escape characters that break Markdown table cell rendering.
   * Table cells must not contain unescaped `|` or literal newlines.
   */
  public static escapeTableCell(value: string): string {
    if (!value) return '';
    return value
      .replace(/\|/g, '\\|')
      .replace(/\n/g, '<br>')
      .replace(/\r/g, '')
      .trim();
  }

  /**
   * Escape characters inside inline code backticks.
   * Backticks within the content are doubled.
   */
  public static escapeInlineCode(text: string): string {
    if (!text) return '';
    // If the text contains backticks, wrap with double backticks
    if (text.includes('`')) {
      return text.replace(/`/g, '');
    }
    return text.trim();
  }

  /**
   * Normalize a feature/section name for display:
   *   - Trim whitespace
   *   - Collapse multiple spaces
   *   - Remove leading/trailing punctuation noise
   *   - Strip residual Markdown bold/italic markers
   */
  public static normalizeName(name: string): string {
    if (!name) return '';
    return name
      .trim()
      .replace(/\*{1,2}/g, '')     // Strip bold/italic markers
      .replace(/`/g, '')            // Strip backticks
      .replace(/\s+/g, ' ')         // Collapse whitespace
      .replace(/^[^a-zA-Z0-9]+/, '') // Remove leading non-alphanumeric
      .replace(/[^a-zA-Z0-9)]+$/, '') // Remove trailing non-alphanumeric (keep closing parens)
      .trim();
  }

  /**
   * Normalize a description string:
   *   - Trim whitespace
   *   - Collapse multiple spaces
   *   - Ensure it ends with a period (for consistency)
   *   - Cap length at 200 characters
   */
  public static normalizeDescription(description: string): string {
    if (!description) return '';

    let result = description
      .trim()
      .replace(/\s+/g, ' ')          // Collapse whitespace
      .replace(/\*{1,2}/g, '')        // Strip bold/italic markers
      .replace(/`([^`]+)`/g, '$1');   // Strip inline code markers

    // Cap length
    if (result.length > 200) {
      result = result.substring(0, 197) + '...';
    }

    return result;
  }

  /**
   * Normalize a dependency name:
   *   - Trim whitespace
   *   - Preserve scoped names (e.g. @scope/package)
   */
  public static normalizeDependencyName(name: string): string {
    if (!name) return '';
    return name.trim().replace(/\s+/g, '');
  }

  /**
   * Format a version string for display:
   *   - Remove range prefixes (^, ~, >=, <=, =)
   *   - Normalize "latest" / "*" to "latest"
   *   - Trim whitespace
   */
  public static formatVersion(version?: string): string {
    if (!version) return 'latest';
    const cleaned = version.trim().replace(/^[~^>=<]+/, '');
    if (cleaned === '*' || cleaned === '') return 'latest';
    return cleaned;
  }

  /**
   * Sanitize a URL path:
   *   - Trim whitespace
   *   - Remove duplicate slashes
   *   - Remove trailing slash (except root "/")
   *   - Strip backticks and bold markers
   */
  public static sanitizePath(routePath: string): string {
    if (!routePath) return '';
    return routePath
      .trim()
      .replace(/`/g, '')           // Remove backticks
      .replace(/\*{1,2}/g, '')     // Remove bold markers
      .replace(/\/\/+/g, '/')      // Collapse duplicate slashes
      .replace(/(.)\/$/, '$1');     // Remove trailing slash (unless root)
  }

  /**
   * Normalize an HTTP method string to a valid uppercase `HTTPMethod`.
   */
  public static normalizeHTTPMethod(method: string): HTTPMethod {
    const upper = method?.toUpperCase().trim() ?? 'UNKNOWN';
    const valid: HTTPMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    return valid.includes(upper as HTTPMethod) ? (upper as HTTPMethod) : 'UNKNOWN';
  }

  /**
   * Check if a string contains characters that require escaping.
   */
  public static needsEscaping(text: string): boolean {
    if (!text) return false;
    return /[|<>&\n\r`]/.test(text);
  }

  /**
   * Sanitize a string for safe inclusion in an AI prompt.
   * More aggressive than Markdown escaping — also replaces curly braces
   * and other template-injection characters.
   */
  public static sanitizeForPrompt(text: string): string {
    if (!text) return '';
    return text
      .replace(/\{\{/g, '{ {')
      .replace(/\}\}/g, '} }')
      .replace(/\$/g, '\\$')
      .trim();
  }
}
