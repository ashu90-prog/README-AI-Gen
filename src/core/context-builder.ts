/**
 * ContextBuilder — Selects and prepares source code for AI analysis.
 *
 * Consumes the `FileInfo[]` produced by `FileScanner` and the `TechReport`
 * from `TechMapper` to intelligently select which source files to include
 * in the AI context window.
 *
 * Features:
 *   • Scores files based on relevance (core logic vs. boilerplate)
 *   • Handles token limit constraints by selecting the most relevant files
 *   • Truncates large files to fit within token budgets
 *   • Adapts scoring based on detected project types
 *   • Provides detailed statistics on what was included/excluded
 *
 * @module core/context-builder
 */

import fs from 'fs-extra';
import path from 'path';
import { FileInfo } from './scanner.js';
import { TechReport, ProjectType } from './tech-mapper.js';

// ─────────────────────────── Types ───────────────────────────

/**
 * Scoring criteria for a file.
 */
export interface FileScore {
  /** The file being scored */
  file: FileInfo;
  /** Relevance score (higher = more important) */
  score: number;
  /** Estimated token count for this file */
  estimatedTokens: number;
  /** Reason for the score (for debugging) */
  reason: string;
}

/**
 * Truncation strategy for large files.
 */
export type TruncationStrategy = 'none' | 'head' | 'tail' | 'middle' | 'smart';

/**
 * Configuration for context building.
 */
export interface ContextBuilderOptions {
  /** Maximum tokens to include in the context (default: 128000) */
  maxTokens?: number;
  /** Truncation strategy for files that exceed individual limits */
  truncationStrategy?: TruncationStrategy;
  /** Maximum tokens per file (default: 4000) */
  maxTokensPerFile?: number;
  /** Whether to include test files (default: false) */
  includeTests?: boolean;
  /** Whether to include configuration files (default: false) */
  includeConfig?: boolean;
  /** Custom scoring weights */
  weights?: ScoringWeights;
  /** Custom file patterns to always include */
  alwaysInclude?: RegExp[];
  /** Custom file patterns to always exclude */
  alwaysExclude?: RegExp[];
}

/**
 * Weights for different scoring factors.
 */
export interface ScoringWeights {
  /** Weight for directory location */
  directoryWeight: number;
  /** Weight for file extension */
  extensionWeight: number;
  /** Weight for file name patterns */
  namePatternWeight: number;
  /** Weight for file size */
  sizeWeight: number;
  /** Weight for project type relevance */
  projectTypeWeight: number;
}

/**
 * A file with its content and metadata.
 */
export interface FileWithContext {
  /** The file information */
  file: FileInfo;
  /** The file content (possibly truncated) */
  content: string;
  /** Whether the content was truncated */
  truncated: boolean;
  /** Original token count */
  originalTokens: number;
  /** Actual token count after truncation */
  actualTokens: number;
  /** The score for this file */
  score: number;
}

/**
 * Result of context building.
 */
export interface ContextBuildResult {
  /** Files selected for the context */
  files: FileWithContext[];
  /** Total tokens in the context */
  totalTokens: number;
  /** Number of files included */
  fileCount: number;
  /** Number of files excluded */
  excludedCount: number;
  /** Files that were excluded (with reasons) */
  excludedFiles: Array<{ file: FileInfo; reason: string }>;
  /** Statistics about the build process */
  stats: {
    /** Total files scanned */
    totalFiles: number;
    /** Total tokens available */
    totalTokensAvailable: number;
    /** Percentage of token budget used */
    tokenUsagePercent: number;
    /** Average score of included files */
    averageScore: number;
    /** Number of files truncated */
    truncatedCount: number;
  };
}

// ─────────────────── Default Configuration ──────────────────

/**
 * Default scoring weights.
 */
const DEFAULT_WEIGHTS: ScoringWeights = {
  directoryWeight: 30,
  extensionWeight: 25,
  namePatternWeight: 20,
  sizeWeight: 15,
  projectTypeWeight: 10,
};

/**
 * Default options.
 */
const DEFAULT_OPTIONS: ContextBuilderOptions = {
  maxTokens: 128000,
  truncationStrategy: 'smart',
  maxTokensPerFile: 4000,
  includeTests: false,
  includeConfig: false,
  weights: DEFAULT_WEIGHTS,
};

// ─────────────────── Directory Scoring ──────────────────

/**
 * Directory patterns and their scores.
 * Higher scores = more likely to contain core logic.
 */
const DIRECTORY_SCORES: ReadonlyMap<string, number> = new Map([
  // Core source directories
  ['src', 100],
  ['lib', 95],
  ['app', 90],
  ['core', 95],
  ['main', 85],
  ['server', 85],
  ['client', 80],
  ['api', 85],
  ['handlers', 80],
  ['controllers', 80],
  ['services', 85],
  ['models', 75],
  ['views', 70],
  ['components', 75],
  ['utils', 70],
  ['helpers', 70],
  ['shared', 75],
  ['common', 70],
  
  // Script directories (high priority for command inference)
  ['scripts', 90],
  ['bin', 85],
  ['tools', 75],
  ['hack', 70],
  
  // Test directories (lower priority unless explicitly included)
  ['test', 20],
  ['tests', 20],
  ['__tests__', 20],
  ['spec', 20],
  ['specs', 20],
  
  // Build/output directories (very low priority)
  ['dist', 5],
  ['build', 5],
  ['out', 5],
  ['output', 5],
  
  // Config directories (low priority)
  ['config', 30],
  ['configs', 30],
  ['.config', 30],
  
  // Documentation (low priority)
  ['docs', 25],
  ['doc', 25],
  ['documentation', 25],
  
  // Examples (low priority)
  ['examples', 30],
  ['example', 30],
  ['samples', 30],
]);

// ─────────────────── Extension Scoring ──────────────────

/**
 * File extension scores.
 * Higher scores = more likely to contain core logic.
 */
const EXTENSION_SCORES: ReadonlyMap<string, number> = new Map([
  // High-value source files
  ['ts', 100],
  ['tsx', 95],
  ['js', 95],
  ['jsx', 90],
  ['py', 100],
  ['rs', 100],
  ['go', 100],
  ['java', 95],
  ['kt', 95],
  ['kts', 90],
  ['scala', 90],
  ['cs', 95],
  ['cpp', 90],
  ['cxx', 90],
  ['cc', 90],
  ['hpp', 85],
  ['h', 80],
  ['c', 85],
  
  // Web files
  ['vue', 85],
  ['svelte', 85],
  ['astro', 80],
  
  // Build files (high priority for command inference)
  ['makefile', 85],
  ['mk', 80],
  
  // Config files (medium priority for command inference)
  ['json', 50], // Increased for package.json scripts
  ['yaml', 40],
  ['yml', 40],
  ['toml', 45], // Increased for Cargo.toml, pyproject.toml
  ['xml', 40], // Increased for pom.xml
  ['ini', 35],
  ['cfg', 35],
  ['conf', 35],
  
  // Documentation (lower priority)
  ['md', 20],
  ['mdx', 20],
  ['rst', 20],
  ['txt', 15],
  
  // Styles (medium priority)
  ['css', 50],
  ['scss', 50],
  ['sass', 50],
  ['less', 50],
  
  // Templates (medium priority)
  ['html', 40],
  ['htm', 40],
  ['ejs', 45],
  ['hbs', 45],
  ['pug', 45],
  ['jade', 45],
  
  // Shell scripts (high priority for command inference)
  ['sh', 85],
  ['bash', 85],
  ['zsh', 80],
  ['ps1', 75],
  ['bat', 70],
  ['cmd', 70],
]);

// ─────────────────── Name Pattern Scoring ──────────────────

/**
 * File name patterns and their scores.
 */
const NAME_PATTERNS: ReadonlyArray<readonly [RegExp, number, string]> = [
  // Core entry points (highest priority)
  [/^(index|main|app|server|client|entry|init)$/i, 100, 'Entry point'],
  [/^(index|main|app|server|client|entry|init)\.(ts|js|py|rs|go|java|cs)$/i, 100, 'Entry point'],
  
  // CLI entry points
  [/^(cli|commander|cmd)$/i, 95, 'CLI entry point'],
  [/^(cli|commander|cmd)\.(ts|js|py|rs|go)$/i, 95, 'CLI entry point'],
  
  // Django/Flask entry points
  [/^manage\.py$/, 100, 'Django entry point'],
  [/^wsgi\.py$/, 90, 'WSGI entry point'],
  [/^asgi\.py$/, 90, 'ASGI entry point'],
  
  // Rust entry points
  [/^main\.rs$/, 100, 'Rust entry point'],
  [/^lib\.rs$/, 90, 'Rust library entry'],
  
  // Go entry points
  [/^main\.go$/, 100, 'Go entry point'],
  
  // Java entry points
  [/^Main\.java$/, 100, 'Java entry point'],
  [/^Application\.java$/, 90, 'Spring Boot entry'],
  
  // Core modules
  [/^(core|base|common|shared)$/i, 90, 'Core module'],
  
  // Important modules
  [/^(controller|handler|service|model|entity|repository|dao)$/i, 85, 'Business logic'],
  [/^(component|view|page|screen)$/i, 80, 'UI component'],
  [/^(util|helper|tool|lib)$/i, 70, 'Utility'],
  
  // Configuration
  [/^(config|settings|options|env)$/i, 40, 'Configuration'],
  
  // Types/interfaces
  [/^(types?|interfaces?|enums?|constants?)$/i, 75, 'Type definitions'],
  
  // Tests (lower priority)
  [/\.test\./, 20, 'Test file'],
  [/\.spec\./, 20, 'Test file'],
  [/^test/, 20, 'Test file'],
  [/^spec/, 20, 'Test file'],
  
  // Examples
  [/^example/, 30, 'Example file'],
  
  // Documentation
  [/^(readme|changelog|contributing|license)$/i, 15, 'Documentation'],
];

// ─────────────────── Project Type Relevance ──────────────────

/**
 * Project type to file extension relevance mapping.
 */
const PROJECT_TYPE_RELEVANCE: ReadonlyMap<string, Set<string>> = new Map([
  ['nodejs', new Set(['ts', 'tsx', 'js', 'jsx', 'json', 'mjs', 'cjs'])],
  ['typescript', new Set(['ts', 'tsx', 'js', 'jsx'])],
  ['python', new Set(['py', 'pyw', 'pyi'])],
  ['rust', new Set(['rs', 'toml'])],
  ['go', new Set(['go', 'mod'])],
  ['java-maven', new Set(['java', 'xml'])],
  ['java-gradle', new Set(['java', 'gradle', 'kts'])],
  ['kotlin-gradle', new Set(['kt', 'kts', 'gradle'])],
  ['dotnet', new Set(['cs', 'vb', 'fs', 'xaml'])],
  ['ruby', new Set(['rb', 'erb'])],
  ['php', new Set(['php', 'json'])],
  ['swift', new Set(['swift'])],
  ['dart', new Set(['dart', 'yaml'])],
  ['elixir', new Set(['ex', 'exs'])],
]);

// ─────────────────────────── Service ───────────────────────────

/**
 * `ContextBuilder` intelligently selects and prepares source files for AI analysis.
 *
 * @example
 * ```ts
 * import { FileScanner } from './scanner.js';
 * import { TechMapper } from './tech-mapper.js';
 * import { ContextBuilder } from './context-builder.js';
 *
 * const scanner = new FileScanner('./my-project');
 * const files = await scanner.scan();
 *
 * const mapper = new TechMapper();
 * const techReport = mapper.analyze(files);
 *
 * const builder = new ContextBuilder();
 * const result = await builder.build(files, techReport);
 *
 * console.log(`Included ${result.fileCount} files with ${result.totalTokens} tokens`);
 * ```
 */
export class ContextBuilder {
  private options: ContextBuilderOptions;

  constructor(options: ContextBuilderOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    if (!this.options.weights) {
      this.options.weights = DEFAULT_WEIGHTS;
    }
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Build the context by selecting and preparing files for AI analysis.
   *
   * @param files - The file list from `FileScanner.scan()`.
   * @param techReport - The tech report from `TechMapper.analyze()`.
   * @returns A `ContextBuildResult` with selected files and statistics.
   */
  public async build(
    files: FileInfo[],
    techReport: TechReport
  ): Promise<ContextBuildResult> {
    const weights = this.options.weights!;

    // Step 1: Score all files
    const scoredFiles = this.scoreFiles(files, techReport, weights);

    // Step 2: Filter out excluded files
    const filteredFiles = this.filterFiles(scoredFiles);

    // Step 3: Sort by score (descending)
    filteredFiles.sort((a, b) => b.score - a.score);

    // Step 4: Select files within token budget
    const selectedFiles = this.selectFiles(filteredFiles);

    // Step 5: Read and truncate file contents
    const filesWithContext = await this.prepareFiles(selectedFiles);

    // Step 6: Build result
    return this.buildResult(filesWithContext, files.length);
  }

  // ── File Scoring ──────────────────────────────────────────────

  /**
   * Score all files based on multiple factors.
   */
  private scoreFiles(
    files: FileInfo[],
    techReport: TechReport,
    weights: ScoringWeights
  ): FileScore[] {
    const projectTypes = new Set(techReport.projectTypes.map(pt => pt.id));

    return files.map(file => {
      let score = 0;
      const reasons: string[] = [];

      // Directory score
      const dirScore = this.getDirectoryScore(file.path);
      score += dirScore * (weights.directoryWeight / 100);
      if (dirScore > 50) reasons.push(`directory: ${dirScore}`);

      // Extension score
      const extScore = this.getExtensionScore(file.extension);
      score += extScore * (weights.extensionWeight / 100);
      if (extScore > 50) reasons.push(`extension: ${extScore}`);

      // Name pattern score
      const nameScore = this.getNamePatternScore(file.name);
      score += nameScore * (weights.namePatternWeight / 100);
      if (nameScore > 50) reasons.push(`name: ${nameScore}`);

      // Size score (moderate size is better)
      const sizeScore = this.getSizeScore(file.path);
      score += sizeScore * (weights.sizeWeight / 100);
      if (sizeScore > 50) reasons.push(`size: ${sizeScore}`);

      // Project type relevance
      const typeScore = this.getProjectTypeScore(file.extension, projectTypes);
      score += typeScore * (weights.projectTypeWeight / 100);
      if (typeScore > 50) reasons.push(`project-type: ${typeScore}`);

      // Estimate tokens
      const estimatedTokens = this.estimateTokens(file.path);

      return {
        file,
        score: Math.round(score * 100) / 100,
        estimatedTokens,
        reason: reasons.join(', ') || 'default',
      };
    });
  }

  /**
   * Get the directory score for a file.
   */
  private getDirectoryScore(filePath: string): number {
    const dirPath = path.dirname(filePath);
    const dirName = path.basename(dirPath);
    const parts = dirPath.split(path.sep);

    // Check each directory in the path
    let maxScore = 50; // Default score

    for (const part of parts) {
      const score = DIRECTORY_SCORES.get(part);
      if (score !== undefined && score > maxScore) {
        maxScore = score;
      }
    }

    return maxScore;
  }

  /**
   * Get the extension score for a file.
   */
  private getExtensionScore(extension: string): number {
    return EXTENSION_SCORES.get(extension.toLowerCase()) ?? 50;
  }

  /**
   * Get the name pattern score for a file.
   */
  private getNamePatternScore(fileName: string): number {
    for (const [pattern, score, _reason] of NAME_PATTERNS) {
      if (pattern.test(fileName)) {
        return score;
      }
    }
    return 50; // Default score
  }

  /**
   * Get the size score for a file.
   * Moderate sizes (100-500 lines) get higher scores.
   */
  private getSizeScore(filePath: string): number {
    try {
      const stats = fs.statSync(filePath);
      const sizeKB = stats.size / 1024;

      // Very small files (< 1KB) might be trivial
      if (sizeKB < 1) return 30;
      
      // Very large files (> 100KB) might be generated or data
      if (sizeKB > 100) return 40;
      
      // Moderate size is ideal
      if (sizeKB >= 1 && sizeKB <= 50) return 80;
      
      return 60;
    } catch {
      return 50;
    }
  }

  /**
   * Get the project type relevance score for a file.
   */
  private getProjectTypeScore(extension: string, projectTypes: Set<string>): number {
    if (projectTypes.size === 0) return 50;

    for (const typeId of projectTypes) {
      const relevantExtensions = PROJECT_TYPE_RELEVANCE.get(typeId);
      if (relevantExtensions && relevantExtensions.has(extension.toLowerCase())) {
        return 100;
      }
    }

    return 50;
  }

  /**
   * Estimate the token count for a file.
   * Rough estimate: 1 token ≈ 4 characters.
   */
  private estimateTokens(filePath: string): number {
    try {
      const stats = fs.statSync(filePath);
      return Math.ceil(stats.size / 4);
    } catch {
      return 0;
    }
  }

  // ── File Filtering ──────────────────────────────────────────────

  /**
   * Filter out files that should be excluded.
   */
  private filterFiles(scoredFiles: FileScore[]): FileScore[] {
    const result: FileScore[] = [];
    const excluded: Array<{ file: FileInfo; reason: string }> = [];

    for (const scored of scoredFiles) {
      const { file } = scored;

      // Check always-exclude patterns
      if (this.options.alwaysExclude) {
        for (const pattern of this.options.alwaysExclude) {
          if (pattern.test(file.name) || pattern.test(file.path)) {
            excluded.push({ file, reason: 'matched exclude pattern' });
            continue;
          }
        }
      }

      // Check test files
      if (!this.options.includeTests && this.isTestFile(file)) {
        excluded.push({ file, reason: 'test file' });
        continue;
      }

      // Check config files
      if (!this.options.includeConfig && this.isConfigFile(file)) {
        excluded.push({ file, reason: 'config file' });
        continue;
      }

      // Check always-include patterns
      let alwaysInclude = false;
      if (this.options.alwaysInclude) {
        for (const pattern of this.options.alwaysInclude) {
          if (pattern.test(file.name) || pattern.test(file.path)) {
            alwaysInclude = true;
            break;
          }
        }
      }

      if (alwaysInclude) {
        result.push(scored);
      } else {
        result.push(scored);
      }
    }

    return result;
  }

  /**
   * Check if a file is a test file.
   */
  private isTestFile(file: FileInfo): boolean {
    const testPatterns = [
      /\.test\./,
      /\.spec\./,
      /^test/,
      /^spec/,
      /__tests__/,
      /\.test\./i,
      /\.spec\./i,
    ];

    for (const pattern of testPatterns) {
      if (pattern.test(file.name) || pattern.test(file.path)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a file is a config file.
   */
  private isConfigFile(file: FileInfo): boolean {
    const configExtensions = [
      'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'cfg', 'conf',
      'env', 'config', 'lock',
    ];

    return configExtensions.includes(file.extension.toLowerCase()) ||
           file.name.includes('config') ||
           file.name.includes('.env');
  }

  // ── File Selection ──────────────────────────────────────────────

  /**
   * Select files within the token budget.
   */
  private selectFiles(scoredFiles: FileScore[]): FileScore[] {
    const maxTokens = this.options.maxTokens ?? DEFAULT_OPTIONS.maxTokens!;
    const maxPerFile = this.options.maxTokensPerFile ?? DEFAULT_OPTIONS.maxTokensPerFile!;
    const selected: FileScore[] = [];
    let totalTokens = 0;

    for (const scored of scoredFiles) {
      const tokens = Math.min(scored.estimatedTokens, maxPerFile);

      if (totalTokens + tokens <= maxTokens) {
        selected.push(scored);
        totalTokens += tokens;
      } else {
        // Try to fit a smaller portion of the file
        const remainingTokens = maxTokens - totalTokens;
        if (remainingTokens > 100) { // Only include if we have meaningful space
          selected.push({
            ...scored,
            estimatedTokens: remainingTokens,
          });
          totalTokens = maxTokens;
        }
        break;
      }
    }

    return selected;
  }

  // ── File Preparation ──────────────────────────────────────────────

  /**
   * Read and truncate file contents.
   */
  private async prepareFiles(scoredFiles: FileScore[]): Promise<FileWithContext[]> {
    const maxPerFile = this.options.maxTokensPerFile ?? DEFAULT_OPTIONS.maxTokensPerFile!;
    const strategy = this.options.truncationStrategy ?? DEFAULT_OPTIONS.truncationStrategy!;

    const results: FileWithContext[] = [];

    for (const scored of scoredFiles) {
      try {
        const content = await fs.readFile(scored.file.path, 'utf-8');
        const originalTokens = this.estimateTokensFromContent(content);

        let truncatedContent = content;
        let truncated = false;
        let actualTokens = originalTokens;

        if (originalTokens > maxPerFile) {
          truncated = true;
          truncatedContent = this.truncateContent(content, maxPerFile, strategy);
          actualTokens = this.estimateTokensFromContent(truncatedContent);
        }

        results.push({
          file: scored.file,
          content: truncatedContent,
          truncated,
          originalTokens,
          actualTokens,
          score: scored.score,
        });
      } catch (error) {
        // Skip files that can't be read
        console.warn(`Failed to read file: ${scored.file.path}`);
      }
    }

    return results;
  }

  /**
   * Estimate tokens from content.
   */
  private estimateTokensFromContent(content: string): number {
    return Math.ceil(content.length / 4);
  }

  /**
   * Truncate content based on strategy.
   */
  private truncateContent(
    content: string,
    maxTokens: number,
    strategy: TruncationStrategy
  ): string {
    const maxChars = maxTokens * 4;
    const lines = content.split('\n');

    switch (strategy) {
      case 'none':
        return content;

      case 'head':
        return content.slice(0, maxChars) + '\n\n... [truncated]';

      case 'tail':
        return '... [truncated]\n\n' + content.slice(-maxChars);

      case 'middle':
        const headLines = lines.slice(0, Math.floor(lines.length / 2));
        const tailLines = lines.slice(Math.floor(lines.length / 2));
        const headContent = headLines.join('\n');
        const tailContent = tailLines.join('\n');
        const halfChars = Math.floor(maxChars / 2);
        return (
          headContent.slice(0, halfChars) +
          '\n\n... [truncated] ...\n\n' +
          tailContent.slice(-halfChars)
        );

      case 'smart':
        return this.smartTruncate(content, maxTokens);

      default:
        return content.slice(0, maxChars) + '\n\n... [truncated]';
    }
  }

  /**
   * Smart truncation that tries to keep meaningful code.
   */
  private smartTruncate(content: string, maxTokens: number): string {
    const maxChars = maxTokens * 4;
    const lines = content.split('\n');

    // Try to keep imports, exports, and main functions
    const importLines: string[] = [];
    const exportLines: string[] = [];
    const mainLines: string[] = [];
    const otherLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('import') || trimmed.startsWith('require') || trimmed.startsWith('#include')) {
        importLines.push(line);
      } else if (trimmed.startsWith('export') || trimmed.startsWith('module.exports')) {
        exportLines.push(line);
      } else if (trimmed.startsWith('function') || trimmed.startsWith('class') || trimmed.startsWith('def ') || trimmed.startsWith('func ') || trimmed.startsWith('fn ')) {
        mainLines.push(line);
      } else {
        otherLines.push(line);
      }
    }

    // Build result prioritizing important lines
    let result = [...importLines, ...exportLines, ...mainLines, ...otherLines];
    let resultContent = result.join('\n');

    if (resultContent.length > maxChars) {
      resultContent = resultContent.slice(0, maxChars) + '\n\n... [truncated]';
    }

    return resultContent;
  }

  // ── Result Building ──────────────────────────────────────────────

  /**
   * Build the final result.
   */
  private buildResult(
    filesWithContext: FileWithContext[],
    totalFilesScanned: number
  ): ContextBuildResult {
    const totalTokens = filesWithContext.reduce((sum, f) => sum + f.actualTokens, 0);
    const truncatedCount = filesWithContext.filter(f => f.truncated).length;
    const averageScore = filesWithContext.length > 0
      ? filesWithContext.reduce((sum, f) => sum + f.score, 0) / filesWithContext.length
      : 0;

    const maxTokens = this.options.maxTokens ?? DEFAULT_OPTIONS.maxTokens!;

    return {
      files: filesWithContext,
      totalTokens,
      fileCount: filesWithContext.length,
      excludedCount: totalFilesScanned - filesWithContext.length,
      excludedFiles: [], // Would need to track during filtering
      stats: {
        totalFiles: totalFilesScanned,
        totalTokensAvailable: maxTokens,
        tokenUsagePercent: (totalTokens / maxTokens) * 100,
        averageScore: Math.round(averageScore * 100) / 100,
        truncatedCount,
      },
    };
  }

  // ── Helpers ──────────────────────────────────────────────

  /**
   * Get the context as a single string (for debugging or logging).
   */
  public async getContextString(
    files: FileInfo[],
    techReport: TechReport
  ): Promise<string> {
    const result = await this.build(files, techReport);
    
    const lines: string[] = [
      `# Context Summary`,
      `# Files: ${result.fileCount} / ${result.stats.totalFiles}`,
      `# Tokens: ${result.totalTokens} / ${result.stats.totalTokensAvailable} (${result.stats.tokenUsagePercent.toFixed(1)}%)`,
      `# Average Score: ${result.stats.averageScore}`,
      `# Truncated: ${result.stats.truncatedCount}`,
      ``,
    ];

    for (const fileWithContext of result.files) {
      lines.push(`## File: ${fileWithContext.file.path}`);
      lines.push(`# Score: ${fileWithContext.score}, Tokens: ${fileWithContext.actualTokens}${fileWithContext.truncated ? ' (truncated)' : ''}`);
      lines.push('');
      lines.push(fileWithContext.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }
}
