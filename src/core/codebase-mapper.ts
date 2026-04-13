/**
 * CodebaseMapper — Creates structured maps of codebases for AI navigation.
 *
 * This module extends the context building capabilities to create detailed
 * codebase maps that help AI understand the structure, relationships, and
 * key components of a project.
 *
 * Features:
 *   • Builds a "Codebase Map" with function definitions, class structures, file relationships
 *   • Prioritizes files and sections that define core features and API endpoints
 *   • Implements a "Code Snippet Extractor" to pull out small, relevant code blocks
 *   • Provides rich, optimized context for AI feature and API identification
 *
 * @module core/codebase-mapper
 */

import fs from 'fs-extra';
import path from 'path';
import { FileInfo } from './scanner.js';
import { TechReport, ProjectType } from './tech-mapper.js';
import { ContextBuilder, ContextBuilderOptions, FileWithContext, ContextBuildResult } from './context-builder.js';

// ─────────────────────────── Types ───────────────────────────

/**
 * Type of code element.
 */
export type CodeElementType = 
  | 'function' 
  | 'class' 
  | 'interface' 
  | 'type' 
  | 'enum' 
  | 'constant' 
  | 'variable' 
  | 'method' 
  | 'property' 
  | 'api-route' 
  | 'api-endpoint' 
  | 'component' 
  | 'hook' 
  | 'middleware' 
  | 'other';

/**
 * Visibility/access modifier of a code element.
 */
export type Visibility = 'public' | 'private' | 'protected' | 'internal' | 'unknown';

/**
 * A code element extracted from source code.
 */
export interface CodeElement {
  /** The type of code element */
  type: CodeElementType;
  /** The name of the element */
  name: string;
  /** The file this element is defined in */
  filePath: string;
  /** Line number where the element starts */
  startLine: number;
  /** Line number where the element ends (if known) */
  endLine?: number;
  /** Visibility/access modifier */
  visibility: Visibility;
  /** Brief description or signature */
  signature?: string;
  /** Whether this is exported/public API */
  isExported: boolean;
  /** Parent element (if nested) */
  parent?: string;
  /** Tags or categories */
  tags: string[];
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * A code snippet extracted for AI analysis.
 */
export interface CodeSnippet {
  /** The file this snippet is from */
  filePath: string;
  /** The snippet content */
  content: string;
  /** The type of snippet */
  type: CodeElementType;
  /** Brief description of what this snippet shows */
  description: string;
  /** Line number where snippet starts */
  startLine: number;
  /** Line number where snippet ends */
  endLine: number;
  /** Estimated token count */
  estimatedTokens: number;
  /** Relevance score (0-1) */
  relevanceScore: number;
  /** Context around the snippet */
  context?: string;
}

/**
 * File relationship type.
 */
export type RelationshipType = 'imports' | 'extends' | 'implements' | 'uses' | 'calls' | 'other';

/**
 * A relationship between files or code elements.
 */
export interface FileRelationship {
  /** The source file */
  source: string;
  /** The target file or element */
  target: string;
  /** The type of relationship */
  type: RelationshipType;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * An API endpoint detected in the codebase.
 */
export interface APIEndpoint {
  /** The HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS' | 'UNKNOWN';
  /** The route path */
  path: string;
  /** The file this endpoint is defined in */
  filePath: string;
  /** Line number */
  lineNumber: number;
  /** Handler function name */
  handler?: string;
  /** Brief description */
  description?: string;
  /** Whether this is a public API */
  isPublic: boolean;
  /** Tags or categories */
  tags: string[];
}

/**
 * A feature detected in the codebase.
 */
export interface Feature {
  /** The feature name */
  name: string;
  /** Brief description */
  description: string;
  /** Files that implement this feature */
  files: string[];
  /** Code elements related to this feature */
  elements: CodeElement[];
  /** Confidence score (0-1) */
  confidence: number;
  /** Category of feature */
  category: 'core' | 'ui' | 'api' | 'utility' | 'other';
}

/**
 * Complete codebase map.
 */
export interface CodebaseMap {
  /** All code elements found */
  elements: CodeElement[];
  /** Code snippets extracted for AI analysis */
  snippets: CodeSnippet[];
  /** File relationships */
  relationships: FileRelationship[];
  /** API endpoints detected */
  apiEndpoints: APIEndpoint[];
  /** Features detected */
  features: Feature[];
  /** Statistics about the codebase */
  stats: {
    totalElements: number;
    totalSnippets: number;
    totalRelationships: number;
    totalAPIEndpoints: number;
    totalFeatures: number;
    filesAnalyzed: number;
  };
}

/**
 * Extended context result with codebase map.
 */
export interface CodebaseMapResult extends ContextBuildResult {
  /** The codebase map */
  codebaseMap: CodebaseMap;
  /** High-level summary of the codebase */
  summary: {
    architecture: string;
    mainComponents: string[];
    keyFeatures: string[];
    apiStyle?: string;
  };
}

/**
 * Options for codebase mapping.
 */
export interface CodebaseMapOptions extends ContextBuilderOptions {
  /** Maximum number of snippets to extract */
  maxSnippets?: number;
  /** Maximum lines per snippet */
  maxSnippetLines?: number;
  /** Whether to include private/internal elements */
  includePrivate?: boolean;
  /** Whether to extract API endpoints */
  extractAPIEndpoints?: boolean;
  /** Whether to detect features */
  detectFeatures?: boolean;
  /** Minimum confidence score for elements */
  minConfidence?: number;
}

// ─────────────────── Language-Specific Patterns ──────────────────

/**
 * Patterns for detecting code elements in different languages.
 */
const LANGUAGE_PATTERNS: ReadonlyMap<string, LanguagePatterns> = new Map([
  ['typescript', {
    function: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
    arrowFunction: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
    class: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
    interface: /^(?:export\s+)?interface\s+(\w+)/,
    type: /^(?:export\s+)?type\s+(\w+)/,
    enum: /^(?:export\s+)?enum\s+(\w+)/,
    method: /(?:public|private|protected|static)?\s*(?:async\s+)?(\w+)\s*\(/,
    property: /(?:public|private|protected|static)?\s*(?:readonly\s+)?(\w+)\s*[=:]/,
    apiRoute: /(?:@Get|@Post|@Put|@Delete|@Patch)\s*\(['"`](.*?)['"`]\)/,
    apiEndpoint: /router\.(get|post|put|delete|patch)\s*\(['"`](.*?)['"`]\)/,
  }],
  ['javascript', {
    function: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
    arrowFunction: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
    class: /^(?:export\s+)?class\s+(\w+)/,
    method: /(?:async\s+)?(\w+)\s*\(/,
    property: /this\.(\w+)\s*[=:]/,
    apiRoute: /router\.(get|post|put|delete|patch)\s*\(['"`](.*?)['"`]\)/,
  }],
  ['python', {
    function: /^def\s+(\w+)/,
    class: /^class\s+(\w+)/,
    method: /def\s+(\w+)\s*\(/,
    property: /self\.(\w+)\s*=/,
    apiRoute: /@app\.(route|get|post|put|delete|patch)\s*\(['"`](.*?)['"`]\)/,
  }],
  ['rust', {
    function: /^pub\s+fn\s+(\w+)/,
    functionPrivate: /^fn\s+(\w+)/,
    struct: /^pub\s+struct\s+(\w+)/,
    enum: /^pub\s+enum\s+(\w+)/,
    impl: /^impl\s+(\w+)/,
    method: /pub\s+fn\s+(\w+)/,
  }],
  ['go', {
    function: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/,
    struct: /^type\s+(\w+)\s+struct/,
    interface: /^type\s+(\w+)\s+interface/,
    method: /func\s+\(\w+\s+\*?\w+\)\s+(\w+)/,
  }],
  ['java', {
    class: /^(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/,
    interface: /^(?:public\s+)?interface\s+(\w+)/,
    method: /(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/,
    field: /(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?\w+\s+(\w+)\s*[=;]/,
  }],
]);

/**
 * Language-specific patterns for code element detection.
 */
interface LanguagePatterns {
  function?: RegExp;
  arrowFunction?: RegExp;
  class?: RegExp;
  interface?: RegExp;
  type?: RegExp;
  enum?: RegExp;
  method?: RegExp;
  property?: RegExp;
  field?: RegExp;
  struct?: RegExp;
  impl?: RegExp;
  functionPrivate?: RegExp;
  apiRoute?: RegExp;
  apiEndpoint?: RegExp;
}

// ─────────────────── Feature Detection Patterns ──────────────────

/**
 * Patterns for detecting features from code elements.
 */
const FEATURE_PATTERNS: ReadonlyArray<readonly [RegExp, Feature['category'], string]> = [
  // Authentication features
  [/auth|login|logout|register|signin|signup|password|jwt|token|session/i, 'core', 'Authentication'],
  
  // Database features
  [/database|db|model|schema|repository|dao|orm|query|migration/i, 'core', 'Database'],
  
  // API features
  [/api|route|endpoint|controller|handler|middleware/i, 'api', 'API'],
  
  // UI features
  [/component|view|page|screen|template|render/i, 'ui', 'UI'],
  
  // Utility features
  [/util|helper|tool|lib|common|shared/i, 'utility', 'Utility'],
  
  // Validation features
  [/valid|check|verify|validate|sanitize/i, 'core', 'Validation'],
  
  // Caching features
  [/cache|redis|memcached|store/i, 'core', 'Caching'],
  
  // Logging features
  [/log|logger|audit|track/i, 'utility', 'Logging'],
  
  // Configuration features
  [/config|settings|options|env/i, 'utility', 'Configuration'],
  
  // Testing features
  [/test|spec|mock|fixture/i, 'utility', 'Testing'],
];

// ─────────────────────────── Service ───────────────────────────

/**
 * `CodebaseMapper` creates structured maps of codebases for AI navigation.
 *
 * @example
 * ```ts
 * import { FileScanner } from './scanner.js';
 * import { TechMapper } from './tech-mapper.js';
 * import { CodebaseMapper } from './codebase-mapper.js';
 *
 * const scanner = new FileScanner('./my-project');
 * const files = await scanner.scan();
 *
 * const mapper = new TechMapper();
 * const techReport = mapper.analyze(files);
 *
 * const codebaseMapper = new CodebaseMapper();
 * const result = await codebaseMapper.buildCodebaseMap(files, techReport);
 *
 * console.log(`Found ${result.codebaseMap.stats.totalElements} code elements`);
 * console.log(`Extracted ${result.codebaseMap.stats.totalSnippets} snippets`);
 * ```
 */
export class CodebaseMapper extends ContextBuilder {
  private mapOptions: CodebaseMapOptions;

  constructor(options: CodebaseMapOptions = {}) {
    super(options);
    this.mapOptions = {
      ...options,
      maxSnippets: options.maxSnippets ?? 100,
      maxSnippetLines: options.maxSnippetLines ?? 20,
      includePrivate: options.includePrivate ?? false,
      extractAPIEndpoints: options.extractAPIEndpoints ?? true,
      detectFeatures: options.detectFeatures ?? true,
      minConfidence: options.minConfidence ?? 0.5,
    };
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Build a comprehensive codebase map.
   *
   * @param files - The file list from `FileScanner.scan()`.
   * @param techReport - The tech report from `TechMapper.analyze()`.
   * @returns A `CodebaseMapResult` with the complete codebase map.
   */
  public async buildCodebaseMap(
    files: FileInfo[],
    techReport: TechReport
  ): Promise<CodebaseMapResult> {
    // Build the base context first
    const baseContext = await this.build(files, techReport);

    // Extract code elements from all files
    const elements = await this.extractCodeElements(baseContext.files);

    // Extract code snippets
    const snippets = await this.extractCodeSnippets(baseContext.files, elements);

    // Detect file relationships
    const relationships = await this.detectFileRelationships(baseContext.files, elements);

    // Extract API endpoints
    const apiEndpoints = this.mapOptions.extractAPIEndpoints
      ? await this.extractAPIEndpoints(baseContext.files)
      : [];

    // Detect features
    const features = this.mapOptions.detectFeatures
      ? this.detectFeatures(elements, apiEndpoints)
      : [];

    // Build codebase map
    const codebaseMap: CodebaseMap = {
      elements,
      snippets,
      relationships,
      apiEndpoints,
      features,
      stats: {
        totalElements: elements.length,
        totalSnippets: snippets.length,
        totalRelationships: relationships.length,
        totalAPIEndpoints: apiEndpoints.length,
        totalFeatures: features.length,
        filesAnalyzed: baseContext.files.length,
      },
    };

    // Generate high-level summary
    const summary = this.generateSummary(codebaseMap, techReport);

    return {
      ...baseContext,
      codebaseMap,
      summary,
    };
  }

  // ── Code Element Extraction ──────────────────────────────────────

  /**
   * Extract code elements from files.
   */
  private async extractCodeElements(files: FileWithContext[]): Promise<CodeElement[]> {
    const elements: CodeElement[] = [];

    for (const fileWithContext of files) {
      const fileElements = this.extractElementsFromFile(fileWithContext);
      elements.push(...fileElements);
    }

    return elements;
  }

  /**
   * Extract code elements from a single file.
   */
  private extractElementsFromFile(fileWithContext: FileWithContext): CodeElement[] {
    const { file, content } = fileWithContext;
    const elements: CodeElement[] = [];
    const lines = content.split('\n');

    // Get language-specific patterns
    const patterns = LANGUAGE_PATTERNS.get(this.getLanguageFromExtension(file.extension));

    if (!patterns) {
      return elements;
    }

    // Extract different types of elements
    elements.push(...this.extractFunctions(lines, file, patterns));
    elements.push(...this.extractClasses(lines, file, patterns));
    elements.push(...this.extractInterfaces(lines, file, patterns));
    elements.push(...this.extractTypes(lines, file, patterns));
    elements.push(...this.extractEnums(lines, file, patterns));
    elements.push(...this.extractConstants(lines, file, patterns));

    return elements;
  }

  /**
   * Extract functions from file content.
   */
  private extractFunctions(lines: string[], file: FileInfo, patterns: LanguagePatterns): CodeElement[] {
    const elements: CodeElement[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check for function patterns
      if (patterns.function?.test(trimmed)) {
        const match = trimmed.match(patterns.function);
        if (match) {
          elements.push({
            type: 'function',
            name: match[1],
            filePath: file.path,
            startLine: i + 1,
            visibility: this.extractVisibility(trimmed),
            signature: this.extractSignature(trimmed),
            isExported: trimmed.startsWith('export'),
            tags: [],
            confidence: 0.9,
          });
        }
      }

      // Check for arrow function patterns
      if (patterns.arrowFunction?.test(trimmed)) {
        const match = trimmed.match(patterns.arrowFunction);
        if (match) {
          elements.push({
            type: 'function',
            name: match[1],
            filePath: file.path,
            startLine: i + 1,
            visibility: this.extractVisibility(trimmed),
            signature: this.extractSignature(trimmed),
            isExported: trimmed.startsWith('export'),
            tags: ['arrow'],
            confidence: 0.85,
          });
        }
      }
    }

    return elements;
  }

  /**
   * Extract classes from file content.
   */
  private extractClasses(lines: string[], file: FileInfo, patterns: LanguagePatterns): CodeElement[] {
    const elements: CodeElement[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (patterns.class?.test(trimmed)) {
        const match = trimmed.match(patterns.class);
        if (match) {
          elements.push({
            type: 'class',
            name: match[1],
            filePath: file.path,
            startLine: i + 1,
            visibility: this.extractVisibility(trimmed),
            signature: this.extractSignature(trimmed),
            isExported: trimmed.startsWith('export'),
            tags: [],
            confidence: 0.95,
          });
        }
      }

      if (patterns.struct?.test(trimmed)) {
        const match = trimmed.match(patterns.struct);
        if (match) {
          elements.push({
            type: 'class',
            name: match[1],
            filePath: file.path,
            startLine: i + 1,
            visibility: 'public',
            signature: this.extractSignature(trimmed),
            isExported: true,
            tags: ['struct'],
            confidence: 0.95,
          });
        }
      }
    }

    return elements;
  }

  /**
   * Extract interfaces from file content.
   */
  private extractInterfaces(lines: string[], file: FileInfo, patterns: LanguagePatterns): CodeElement[] {
    const elements: CodeElement[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (patterns.interface?.test(trimmed)) {
        const match = trimmed.match(patterns.interface);
        if (match) {
          elements.push({
            type: 'interface',
            name: match[1],
            filePath: file.path,
            startLine: i + 1,
            visibility: 'public',
            signature: this.extractSignature(trimmed),
            isExported: trimmed.startsWith('export'),
            tags: [],
            confidence: 0.95,
          });
        }
      }
    }

    return elements;
  }

  /**
   * Extract type definitions from file content.
   */
  private extractTypes(lines: string[], file: FileInfo, patterns: LanguagePatterns): CodeElement[] {
    const elements: CodeElement[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (patterns.type?.test(trimmed)) {
        const match = trimmed.match(patterns.type);
        if (match) {
          elements.push({
            type: 'type',
            name: match[1],
            filePath: file.path,
            startLine: i + 1,
            visibility: 'public',
            signature: this.extractSignature(trimmed),
            isExported: trimmed.startsWith('export'),
            tags: [],
            confidence: 0.9,
          });
        }
      }
    }

    return elements;
  }

  /**
   * Extract enums from file content.
   */
  private extractEnums(lines: string[], file: FileInfo, patterns: LanguagePatterns): CodeElement[] {
    const elements: CodeElement[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (patterns.enum?.test(trimmed)) {
        const match = trimmed.match(patterns.enum);
        if (match) {
          elements.push({
            type: 'enum',
            name: match[1],
            filePath: file.path,
            startLine: i + 1,
            visibility: 'public',
            signature: this.extractSignature(trimmed),
            isExported: trimmed.startsWith('export'),
            tags: [],
            confidence: 0.9,
          });
        }
      }
    }

    return elements;
  }

  /**
   * Extract constants from file content.
   */
  private extractConstants(lines: string[], file: FileInfo, patterns: LanguagePatterns): CodeElement[] {
    const elements: CodeElement[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Look for constant patterns (const, let, var with uppercase names)
      const constPattern = /^(?:export\s+)?(?:const|let|var)\s+([A-Z_][A-Z0-9_]*)\s*=/;
      const match = trimmed.match(constPattern);
      
      if (match) {
        elements.push({
          type: 'constant',
          name: match[1],
          filePath: file.path,
          startLine: i + 1,
          visibility: trimmed.startsWith('export') ? 'public' : 'internal',
          signature: this.extractSignature(trimmed),
          isExported: trimmed.startsWith('export'),
          tags: [],
          confidence: 0.8,
        });
      }
    }

    return elements;
  }

  // ── Code Snippet Extraction ──────────────────────────────────────

  /**
   * Extract code snippets for AI analysis.
   */
  private async extractCodeSnippets(
    files: FileWithContext[],
    elements: CodeElement[]
  ): Promise<CodeSnippet[]> {
    const snippets: CodeSnippet[] = [];
    const maxSnippets = this.mapOptions.maxSnippets ?? 100;
    const maxLines = this.mapOptions.maxSnippetLines ?? 20;

    // Group elements by file
    const elementsByFile = new Map<string, CodeElement[]>();
    for (const element of elements) {
      const existing = elementsByFile.get(element.filePath);
      if (existing) {
        existing.push(element);
      } else {
        elementsByFile.set(element.filePath, [element]);
      }
    }

    // Extract snippets for each file
    for (const fileWithContext of files) {
      if (snippets.length >= maxSnippets) break;

      const fileElements = elementsByFile.get(fileWithContext.file.path);
      if (!fileElements || fileElements.length === 0) continue;

      // Get the most relevant elements
      const relevantElements = fileElements
        .filter(e => e.confidence >= (this.mapOptions.minConfidence ?? 0.5))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3); // Max 3 snippets per file

      for (const element of relevantElements) {
        if (snippets.length >= maxSnippets) break;

        const snippet = this.extractSnippetForElement(fileWithContext, element, maxLines);
        if (snippet) {
          snippets.push(snippet);
        }
      }
    }

    return snippets;
  }

  /**
   * Extract a snippet for a specific code element.
   */
  private extractSnippetForElement(
    fileWithContext: FileWithContext,
    element: CodeElement,
    maxLines: number
  ): CodeSnippet | null {
    const lines = fileWithContext.content.split('\n');
    const startLine = element.startLine - 1; // Convert to 0-indexed

    if (startLine < 0 || startLine >= lines.length) {
      return null;
    }

    // Extract the snippet with context
    const contextLines = 2; // Lines before and after
    const snippetStart = Math.max(0, startLine - contextLines);
    const snippetEnd = Math.min(lines.length, startLine + maxLines + contextLines);

    const snippetLines = lines.slice(snippetStart, snippetEnd);
    const snippetContent = snippetLines.join('\n');

    return {
      filePath: fileWithContext.file.path,
      content: snippetContent,
      type: element.type,
      description: `${element.type}: ${element.name}`,
      startLine: snippetStart + 1,
      endLine: snippetEnd,
      estimatedTokens: Math.ceil(snippetContent.length / 4),
      relevanceScore: element.confidence,
      context: fileWithContext.file.path,
    };
  }

  // ── File Relationship Detection ──────────────────────────────────────

  /**
   * Detect relationships between files.
   */
  private async detectFileRelationships(
    files: FileWithContext[],
    elements: CodeElement[]
  ): Promise<FileRelationship[]> {
    const relationships: FileRelationship[] = [];

    // Build a map of file to elements
    const elementsByFile = new Map<string, CodeElement[]>();
    for (const element of elements) {
      const existing = elementsByFile.get(element.filePath);
      if (existing) {
        existing.push(element);
      } else {
        elementsByFile.set(element.filePath, [element]);
      }
    }

    // Detect import relationships
    for (const fileWithContext of files) {
      const imports = this.extractImports(fileWithContext.content);
      
      for (const importPath of imports) {
        // Try to find the target file
        const targetFile = this.resolveImportPath(importPath, fileWithContext.file.path, files);
        
        if (targetFile) {
          relationships.push({
            source: fileWithContext.file.path,
            target: targetFile,
            type: 'imports',
            confidence: 0.9,
          });
        }
      }
    }

    return relationships;
  }

  /**
   * Extract import statements from file content.
   */
  private extractImports(content: string): string[] {
    const imports: string[] = [];
    const lines = content.split('\n');

    const importPatterns = [
      /^import\s+.*?from\s+['"`](.*?)['"`]/,
      /^import\s+['"`](.*?)['"`]/,
      /^require\s*\(\s*['"`](.*?)['"`]\s*\)/,
      /^#include\s*[<"`](.*?)[>`"]/,
      /^from\s+['"`](.*?)['"`]\s+import/,
    ];

    for (const line of lines) {
      const trimmed = line.trim();
      
      for (const pattern of importPatterns) {
        const match = trimmed.match(pattern);
        if (match) {
          imports.push(match[1]);
          break;
        }
      }
    }

    return imports;
  }

  /**
   * Resolve an import path to a file path.
   */
  private resolveImportPath(
    importPath: string,
    sourcePath: string,
    files: FileWithContext[]
  ): string | null {
    // Remove relative path components
    const normalized = importPath.replace(/^\.\//, '').replace(/^\.\.\//, '');
    
    // Try to find a matching file
    for (const fileWithContext of files) {
      const filePath = fileWithContext.file.path;
      const fileName = path.basename(filePath);
      
      // Check if the import matches the file name
      if (normalized === fileName || normalized === path.basename(filePath, path.extname(filePath))) {
        return filePath;
      }
      
      // Check if the import matches a directory index
      if (normalized === path.basename(path.dirname(filePath))) {
        return filePath;
      }
    }

    return null;
  }

  // ── API Endpoint Extraction ──────────────────────────────────────

  /**
   * Extract API endpoints from files.
   */
  private async extractAPIEndpoints(files: FileWithContext[]): Promise<APIEndpoint[]> {
    const endpoints: APIEndpoint[] = [];

    for (const fileWithContext of files) {
      const fileEndpoints = this.extractEndpointsFromFile(fileWithContext);
      endpoints.push(...fileEndpoints);
    }

    return endpoints;
  }

  /**
   * Extract API endpoints from a single file.
   */
  private extractEndpointsFromFile(fileWithContext: FileWithContext): APIEndpoint[] {
    const endpoints: APIEndpoint[] = [];
    const { file, content } = fileWithContext;
    const lines = content.split('\n');

    // Get language-specific patterns
    const patterns = LANGUAGE_PATTERNS.get(this.getLanguageFromExtension(file.extension));

    if (!patterns) {
      return endpoints;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check for route patterns
      if (patterns.apiRoute?.test(trimmed)) {
        const match = trimmed.match(patterns.apiRoute);
        if (match) {
          const method = this.extractHTTPMethod(trimmed);
          endpoints.push({
            method: method || 'UNKNOWN',
            path: match[2] || match[1],
            filePath: file.path,
            lineNumber: i + 1,
            isPublic: true,
            tags: [],
          });
        }
      }

      if (patterns.apiEndpoint?.test(trimmed)) {
        const match = trimmed.match(patterns.apiEndpoint);
        if (match) {
          const method = this.extractHTTPMethodFromRouter(match[1]);
          endpoints.push({
            method: method || 'UNKNOWN',
            path: match[2],
            filePath: file.path,
            lineNumber: i + 1,
            isPublic: true,
            tags: [],
          });
        }
      }
    }

    return endpoints;
  }

  /**
   * Extract HTTP method from a route line.
   */
  private extractHTTPMethod(line: string): APIEndpoint['method'] {
    const methodMatch = line.match(/@(Get|Post|Put|Delete|Patch|Head|Options)/i);
    if (methodMatch) {
      return methodMatch[1].toUpperCase() as APIEndpoint['method'];
    }
    return 'UNKNOWN';
  }

  /**
   * Extract HTTP method from router method call.
   */
  private extractHTTPMethodFromRouter(method: string): APIEndpoint['method'] {
    const methodUpper = method.toUpperCase();
    if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(methodUpper)) {
      return methodUpper as APIEndpoint['method'];
    }
    return 'UNKNOWN';
  }

  // ── Feature Detection ──────────────────────────────────────

  /**
   * Detect features from code elements and API endpoints.
   */
  private detectFeatures(elements: CodeElement[], apiEndpoints: APIEndpoint[]): Feature[] {
    const features: Feature[] = [];
    const featureMap = new Map<string, Feature>();

    // Detect features from elements
    for (const element of elements) {
      for (const [pattern, category, featureName] of FEATURE_PATTERNS) {
        if (pattern.test(element.name) || pattern.test(element.filePath)) {
          const key = `${category}:${featureName}`;
          
          let feature = featureMap.get(key);
          if (!feature) {
            feature = {
              name: featureName,
              description: `${featureName} functionality`,
              files: [],
              elements: [],
              confidence: 0.7,
              category,
            };
            featureMap.set(key, feature);
          }
          
          if (!feature.files.includes(element.filePath)) {
            feature.files.push(element.filePath);
          }
          feature.elements.push(element);
          feature.confidence = Math.min(1, feature.confidence + 0.1);
        }
      }
    }

    // Detect features from API endpoints
    for (const endpoint of apiEndpoints) {
      const key = `api:API`;
      
      let feature = featureMap.get(key);
      if (!feature) {
        feature = {
          name: 'API',
          description: 'REST API endpoints',
          files: [],
          elements: [],
          confidence: 0.8,
          category: 'api',
        };
        featureMap.set(key, feature);
      }
      
      if (!feature.files.includes(endpoint.filePath)) {
        feature.files.push(endpoint.filePath);
      }
      feature.confidence = Math.min(1, feature.confidence + 0.05);
    }

    return Array.from(featureMap.values());
  }

  // ── Summary Generation ──────────────────────────────────────

  /**
   * Generate a high-level summary of the codebase.
   */
  private generateSummary(codebaseMap: CodebaseMap, techReport: TechReport): CodebaseMapResult['summary'] {
    const mainComponents = this.identifyMainComponents(codebaseMap);
    const keyFeatures = codebaseMap.features
      .filter(f => f.confidence > 0.7)
      .map(f => f.name)
      .slice(0, 5);

    return {
      architecture: this.inferArchitecture(codebaseMap, techReport),
      mainComponents,
      keyFeatures,
      apiStyle: codebaseMap.apiEndpoints.length > 0 ? 'REST' : undefined,
    };
  }

  /**
   * Infer the architecture style of the codebase.
   */
  private inferArchitecture(codebaseMap: CodebaseMap, techReport: TechReport): string {
    const hasAPI = codebaseMap.apiEndpoints.length > 0;
    const hasUI = codebaseMap.elements.some(e => e.type === 'component');
    const hasDatabase = codebaseMap.features.some(f => f.category === 'core' && f.name === 'Database');

    if (hasAPI && hasUI) {
      return 'Full-stack web application';
    } else if (hasAPI) {
      return 'API/Backend service';
    } else if (hasUI) {
      return 'Frontend application';
    } else if (hasDatabase) {
      return 'Data processing application';
    } else {
      return 'Library/Utility';
    }
  }

  /**
   * Identify main components of the codebase.
   */
  private identifyMainComponents(codebaseMap: CodebaseMap): string[] {
    const components: string[] = [];

    // Group elements by directory
    const dirCounts = new Map<string, number>();
    for (const element of codebaseMap.elements) {
      const dir = path.dirname(element.filePath);
      const dirName = path.basename(dir);
      dirCounts.set(dirName, (dirCounts.get(dirName) || 0) + 1);
    }

    // Get top directories
    const sortedDirs = Array.from(dirCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dir]) => dir);

    return sortedDirs;
  }

  // ── Helper Methods ──────────────────────────────────────

  /**
   * Get language identifier from file extension.
   */
  private getLanguageFromExtension(extension: string): string {
    const langMap: ReadonlyMap<string, string> = new Map([
      ['ts', 'typescript'],
      ['tsx', 'typescript'],
      ['js', 'javascript'],
      ['jsx', 'javascript'],
      ['py', 'python'],
      ['rs', 'rust'],
      ['go', 'go'],
      ['java', 'java'],
      ['kt', 'java'],
      ['cs', 'java'],
    ]);

    return langMap.get(extension.toLowerCase()) || 'unknown';
  }

  /**
   * Extract visibility from a line of code.
   */
  private extractVisibility(line: string): Visibility {
    if (line.includes('private')) return 'private';
    if (line.includes('protected')) return 'protected';
    if (line.includes('public')) return 'public';
    if (line.includes('internal')) return 'internal';
    return 'unknown';
  }

  /**
   * Extract signature from a line of code.
   */
  private extractSignature(line: string): string {
    // Remove leading/trailing whitespace and truncate if too long
    const trimmed = line.trim();
    return trimmed.length > 100 ? trimmed.slice(0, 100) + '...' : trimmed;
  }

  /**
   * Get a formatted summary of the codebase map.
   */
  public getCodebaseMapSummary(result: CodebaseMapResult): string {
    const lines: string[] = [
      '# Codebase Map Summary',
      '',
      `Architecture: ${result.summary.architecture}`,
      `Main Components: ${result.summary.mainComponents.join(', ')}`,
      `Key Features: ${result.summary.keyFeatures.join(', ')}`,
      '',
      '## Statistics',
      `- Total Elements: ${result.codebaseMap.stats.totalElements}`,
      `- Total Snippets: ${result.codebaseMap.stats.totalSnippets}`,
      `- Total Relationships: ${result.codebaseMap.stats.totalRelationships}`,
      `- Total API Endpoints: ${result.codebaseMap.stats.totalAPIEndpoints}`,
      `- Total Features: ${result.codebaseMap.stats.totalFeatures}`,
      `- Files Analyzed: ${result.codebaseMap.stats.filesAnalyzed}`,
      '',
    ];

    if (result.codebaseMap.apiEndpoints.length > 0) {
      lines.push('## API Endpoints');
      for (const endpoint of result.codebaseMap.apiEndpoints.slice(0, 10)) {
        lines.push(`- ${endpoint.method} ${endpoint.path} (${path.basename(endpoint.filePath)})`);
      }
      if (result.codebaseMap.apiEndpoints.length > 10) {
        lines.push(`  ... and ${result.codebaseMap.apiEndpoints.length - 10} more`);
      }
      lines.push('');
    }

    if (result.codebaseMap.features.length > 0) {
      lines.push('## Detected Features');
      for (const feature of result.codebaseMap.features) {
        lines.push(`- ${feature.name} (${feature.category}, confidence: ${feature.confidence.toFixed(2)})`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
