/**
 * FeatureExtractor — Extracts, processes, and validates AI-identified features.
 *
 * This module bridges AI output and the codebase truth layer. It:
 *
 *   1. Parses raw AI text into structured `ExtractedFeature` objects.
 *   2. Cross-references each feature against actual code elements, file paths,
 *      and dependency names via `FeatureValidator`.
 *   3. Produces a `FeatureExtractionResult` with validated, unverified, and
 *      rejected features — each annotated with confidence and evidence.
 *
 * Consumes types from:
 *   • `codebase-mapper.ts` → `CodebaseMap`, `Feature`, `CodeElement`
 *   • `data-harvester.ts`  → `HarvestResult`
 *   • `tech-mapper.ts`     → `TechReport`
 *
 * @module core/feature-extractor
 */

import path from 'path';
import { CodebaseMap, Feature, CodeElement, APIEndpoint } from './codebase-mapper.js';
import { HarvestResult } from './data-harvester.js';
import { TechReport } from './tech-mapper.js';

// ─────────────────────────── Types ───────────────────────────

/**
 * A feature extracted from AI output, before validation.
 */
export interface ExtractedFeature {
  /** Feature name (as identified by the AI). */
  name: string;
  /** AI-generated description of the feature. */
  description: string;
  /** Whether the AI labelled this as user-facing or internal. */
  scope: FeatureScope;
  /** Optional category assigned by the AI or inferred. */
  category?: FeatureCategory;
  /** Raw text the feature was parsed from. */
  rawText?: string;
}

/**
 * Feature scope — user-facing vs. internal.
 */
export type FeatureScope = 'user-facing' | 'internal' | 'unknown';

/**
 * Feature category — mirrors `Feature['category']` from codebase-mapper.
 */
export type FeatureCategory = 'core' | 'ui' | 'api' | 'utility' | 'other';

/**
 * Evidence that a feature exists in the codebase.
 */
export interface FeatureEvidence {
  /** Type of evidence. */
  type: EvidenceType;
  /** Detail string (e.g. file path, element name, dependency name). */
  detail: string;
  /** Confidence contribution (0–1). */
  weight: number;
}

/**
 * Type of evidence used for validation.
 */
export type EvidenceType =
  | 'code-element'     // A matching function, class, interface, etc.
  | 'file-path'        // A file whose name/path matches the feature
  | 'dependency'       // A dependency related to the feature
  | 'codebase-feature' // A pre-detected feature from CodebaseMapper
  | 'api-endpoint';    // An API endpoint related to the feature

/**
 * Validation status for a single feature.
 */
export type FeatureStatus = 'validated' | 'unverified' | 'rejected';

/**
 * A fully validated (or rejected) feature, enriched with evidence.
 */
export interface ValidatedFeature extends ExtractedFeature {
  /** Validation outcome. */
  status: FeatureStatus;
  /** Overall confidence score (0–1). */
  confidence: number;
  /** Evidence items supporting (or contradicting) this feature. */
  evidence: FeatureEvidence[];
  /** Human-readable reason for rejection, if applicable. */
  rejectionReason?: string;
}

/**
 * Complete result of the feature extraction and validation pipeline.
 */
export interface FeatureExtractionResult {
  /** All validated features (status = 'validated'). */
  validated: ValidatedFeature[];
  /** Features that could not be confirmed but are plausible. */
  unverified: ValidatedFeature[];
  /** Features rejected as likely hallucinations or errors. */
  rejected: ValidatedFeature[];
  /** Aggregate statistics. */
  stats: FeatureExtractionStats;
}

/**
 * Aggregate statistics about the extraction run.
 */
export interface FeatureExtractionStats {
  /** Total features parsed from AI output. */
  totalParsed: number;
  /** Number of features validated. */
  validatedCount: number;
  /** Number left unverified. */
  unverifiedCount: number;
  /** Number rejected. */
  rejectedCount: number;
  /** Average confidence of validated features. */
  averageConfidence: number;
}

// ─────────────────── Keyword → Category Heuristics ──────────────────

/**
 * Maps keywords to feature categories for heuristic classification.
 * Evaluated in order — first match wins.
 */
const CATEGORY_KEYWORDS: ReadonlyArray<readonly [RegExp, FeatureCategory]> = [
  [/\b(auth|login|logout|register|signup|signin|password|jwt|token|session|oauth|sso)\b/i, 'core'],
  [/\b(database|db|orm|model|schema|migration|query|repository|dao|sql|mongodb|postgres|redis)\b/i, 'core'],
  [/\b(cache|caching|memcached|redis|in-memory)\b/i, 'core'],
  [/\b(validate|validation|sanitize|sanitise|check|verify)\b/i, 'core'],
  [/\b(encrypt|decrypt|hash|security|rbac|acl|permission|role)\b/i, 'core'],
  [/\b(api|rest|graphql|endpoint|route|controller|handler|middleware|grpc|websocket)\b/i, 'api'],
  [/\b(component|view|page|screen|template|render|ui|ux|widget|modal|dialog|form)\b/i, 'ui'],
  [/\b(util|helper|tool|lib|common|shared|logger|logging|config|configuration|env)\b/i, 'utility'],
];

/**
 * Keywords that strongly indicate a feature scope.
 */
const SCOPE_KEYWORDS: ReadonlyArray<readonly [RegExp, FeatureScope]> = [
  [/\b(user[- ]facing|public|external|frontend|client[- ]side|ui|ux|dashboard|portal)\b/i, 'user-facing'],
  [/\b(internal|backend|server[- ]side|private|infrastructure|core|engine|service)\b/i, 'internal'],
];

// ─────────────────── Feature Hallucination Signals ──────────────────

/**
 * Feature names/descriptions that AI models frequently hallucinate.
 * These aren't necessarily wrong, but they receive a confidence penalty.
 */
const HALLUCINATION_SIGNALS: ReadonlySet<string> = new Set([
  'real-time collaboration',
  'machine learning integration',
  'blockchain integration',
  'ai-powered analytics',
  'natural language processing',
  'cloud-native deployment',
  'microservices architecture',
  'serverless functions',
  'progressive web app',
  'augmented reality',
]);

// ─────────────────────────── Service ───────────────────────────

/**
 * `FeatureExtractor` parses AI output into structured features and delegates
 * validation to `FeatureValidator`.
 *
 * @example
 * ```ts
 * const extractor = new FeatureExtractor();
 * const features  = extractor.parseFeatures(aiText);
 * const result    = extractor.extractAndValidate(aiText, codebaseMap, harvestResult, techReport);
 *
 * console.log(`Validated: ${result.validated.length}`);
 * console.log(`Rejected:  ${result.rejected.length}`);
 * ```
 */
export class FeatureExtractor {

  // ── Public API ──────────────────────────────────────────────

  /**
   * Full pipeline: parse features from AI text, then validate each one
   * against the actual codebase.
   *
   * @param aiText        - Raw AI output (e.g. from `features_extraction` prompt).
   * @param codebaseMap   - The `CodebaseMap` from `CodebaseMapper.buildCodebaseMap()`.
   * @param harvestResult - The `HarvestResult` from `DataHarvester.harvest()`.
   * @param techReport    - The `TechReport` from `TechMapper.analyze()`.
   * @returns A `FeatureExtractionResult` with validated, unverified, and rejected features.
   */
  public extractAndValidate(
    aiText: string,
    codebaseMap: CodebaseMap,
    harvestResult: HarvestResult,
    techReport: TechReport,
  ): FeatureExtractionResult {
    const parsed = this.parseFeatures(aiText);

    const validator = new FeatureValidator(codebaseMap, harvestResult, techReport);
    const allValidated = parsed.map(f => validator.validate(f));

    const validated  = allValidated.filter(f => f.status === 'validated');
    const unverified = allValidated.filter(f => f.status === 'unverified');
    const rejected   = allValidated.filter(f => f.status === 'rejected');

    const avgConfidence = validated.length > 0
      ? validated.reduce((sum, f) => sum + f.confidence, 0) / validated.length
      : 0;

    return {
      validated,
      unverified,
      rejected,
      stats: {
        totalParsed: parsed.length,
        validatedCount: validated.length,
        unverifiedCount: unverified.length,
        rejectedCount: rejected.length,
        averageConfidence: parseFloat(avgConfidence.toFixed(3)),
      },
    };
  }

  /**
   * Parse raw AI text into an array of `ExtractedFeature` objects.
   * Supports multiple formats:
   *   - Markdown bulleted lists (`- **Name**: Description`)
   *   - Numbered lists (`1. **Name** — Description`)
   *   - Heading + paragraph blocks
   */
  public parseFeatures(aiText: string): ExtractedFeature[] {
    const features: ExtractedFeature[] = [];
    const seen = new Set<string>();

    // Strategy 1: Markdown list items with bold name
    this.parseListItems(aiText, features, seen);

    // Strategy 2: Heading-based sections (### Feature Name)
    if (features.length === 0) {
      this.parseHeadingSections(aiText, features, seen);
    }

    // Strategy 3: Colon-separated name/description on each line
    if (features.length === 0) {
      this.parseColonSeparated(aiText, features, seen);
    }

    return features;
  }

  // ── Parsing strategies (private) ─────────────────────────────

  /**
   * Parse features from Markdown list items.
   * Matches patterns like:
   *   - **Feature Name**: Description text
   *   - **Feature Name** — Description text
   *   1. **Feature Name**: Description (user-facing)
   */
  private parseListItems(
    text: string,
    features: ExtractedFeature[],
    seen: Set<string>,
  ): void {
    const listItemRe =
      /^[-*•]\s+\*{0,2}([^*:\n]+?)\*{0,2}\s*[:—–-]\s*(.+)$/gm;

    let match: RegExpExecArray | null;
    while ((match = listItemRe.exec(text)) !== null) {
      const name = match[1].trim();
      const description = match[2].trim();
      if (this.addFeature(name, description, text, features, seen)) continue;
    }

    // Also try numbered lists
    const numberedRe =
      /^\d+[.)]\s+\*{0,2}([^*:\n]+?)\*{0,2}\s*[:—–-]\s*(.+)$/gm;

    while ((match = numberedRe.exec(text)) !== null) {
      const name = match[1].trim();
      const description = match[2].trim();
      this.addFeature(name, description, text, features, seen);
    }
  }

  /**
   * Parse features from heading + paragraph blocks.
   */
  private parseHeadingSections(
    text: string,
    features: ExtractedFeature[],
    seen: Set<string>,
  ): void {
    const headingRe = /^#{2,4}\s+(.+)$/gm;
    const headings: Array<{ name: string; index: number }> = [];

    let match: RegExpExecArray | null;
    while ((match = headingRe.exec(text)) !== null) {
      headings.push({ name: match[1].trim(), index: match.index + match[0].length });
    }

    for (let i = 0; i < headings.length; i++) {
      const start = headings[i].index;
      const end = i + 1 < headings.length ? headings[i + 1].index - headings[i + 1].name.length - 5 : text.length;
      const body = text.substring(start, end).trim();
      const description = body.split('\n').filter(l => l.trim()).slice(0, 3).join(' ').trim();
      if (description) {
        this.addFeature(headings[i].name, description, text, features, seen);
      }
    }
  }

  /**
   * Parse colon-separated lines (fallback).
   */
  private parseColonSeparated(
    text: string,
    features: ExtractedFeature[],
    seen: Set<string>,
  ): void {
    const colonRe = /^([A-Z][A-Za-z0-9 ]+?):\s+(.{10,})$/gm;

    let match: RegExpExecArray | null;
    while ((match = colonRe.exec(text)) !== null) {
      const name = match[1].trim();
      const description = match[2].trim();
      this.addFeature(name, description, text, features, seen);
    }
  }

  /**
   * Deduplicate and construct an `ExtractedFeature`.
   */
  private addFeature(
    name: string,
    description: string,
    rawText: string,
    features: ExtractedFeature[],
    seen: Set<string>,
  ): boolean {
    const key = name.toLowerCase().replace(/\s+/g, '-');
    if (seen.has(key) || name.length < 2 || name.length > 120) return false;
    seen.add(key);

    features.push({
      name,
      description,
      scope: this.inferScope(name, description),
      category: this.inferCategory(name, description),
      rawText: rawText.length > 500 ? undefined : rawText,
    });

    return true;
  }

  // ── Heuristic inference helpers ──────────────────────────────

  /**
   * Infer whether a feature is user-facing or internal from its text.
   */
  private inferScope(name: string, description: string): FeatureScope {
    const combined = `${name} ${description}`;
    for (const [pattern, scope] of SCOPE_KEYWORDS) {
      if (pattern.test(combined)) return scope;
    }
    return 'unknown';
  }

  /**
   * Infer a category from feature name/description keywords.
   */
  private inferCategory(name: string, description: string): FeatureCategory {
    const combined = `${name} ${description}`;
    for (const [pattern, category] of CATEGORY_KEYWORDS) {
      if (pattern.test(combined)) return category;
    }
    return 'other';
  }
}

// ─────────────────────────── Validator ───────────────────────────

/**
 * `FeatureValidator` cross-references a single AI-identified feature against
 * the project's actual code structure, dependencies, and detected features.
 *
 * Scoring:
 *   - Each piece of evidence contributes a weight (0–1).
 *   - Total confidence = sum of weights, capped at 1.0.
 *   - Confidence ≥ 0.5  → `validated`
 *   - Confidence ≥ 0.2  → `unverified`
 *   - Confidence <  0.2  → `rejected`
 */
export class FeatureValidator {
  private readonly codebaseMap: CodebaseMap;
  private readonly harvestResult: HarvestResult;
  private readonly techReport: TechReport;

  /** Lookup: lowercase code-element names for fast matching. */
  private readonly elementNames: Set<string>;

  /** Lookup: lowercase file basenames (without extension). */
  private readonly fileBaseNames: Set<string>;

  /** Lookup: lowercase file paths. */
  private readonly filePaths: string[];

  /** Lookup: lowercase dependency names. */
  private readonly dependencyNames: Set<string>;

  /** Lookup: lowercase codebase-mapper feature names. */
  private readonly detectedFeatureNames: Set<string>;

  constructor(
    codebaseMap: CodebaseMap,
    harvestResult: HarvestResult,
    techReport: TechReport,
  ) {
    this.codebaseMap = codebaseMap;
    this.harvestResult = harvestResult;
    this.techReport = techReport;

    // Pre-build lookup indexes
    this.elementNames = new Set(
      codebaseMap.elements.map(e => e.name.toLowerCase()),
    );

    this.fileBaseNames = new Set(
      codebaseMap.elements.map(e => path.basename(e.filePath, path.extname(e.filePath)).toLowerCase()),
    );

    this.filePaths = codebaseMap.elements.map(e => e.filePath.toLowerCase());

    this.dependencyNames = new Set(
      Array.from(harvestResult.dependencies.keys()).map(n => n.toLowerCase()),
    );

    this.detectedFeatureNames = new Set(
      codebaseMap.features.map(f => f.name.toLowerCase()),
    );
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Validate a single `ExtractedFeature` against the codebase.
   *
   * @param feature - The AI-extracted feature to validate.
   * @returns A `ValidatedFeature` with status, confidence, and evidence.
   */
  public validate(feature: ExtractedFeature): ValidatedFeature {
    const evidence: FeatureEvidence[] = [];

    // 1. Check against pre-detected features from CodebaseMapper
    this.checkDetectedFeatures(feature, evidence);

    // 2. Check against code elements (function/class/interface names)
    this.checkCodeElements(feature, evidence);

    // 3. Check against file paths
    this.checkFilePaths(feature, evidence);

    // 4. Check against dependencies
    this.checkDependencies(feature, evidence);

    // 5. Check against API endpoints
    this.checkAPIEndpoints(feature, evidence);

    // Calculate total confidence
    let confidence = evidence.reduce((sum, e) => sum + e.weight, 0);

    // Apply hallucination penalty
    if (this.isLikelyHallucination(feature)) {
      confidence *= 0.3;
    }

    // Cap at 1.0
    confidence = Math.min(1.0, confidence);

    // Determine status
    let status: FeatureStatus;
    let rejectionReason: string | undefined;

    if (confidence >= 0.5) {
      status = 'validated';
    } else if (confidence >= 0.2) {
      status = 'unverified';
    } else {
      status = 'rejected';
      rejectionReason = evidence.length === 0
        ? 'No supporting evidence found in the codebase.'
        : `Insufficient evidence (confidence: ${confidence.toFixed(2)}).`;
    }

    return {
      ...feature,
      status,
      confidence: parseFloat(confidence.toFixed(3)),
      evidence,
      rejectionReason,
    };
  }

  // ── Evidence collection (private) ───────────────────────────

  /**
   * Check if the feature matches any pre-detected feature from CodebaseMapper.
   */
  private checkDetectedFeatures(
    feature: ExtractedFeature,
    evidence: FeatureEvidence[],
  ): void {
    const featureName = feature.name.toLowerCase();
    const featureWords = this.extractKeywords(featureName);

    for (const detected of this.codebaseMap.features) {
      const detectedName = detected.name.toLowerCase();

      // Exact match
      if (detectedName === featureName) {
        evidence.push({
          type: 'codebase-feature',
          detail: `Exact match with detected feature "${detected.name}" (confidence: ${detected.confidence.toFixed(2)})`,
          weight: 0.4,
        });
        continue;
      }

      // Fuzzy match: check if keywords overlap
      const detectedWords = this.extractKeywords(detectedName);
      const overlap = featureWords.filter(w => detectedWords.includes(w));
      if (overlap.length > 0 && overlap.length >= Math.min(featureWords.length, detectedWords.length) * 0.5) {
        evidence.push({
          type: 'codebase-feature',
          detail: `Partial match with detected feature "${detected.name}" (shared keywords: ${overlap.join(', ')})`,
          weight: 0.25,
        });
      }
    }
  }

  /**
   * Check if any code elements match the feature name/description.
   */
  private checkCodeElements(
    feature: ExtractedFeature,
    evidence: FeatureEvidence[],
  ): void {
    const keywords = this.extractKeywords(`${feature.name} ${feature.description}`);

    for (const element of this.codebaseMap.elements) {
      const elementName = element.name.toLowerCase();

      for (const keyword of keywords) {
        if (keyword.length < 3) continue; // Skip tiny keywords

        if (elementName.includes(keyword)) {
          evidence.push({
            type: 'code-element',
            detail: `${element.type} "${element.name}" in ${path.basename(element.filePath)}`,
            weight: 0.15,
          });

          // Only add one piece of evidence per element to avoid flooding
          break;
        }
      }

      // Cap element evidence at 5 items to prevent over-weighting
      if (evidence.filter(e => e.type === 'code-element').length >= 5) break;
    }
  }

  /**
   * Check if any file paths match the feature name.
   */
  private checkFilePaths(
    feature: ExtractedFeature,
    evidence: FeatureEvidence[],
  ): void {
    const keywords = this.extractKeywords(feature.name);

    for (const keyword of keywords) {
      if (keyword.length < 3) continue;

      // Check file basenames
      for (const baseName of this.fileBaseNames) {
        if (baseName.includes(keyword)) {
          evidence.push({
            type: 'file-path',
            detail: `File matching keyword "${keyword}": ${baseName}`,
            weight: 0.1,
          });
          break; // One match per keyword is enough
        }
      }
    }
  }

  /**
   * Check if any dependencies are related to the feature.
   */
  private checkDependencies(
    feature: ExtractedFeature,
    evidence: FeatureEvidence[],
  ): void {
    const keywords = this.extractKeywords(`${feature.name} ${feature.description}`);

    for (const keyword of keywords) {
      if (keyword.length < 3) continue;

      for (const depName of this.dependencyNames) {
        if (depName.includes(keyword) || keyword.includes(depName)) {
          evidence.push({
            type: 'dependency',
            detail: `Dependency "${depName}" related to keyword "${keyword}"`,
            weight: 0.15,
          });
          break;
        }
      }
    }
  }

  /**
   * Check if any API endpoints are related to the feature.
   */
  private checkAPIEndpoints(
    feature: ExtractedFeature,
    evidence: FeatureEvidence[],
  ): void {
    const keywords = this.extractKeywords(`${feature.name} ${feature.description}`);

    for (const endpoint of this.codebaseMap.apiEndpoints) {
      const endpointPath = endpoint.path.toLowerCase();

      for (const keyword of keywords) {
        if (keyword.length < 3) continue;

        if (endpointPath.includes(keyword)) {
          evidence.push({
            type: 'api-endpoint',
            detail: `${endpoint.method} ${endpoint.path} in ${path.basename(endpoint.filePath)}`,
            weight: 0.2,
          });
          break;
        }
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────

  /**
   * Extract meaningful keywords from a string.
   * Removes common stop words and short tokens.
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'can', 'it', 'its', 'this', 'that',
      'these', 'those', 'not', 'no', 'all', 'each', 'every', 'any', 'some',
      'based', 'using', 'via', 'support', 'supports', 'supported', 'system',
    ]);

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/[\s-]+/)
      .filter(w => w.length >= 3 && !stopWords.has(w))
      .slice(0, 10); // Limit to prevent combinatorial explosion
  }

  /**
   * Check if a feature looks like a common AI hallucination.
   */
  private isLikelyHallucination(feature: ExtractedFeature): boolean {
    const combined = `${feature.name} ${feature.description}`.toLowerCase();

    for (const signal of HALLUCINATION_SIGNALS) {
      if (combined.includes(signal)) return true;
    }

    return false;
  }
}
