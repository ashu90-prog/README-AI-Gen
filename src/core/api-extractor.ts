/**
 * APIExtractor — Extracts, processes, and validates AI-identified API endpoints.
 *
 * This module bridges AI output and the codebase truth layer for API endpoints.
 * It:
 *
 *   1. Parses raw AI text into structured `ExtractedAPIEndpoint` objects.
 *   2. Validates each endpoint against actual endpoints from `CodebaseMap`
 *      and common REST/API conventions via `APIValidator`.
 *   3. Produces an `APIExtractionResult` with validated, unverified, and
 *      rejected endpoints — each annotated with confidence and structural analysis.
 *
 * Consumes types from:
 *   • `codebase-mapper.ts` → `CodebaseMap`, `APIEndpoint`
 *   • `tech-mapper.ts`     → `TechReport`
 *
 * @module core/api-extractor
 */

import path from 'path';
import { CodebaseMap, APIEndpoint } from './codebase-mapper.js';
import { TechReport } from './tech-mapper.js';

// ─────────────────────────── Types ───────────────────────────

/**
 * An API endpoint extracted from AI output, before validation.
 */
export interface ExtractedAPIEndpoint {
  /** HTTP method (or 'UNKNOWN'). */
  method: HTTPMethod;
  /** Route path (e.g. '/api/v1/users'). */
  path: string;
  /** AI-generated description of the endpoint. */
  description: string;
  /** Parameters or request body details (if mentioned). */
  parameters?: string;
  /** Expected response or return value (if mentioned). */
  response?: string;
  /** Raw text the endpoint was parsed from. */
  rawText?: string;
}

/**
 * Supported HTTP methods.
 */
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS' | 'UNKNOWN';

/**
 * Validation status for a single endpoint.
 */
export type APIEndpointStatus = 'validated' | 'unverified' | 'rejected';

/**
 * Evidence that an endpoint exists or is valid.
 */
export interface APIEvidence {
  /** Type of evidence. */
  type: APIEvidenceType;
  /** Detail string. */
  detail: string;
  /** Confidence contribution (0–1). */
  weight: number;
}

/**
 * Type of evidence used for API validation.
 */
export type APIEvidenceType =
  | 'exact-match'       // Exact match with detected endpoint in codebase
  | 'partial-match'     // Partial match (same path, different method, etc.)
  | 'pattern-match'     // Matches common REST/API patterns
  | 'file-evidence'     // Related file found (e.g. routes/users.ts)
  | 'convention-match'; // Follows REST naming conventions

/**
 * Structural issues detected in an endpoint specification.
 */
export interface APIStructuralIssue {
  /** Severity level. */
  severity: 'error' | 'warning' | 'info';
  /** Machine-readable issue code. */
  code: string;
  /** Human-readable message. */
  message: string;
  /** Suggested fix. */
  suggestion?: string;
}

/**
 * A fully validated (or rejected) API endpoint, enriched with evidence.
 */
export interface ValidatedAPIEndpoint extends ExtractedAPIEndpoint {
  /** Validation outcome. */
  status: APIEndpointStatus;
  /** Overall confidence score (0–1). */
  confidence: number;
  /** Evidence items supporting (or contradicting) this endpoint. */
  evidence: APIEvidence[];
  /** Structural issues found. */
  structuralIssues: APIStructuralIssue[];
  /** Human-readable reason for rejection, if applicable. */
  rejectionReason?: string;
}

/**
 * Complete result of the API extraction and validation pipeline.
 */
export interface APIExtractionResult {
  /** All validated endpoints (status = 'validated'). */
  validated: ValidatedAPIEndpoint[];
  /** Endpoints that could not be confirmed but are plausible. */
  unverified: ValidatedAPIEndpoint[];
  /** Endpoints rejected as likely hallucinations or errors. */
  rejected: ValidatedAPIEndpoint[];
  /** Summary of the detected API style. */
  apiStyle: APIStyleSummary;
  /** Aggregate statistics. */
  stats: APIExtractionStats;
}

/**
 * Summary of the API's characteristics.
 */
export interface APIStyleSummary {
  /** Detected API type (REST, GraphQL, RPC, etc.). */
  type: 'REST' | 'GraphQL' | 'RPC' | 'WebSocket' | 'mixed' | 'unknown';
  /** Whether versioning is used (e.g. /api/v1/). */
  hasVersioning: boolean;
  /** Detected version prefix (e.g. '/api/v1'). */
  versionPrefix?: string;
  /** Whether consistent naming conventions are used. */
  consistentNaming: boolean;
  /** Detected naming style (kebab-case, camelCase, snake_case). */
  namingStyle?: string;
}

/**
 * Aggregate statistics about the extraction run.
 */
export interface APIExtractionStats {
  /** Total endpoints parsed from AI output. */
  totalParsed: number;
  /** Number of endpoints validated. */
  validatedCount: number;
  /** Number left unverified. */
  unverifiedCount: number;
  /** Number rejected. */
  rejectedCount: number;
  /** Average confidence of validated endpoints. */
  averageConfidence: number;
  /** Number of structural issues found. */
  totalStructuralIssues: number;
}

// ─────────────────── Common REST Patterns ──────────────────

/**
 * Common REST resource patterns that indicate a well-formed endpoint.
 */
const REST_RESOURCE_PATTERNS: ReadonlyArray<RegExp> = [
  // Standard resource paths: /api/resource, /api/v1/resource
  /^\/(?:api\/)?(?:v\d+\/)?[a-z][a-z0-9-]*(?:\/:[a-z][a-z0-9]*(?:Id)?)?$/i,
  // Nested resources: /api/users/:userId/posts
  /^\/(?:api\/)?(?:v\d+\/)?[a-z][a-z0-9-]*\/:[a-z]+\/[a-z][a-z0-9-]*$/i,
  // Action endpoints: /api/users/:id/activate
  /^\/(?:api\/)?(?:v\d+\/)?[a-z][a-z0-9-]*\/:[a-z]+\/[a-z][a-z0-9-]*$/i,
];

/**
 * Well-known REST resource names commonly found in web applications.
 */
const COMMON_RESOURCES: ReadonlySet<string> = new Set([
  'users', 'posts', 'comments', 'products', 'orders', 'items',
  'auth', 'login', 'register', 'sessions', 'tokens', 'profile',
  'settings', 'config', 'notifications', 'messages', 'files',
  'uploads', 'images', 'categories', 'tags', 'search', 'health',
  'status', 'metrics', 'logs', 'events', 'webhooks', 'payments',
  'subscriptions', 'invoices', 'teams', 'projects', 'tasks',
  'roles', 'permissions', 'groups', 'organizations', 'workspaces',
]);

/**
 * Method-to-action conventions for REST validation.
 */
const REST_CONVENTIONS: ReadonlyMap<HTTPMethod, ReadonlyArray<string>> = new Map([
  ['GET',    ['list', 'get', 'fetch', 'read', 'retrieve', 'show', 'index', 'search', 'find']],
  ['POST',   ['create', 'add', 'submit', 'register', 'login', 'upload', 'send', 'import']],
  ['PUT',    ['update', 'replace', 'set', 'modify', 'edit']],
  ['PATCH',  ['update', 'modify', 'edit', 'patch', 'partial']],
  ['DELETE', ['delete', 'remove', 'destroy', 'revoke', 'cancel']],
]);

// ─────────────────────────── Service ───────────────────────────

/**
 * `APIExtractor` parses AI output into structured API endpoints and delegates
 * validation to `APIValidator`.
 *
 * @example
 * ```ts
 * const extractor = new APIExtractor();
 * const endpoints = extractor.parseEndpoints(aiText);
 * const result    = extractor.extractAndValidate(aiText, codebaseMap, techReport);
 *
 * console.log(`Validated: ${result.validated.length}`);
 * console.log(`API Style: ${result.apiStyle.type}`);
 * ```
 */
export class APIExtractor {

  // ── Public API ──────────────────────────────────────────────

  /**
   * Full pipeline: parse endpoints from AI text, then validate each one
   * against the actual codebase.
   *
   * @param aiText      - Raw AI output (e.g. from `api_endpoint_discovery` prompt).
   * @param codebaseMap - The `CodebaseMap` from `CodebaseMapper.buildCodebaseMap()`.
   * @param techReport  - The `TechReport` from `TechMapper.analyze()`.
   * @returns An `APIExtractionResult` with validated, unverified, and rejected endpoints.
   */
  public extractAndValidate(
    aiText: string,
    codebaseMap: CodebaseMap,
    techReport: TechReport,
  ): APIExtractionResult {
    const parsed = this.parseEndpoints(aiText);

    const validator = new APIValidator(codebaseMap, techReport);
    const allValidated = parsed.map(ep => validator.validate(ep));

    const validated  = allValidated.filter(ep => ep.status === 'validated');
    const unverified = allValidated.filter(ep => ep.status === 'unverified');
    const rejected   = allValidated.filter(ep => ep.status === 'rejected');

    const apiStyle = this.analyzeAPIStyle(allValidated);

    const avgConfidence = validated.length > 0
      ? validated.reduce((sum, ep) => sum + ep.confidence, 0) / validated.length
      : 0;

    const totalStructuralIssues = allValidated.reduce(
      (sum, ep) => sum + ep.structuralIssues.length, 0,
    );

    return {
      validated,
      unverified,
      rejected,
      apiStyle,
      stats: {
        totalParsed: parsed.length,
        validatedCount: validated.length,
        unverifiedCount: unverified.length,
        rejectedCount: rejected.length,
        averageConfidence: parseFloat(avgConfidence.toFixed(3)),
        totalStructuralIssues,
      },
    };
  }

  /**
   * Parse raw AI text into an array of `ExtractedAPIEndpoint` objects.
   * Supports multiple formats:
   *   - Markdown table rows (`| GET | /api/users | List all users |`)
   *   - Markdown list items (`- **GET /api/users** — List all users`)
   *   - Inline method + path patterns (`GET /api/users`)
   */
  public parseEndpoints(aiText: string): ExtractedAPIEndpoint[] {
    const endpoints: ExtractedAPIEndpoint[] = [];
    const seen = new Set<string>();

    // Strategy 1: Markdown table rows
    this.parseTableRows(aiText, endpoints, seen);

    // Strategy 2: List items with method + path
    this.parseListItems(aiText, endpoints, seen);

    // Strategy 3: Inline method + path (fallback)
    if (endpoints.length === 0) {
      this.parseInlineEndpoints(aiText, endpoints, seen);
    }

    return endpoints;
  }

  // ── Parsing strategies (private) ─────────────────────────────

  /**
   * Parse endpoints from Markdown table rows.
   * Matches: `| GET | /api/users | List all users |`
   */
  private parseTableRows(
    text: string,
    endpoints: ExtractedAPIEndpoint[],
    seen: Set<string>,
  ): void {
    const tableRowRe =
      /\|\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\|\s*(\/\S+)\s*\|\s*([^|]+)\|/gi;

    let match: RegExpExecArray | null;
    while ((match = tableRowRe.exec(text)) !== null) {
      const method = match[1].toUpperCase() as HTTPMethod;
      const routePath = match[2].trim();
      const description = match[3].trim();

      this.addEndpoint(method, routePath, description, endpoints, seen);
    }
  }

  /**
   * Parse endpoints from Markdown list items.
   * Matches:
   *   - `- **GET /api/users**: List all users`
   *   - `- GET /api/users — List all users`
   *   - `- `GET /api/users` - List all users`
   */
  private parseListItems(
    text: string,
    endpoints: ExtractedAPIEndpoint[],
    seen: Set<string>,
  ): void {
    const listItemRe =
      /^[-*•]\s+(?:\*{0,2}`?)?(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/\S+)(?:`?\*{0,2})?\s*[:—–-]\s*(.+)$/gmi;

    let match: RegExpExecArray | null;
    while ((match = listItemRe.exec(text)) !== null) {
      const method = match[1].toUpperCase() as HTTPMethod;
      const routePath = match[2].trim();
      const description = match[3].trim();

      this.addEndpoint(method, routePath, description, endpoints, seen);
    }
  }

  /**
   * Parse inline method + path patterns (fallback).
   * Matches: `GET /api/users` anywhere in the text.
   */
  private parseInlineEndpoints(
    text: string,
    endpoints: ExtractedAPIEndpoint[],
    seen: Set<string>,
  ): void {
    const inlineRe =
      /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/[a-zA-Z0-9/_:{}.-]+)/gi;

    let match: RegExpExecArray | null;
    while ((match = inlineRe.exec(text)) !== null) {
      const method = match[1].toUpperCase() as HTTPMethod;
      const routePath = match[2].trim();

      // Try to find a description near the match
      const afterMatch = text.substring(match.index + match[0].length, match.index + match[0].length + 200);
      const descMatch = afterMatch.match(/^[\s:—–-]+(.{5,100}?)(?:\n|$)/);
      const description = descMatch ? descMatch[1].trim() : '';

      this.addEndpoint(method, routePath, description, endpoints, seen);
    }
  }

  /**
   * Deduplicate and construct an `ExtractedAPIEndpoint`.
   */
  private addEndpoint(
    method: HTTPMethod,
    routePath: string,
    description: string,
    endpoints: ExtractedAPIEndpoint[],
    seen: Set<string>,
  ): boolean {
    const key = `${method}:${routePath}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);

    // Clean up route path
    const cleanPath = routePath
      .replace(/`/g, '')       // Remove backticks
      .replace(/\*{1,2}/g, '') // Remove bold markers
      .trim();

    if (cleanPath.length < 2) return false;

    endpoints.push({
      method,
      path: cleanPath,
      description: description.replace(/\*{1,2}/g, '').trim(),
    });

    return true;
  }

  // ── API Style Analysis ──────────────────────────────────────

  /**
   * Analyze the overall API style from validated endpoints.
   */
  private analyzeAPIStyle(endpoints: ValidatedAPIEndpoint[]): APIStyleSummary {
    if (endpoints.length === 0) {
      return {
        type: 'unknown',
        hasVersioning: false,
        consistentNaming: true,
      };
    }

    // Detect versioning
    const versionedPaths = endpoints.filter(ep => /\/v\d+\//i.test(ep.path));
    const hasVersioning = versionedPaths.length > endpoints.length * 0.3;
    let versionPrefix: string | undefined;

    if (hasVersioning && versionedPaths.length > 0) {
      const versionMatch = versionedPaths[0].path.match(/(\/(?:api\/)?v\d+)/i);
      versionPrefix = versionMatch?.[1];
    }

    // Detect API type
    const hasGraphQL = endpoints.some(ep => ep.path.includes('graphql'));
    const hasRPC = endpoints.some(ep =>
      ep.path.includes('rpc') || ep.description.toLowerCase().includes('rpc'),
    );
    const hasWebSocket = endpoints.some(ep =>
      ep.path.includes('ws') || ep.description.toLowerCase().includes('websocket'),
    );

    let type: APIStyleSummary['type'] = 'REST';
    if (hasGraphQL && !hasRPC) type = 'GraphQL';
    else if (hasRPC && !hasGraphQL) type = 'RPC';
    else if (hasWebSocket) type = 'WebSocket';
    else if ((hasGraphQL ? 1 : 0) + (hasRPC ? 1 : 0) + (hasWebSocket ? 1 : 0) > 1) type = 'mixed';

    // Detect naming style
    const paths = endpoints.map(ep => ep.path);
    const namingStyle = this.detectNamingStyle(paths);

    return {
      type,
      hasVersioning,
      versionPrefix,
      consistentNaming: namingStyle !== undefined,
      namingStyle,
    };
  }

  /**
   * Detect the naming convention used in paths.
   */
  private detectNamingStyle(paths: string[]): string | undefined {
    const segments = paths
      .flatMap(p => p.split('/'))
      .filter(s => s.length > 1 && !s.startsWith(':') && !s.startsWith('{'));

    if (segments.length === 0) return undefined;

    let kebab = 0;
    let camel = 0;
    let snake = 0;

    for (const segment of segments) {
      if (segment.includes('-')) kebab++;
      else if (segment.includes('_')) snake++;
      else if (/[a-z][A-Z]/.test(segment)) camel++;
    }

    const total = kebab + camel + snake;
    if (total === 0) return 'flat'; // e.g. /users, /posts — no multi-word segments

    if (kebab > camel && kebab > snake) return 'kebab-case';
    if (camel > kebab && camel > snake) return 'camelCase';
    if (snake > kebab && snake > camel) return 'snake_case';

    return undefined; // Mixed or ambiguous
  }
}

// ─────────────────────────── Validator ───────────────────────────

/**
 * `APIValidator` cross-references a single AI-identified endpoint against
 * the project's actual endpoints and REST conventions.
 *
 * Scoring:
 *   - Each piece of evidence contributes a weight (0–1).
 *   - Total confidence = sum of weights, capped at 1.0.
 *   - Confidence ≥ 0.4  → `validated`
 *   - Confidence ≥ 0.15 → `unverified`
 *   - Confidence <  0.15 → `rejected`
 */
export class APIValidator {
  private readonly codebaseMap: CodebaseMap;
  private readonly techReport: TechReport;

  /** Lookup: actual endpoints keyed by "METHOD:path". */
  private readonly endpointIndex: Map<string, APIEndpoint>;

  /** Lookup: actual endpoint paths (lowercase). */
  private readonly endpointPaths: Set<string>;

  /** Lookup: file basenames (lowercase) that might contain routes. */
  private readonly routeFileNames: Set<string>;

  constructor(codebaseMap: CodebaseMap, techReport: TechReport) {
    this.codebaseMap = codebaseMap;
    this.techReport = techReport;

    // Build lookup indexes
    this.endpointIndex = new Map(
      codebaseMap.apiEndpoints.map(ep => [`${ep.method}:${ep.path}`.toLowerCase(), ep]),
    );

    this.endpointPaths = new Set(
      codebaseMap.apiEndpoints.map(ep => ep.path.toLowerCase()),
    );

    this.routeFileNames = new Set(
      codebaseMap.apiEndpoints.map(ep => path.basename(ep.filePath, path.extname(ep.filePath)).toLowerCase()),
    );
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Validate a single `ExtractedAPIEndpoint` against the codebase.
   *
   * @param endpoint - The AI-extracted endpoint to validate.
   * @returns A `ValidatedAPIEndpoint` with status, confidence, and evidence.
   */
  public validate(endpoint: ExtractedAPIEndpoint): ValidatedAPIEndpoint {
    const evidence: APIEvidence[] = [];
    const structuralIssues: APIStructuralIssue[] = [];

    // 1. Check for exact match in detected endpoints
    this.checkExactMatch(endpoint, evidence);

    // 2. Check for partial match (same path, different method)
    this.checkPartialMatch(endpoint, evidence);

    // 3. Check against common REST patterns
    this.checkRESTPatterns(endpoint, evidence);

    // 4. Check for related route files
    this.checkRouteFiles(endpoint, evidence);

    // 5. Check naming conventions
    this.checkConventions(endpoint, evidence);

    // 6. Run structural validation
    this.validateStructure(endpoint, structuralIssues);

    // Calculate total confidence
    let confidence = evidence.reduce((sum, e) => sum + e.weight, 0);

    // Apply penalty for structural errors
    const errorCount = structuralIssues.filter(i => i.severity === 'error').length;
    if (errorCount > 0) {
      confidence *= Math.max(0.2, 1 - (errorCount * 0.3));
    }

    confidence = Math.min(1.0, confidence);

    // Determine status
    let status: APIEndpointStatus;
    let rejectionReason: string | undefined;

    if (confidence >= 0.4) {
      status = 'validated';
    } else if (confidence >= 0.15) {
      status = 'unverified';
    } else {
      status = 'rejected';
      rejectionReason = evidence.length === 0
        ? 'No supporting evidence found in the codebase and endpoint does not match common patterns.'
        : `Insufficient evidence (confidence: ${confidence.toFixed(2)}).`;
    }

    return {
      ...endpoint,
      status,
      confidence: parseFloat(confidence.toFixed(3)),
      evidence,
      structuralIssues,
      rejectionReason,
    };
  }

  // ── Evidence collection (private) ───────────────────────────

  /**
   * Check for an exact match (same method + path) in detected endpoints.
   */
  private checkExactMatch(
    endpoint: ExtractedAPIEndpoint,
    evidence: APIEvidence[],
  ): void {
    const key = `${endpoint.method}:${endpoint.path}`.toLowerCase();
    const match = this.endpointIndex.get(key);

    if (match) {
      evidence.push({
        type: 'exact-match',
        detail: `Exact match: ${match.method} ${match.path} in ${path.basename(match.filePath)}`,
        weight: 0.5,
      });
    }
  }

  /**
   * Check for partial match (same path, different method, or similar path).
   */
  private checkPartialMatch(
    endpoint: ExtractedAPIEndpoint,
    evidence: APIEvidence[],
  ): void {
    const normalizedPath = this.normalizePath(endpoint.path);

    for (const actual of this.codebaseMap.apiEndpoints) {
      const actualNormalized = this.normalizePath(actual.path);

      // Same path, different method
      if (actualNormalized === normalizedPath && actual.method !== endpoint.method) {
        evidence.push({
          type: 'partial-match',
          detail: `Path exists with different method: ${actual.method} ${actual.path}`,
          weight: 0.3,
        });
        return;
      }

      // Similar path (one is a sub-path of the other)
      if (
        (normalizedPath.startsWith(actualNormalized) || actualNormalized.startsWith(normalizedPath)) &&
        normalizedPath !== actualNormalized &&
        Math.abs(normalizedPath.length - actualNormalized.length) < 20
      ) {
        evidence.push({
          type: 'partial-match',
          detail: `Similar path found: ${actual.method} ${actual.path}`,
          weight: 0.15,
        });
        return;
      }
    }
  }

  /**
   * Check if the endpoint matches common REST patterns.
   */
  private checkRESTPatterns(
    endpoint: ExtractedAPIEndpoint,
    evidence: APIEvidence[],
  ): void {
    // Check if the path matches standard RESTful patterns
    for (const pattern of REST_RESOURCE_PATTERNS) {
      if (pattern.test(endpoint.path)) {
        evidence.push({
          type: 'pattern-match',
          detail: `Path matches standard REST resource pattern`,
          weight: 0.1,
        });
        break;
      }
    }

    // Check if the path contains a common resource name
    const pathSegments = endpoint.path.split('/').filter(Boolean);
    for (const segment of pathSegments) {
      const cleanSegment = segment.replace(/^[:{]/, '').replace(/[}]$/, '').toLowerCase();
      if (COMMON_RESOURCES.has(cleanSegment)) {
        evidence.push({
          type: 'pattern-match',
          detail: `Path contains common resource name: "${cleanSegment}"`,
          weight: 0.1,
        });
        break;
      }
    }
  }

  /**
   * Check if there are route-related files that match the endpoint.
   */
  private checkRouteFiles(
    endpoint: ExtractedAPIEndpoint,
    evidence: APIEvidence[],
  ): void {
    // Extract the primary resource name from the path
    const segments = endpoint.path.split('/').filter(s => s && !s.startsWith(':') && !s.startsWith('{'));
    const resourceName = segments[segments.length - 1]?.toLowerCase();

    if (!resourceName || resourceName.length < 2) return;

    // Check if there's a file matching the resource name
    for (const element of this.codebaseMap.elements) {
      const fileName = path.basename(element.filePath, path.extname(element.filePath)).toLowerCase();

      if (
        fileName.includes(resourceName) ||
        resourceName.includes(fileName)
      ) {
        evidence.push({
          type: 'file-evidence',
          detail: `Related file found: ${path.basename(element.filePath)}`,
          weight: 0.1,
        });
        return;
      }
    }
  }

  /**
   * Check if the method/action combination follows REST conventions.
   */
  private checkConventions(
    endpoint: ExtractedAPIEndpoint,
    evidence: APIEvidence[],
  ): void {
    const descriptionLower = endpoint.description.toLowerCase();
    const expectedActions = REST_CONVENTIONS.get(endpoint.method);

    if (!expectedActions) return;

    for (const action of expectedActions) {
      if (descriptionLower.includes(action)) {
        evidence.push({
          type: 'convention-match',
          detail: `Description ("${action}") aligns with ${endpoint.method} convention`,
          weight: 0.1,
        });
        return;
      }
    }
  }

  // ── Structural validation ───────────────────────────────────

  /**
   * Check the endpoint for structural problems.
   */
  private validateStructure(
    endpoint: ExtractedAPIEndpoint,
    issues: APIStructuralIssue[],
  ): void {
    this.checkPathFormat(endpoint, issues);
    this.checkMethodPathAlignment(endpoint, issues);
    this.checkDuplicateSlashes(endpoint, issues);
    this.checkTrailingSlash(endpoint, issues);
  }

  /**
   * Check that the path starts with `/` and doesn't contain spaces.
   */
  private checkPathFormat(
    endpoint: ExtractedAPIEndpoint,
    issues: APIStructuralIssue[],
  ): void {
    if (!endpoint.path.startsWith('/')) {
      issues.push({
        severity: 'error',
        code: 'MISSING_LEADING_SLASH',
        message: `Path "${endpoint.path}" does not start with "/"`,
        suggestion: `Change to "/${endpoint.path}"`,
      });
    }

    if (/\s/.test(endpoint.path)) {
      issues.push({
        severity: 'error',
        code: 'PATH_CONTAINS_SPACES',
        message: `Path "${endpoint.path}" contains whitespace`,
        suggestion: `Remove spaces or use hyphens/underscores`,
      });
    }

    // Check for uppercase in path (non-standard)
    if (/[A-Z]/.test(endpoint.path.replace(/\/(v\d+)/g, ''))) {
      issues.push({
        severity: 'warning',
        code: 'UPPERCASE_IN_PATH',
        message: `Path "${endpoint.path}" contains uppercase characters`,
        suggestion: `REST convention uses lowercase paths`,
      });
    }
  }

  /**
   * Check that the HTTP method aligns with the path structure.
   * E.g. POST should not typically target a resource with an ID.
   */
  private checkMethodPathAlignment(
    endpoint: ExtractedAPIEndpoint,
    issues: APIStructuralIssue[],
  ): void {
    const hasIdParam = /\/:[a-z]+|\/\{[a-z]+\}/i.test(endpoint.path);

    // POST to a resource with an ID is unusual
    if (endpoint.method === 'POST' && hasIdParam) {
      const isActionEndpoint = endpoint.path.split('/').length > 4;
      if (!isActionEndpoint) {
        issues.push({
          severity: 'info',
          code: 'POST_WITH_ID',
          message: `POST to "${endpoint.path}" includes an ID parameter (unusual for creation)`,
          suggestion: `POST typically targets collection endpoints (e.g. /api/users, not /api/users/:id)`,
        });
      }
    }

    // DELETE without an ID param targets the entire collection
    if (endpoint.method === 'DELETE' && !hasIdParam) {
      issues.push({
        severity: 'warning',
        code: 'DELETE_WITHOUT_ID',
        message: `DELETE on "${endpoint.path}" targets an entire collection`,
        suggestion: `Ensure this is intentional — bulk deletes should be explicitly documented`,
      });
    }
  }

  /**
   * Check for duplicate slashes in the path.
   */
  private checkDuplicateSlashes(
    endpoint: ExtractedAPIEndpoint,
    issues: APIStructuralIssue[],
  ): void {
    if (/\/\/+/.test(endpoint.path)) {
      issues.push({
        severity: 'warning',
        code: 'DUPLICATE_SLASHES',
        message: `Path "${endpoint.path}" contains duplicate slashes`,
        suggestion: `Remove duplicate slashes`,
      });
    }
  }

  /**
   * Check for inconsistent trailing slashes.
   */
  private checkTrailingSlash(
    endpoint: ExtractedAPIEndpoint,
    issues: APIStructuralIssue[],
  ): void {
    if (endpoint.path.length > 1 && endpoint.path.endsWith('/')) {
      issues.push({
        severity: 'info',
        code: 'TRAILING_SLASH',
        message: `Path "${endpoint.path}" has a trailing slash`,
        suggestion: `REST convention typically omits trailing slashes`,
      });
    }
  }

  // ── Helpers ─────────────────────────────────────────────────

  /**
   * Normalize a route path for comparison:
   *   - Lowercase
   *   - Replace parameter names with a generic placeholder
   *   - Remove trailing slash
   */
  private normalizePath(routePath: string): string {
    return routePath
      .toLowerCase()
      .replace(/\/:[a-z][a-z0-9]*/gi, '/:param')    // :userId → :param
      .replace(/\/\{[a-z][a-z0-9]*\}/gi, '/:param')  // {userId} → :param
      .replace(/\/+$/, '');                            // Remove trailing slash
  }
}
