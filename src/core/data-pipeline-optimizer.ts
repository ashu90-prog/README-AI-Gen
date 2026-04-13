/**
 * DataPipelineOptimizer — Optimizes and cleans data for Markdown Engine consumption.
 *
 * This module provides utilities to transform, flatten, and serialize data structures
 * from the scanning pipeline into clean, accessible formats for the Markdown Engine.
 *
 * Features:
 *   • Converts Maps to serializable arrays
 *   • Flattens nested structures
 *   • Normalizes data types
 *   • Removes redundant fields
 *   • Provides helper methods for data transformation
 *
 * @module core/data-pipeline-optimizer
 */

import path from 'path';
import { FileInfo } from './scanner.js';
import { TechReport, ProjectType, LanguageInfo } from './tech-mapper.js';
import { HarvestResult, Dependency, DependencyType } from './data-harvester.js';
import { ProjectMetadata, AuthorInfo, LicenseInfo } from './metadata-extractor.js';
import { DependencySummary, DependencyCategory } from './dependency-mapper.js';
import { ContextBuildResult, FileWithContext } from './context-builder.js';
import { CommandContextResult, DetectedCommand, EntryPoint, ScriptFile, BuildConfig } from './command-context-builder.js';
import { CodebaseMapResult, CodeElement, CodeSnippet, APIEndpoint, Feature } from './codebase-mapper.js';

// ─────────────────────────── Types ───────────────────────────

/**
 * Serializable language data (converted from Map).
 */
export interface SerializableLanguage {
  name: string;
  badgeSlug: string;
  color: string;
  fileCount: number;
}

/**
 * Serializable dependency data (converted from Map).
 */
export interface SerializableDependency {
  name: string;
  version?: string;
  type: DependencyType;
  source: string;
}

/**
 * Serializable command data (converted from Map).
 */
export interface SerializableCommand {
  type: string;
  command: string;
  description?: string;
  source: string;
  lineNumber?: number;
  confidence: number;
}

/**
 * Optimized and flattened project data for Markdown Engine.
 */
export interface OptimizedProjectData {
  /** Basic project information */
  metadata: {
    name?: string;
    version?: string;
    description?: string;
    authors: Array<{ name?: string; email?: string; url?: string }>;
    license?: { spdx?: string; name?: string };
    repository?: { type?: string; url?: string };
    homepage?: string;
    keywords: string[];
  };

  /** Technology stack information */
  techStack: {
    projectTypes: Array<{
      id: string;
      label: string;
      badgeSlug: string;
      color: string;
      detectedBy: string;
    }>;
    languages: SerializableLanguage[];
    totalFiles: number;
  };

  /** Dependency information */
  dependencies: {
    byCategory: Array<{
      category: string;
      items: string[];
    }>;
    byType: Array<{
      type: string;
      items: SerializableDependency[];
    }>;
    totalDependencies: number;
  };

  /** Command information */
  commands: {
    byType: Array<{
      type: string;
      items: SerializableCommand[];
    }>;
    entryPoints: Array<{
      path: string;
      type: string;
      confidence: number;
    }>;
    scriptFiles: Array<{
      path: string;
      scriptType: string;
      commandCount: number;
    }>;
    buildConfigs: Array<{
      type: string;
      source: string;
      commandCount: number;
    }>;
    totalCommands: number;
  };

  /** Codebase structure information */
  codebase: {
    elements: Array<{
      type: string;
      name: string;
      filePath: string;
      startLine: number;
      visibility: string;
      isExported: boolean;
      confidence: number;
    }>;
    apiEndpoints: Array<{
      method: string;
      path: string;
      filePath: string;
      lineNumber: number;
      isPublic: boolean;
    }>;
    features: Array<{
      name: string;
      description: string;
      category: string;
      confidence: number;
      fileCount: number;
    }>;
    relationships: Array<{
      source: string;
      target: string;
      type: string;
      confidence: number;
    }>;
    summary: {
      architecture: string;
      mainComponents: string[];
      keyFeatures: string[];
      apiStyle?: string;
    };
  };

  /** Context information */
  context: {
    filesIncluded: number;
    totalTokens: number;
    tokenUsagePercent: number;
    averageScore: number;
  };
}

/**
 * Options for data optimization.
 */
export interface OptimizationOptions {
  /** Whether to include private/internal elements */
  includePrivate?: boolean;
  /** Minimum confidence score for elements */
  minConfidence?: number;
  /** Maximum number of items per category */
  maxItemsPerCategory?: number;
  /** Whether to sort results */
  sortResults?: boolean;
}

// ─────────────────────────── Service ───────────────────────────

/**
 * `DataPipelineOptimizer` transforms and optimizes data structures for Markdown consumption.
 *
 * @example
 * ```ts
 * import { DataPipelineOptimizer } from './data-pipeline-optimizer.js';
 *
 * const optimizer = new DataPipelineOptimizer();
 * const optimizedData = optimizer.optimizeProjectData({
 *   metadata,
 *   techReport,
 *   harvestResult,
 *   dependencySummary,
 *   commandContextResult,
 *   codebaseMapResult,
 * });
 *
 * console.log(JSON.stringify(optimizedData, null, 2));
 * ```
 */
export class DataPipelineOptimizer {
  private options: OptimizationOptions;

  constructor(options: OptimizationOptions = {}) {
    this.options = {
      includePrivate: options.includePrivate ?? false,
      minConfidence: options.minConfidence ?? 0.5,
      maxItemsPerCategory: options.maxItemsPerCategory ?? 50,
      sortResults: options.sortResults ?? true,
    };
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Optimize and flatten all project data for Markdown consumption.
   *
   * @param data - Raw data from various pipeline stages
   * @returns Optimized and serializable project data
   */
  public optimizeProjectData(data: {
    metadata?: ProjectMetadata;
    techReport?: TechReport;
    harvestResult?: HarvestResult;
    dependencySummary?: DependencySummary[];
    commandContextResult?: CommandContextResult;
    codebaseMapResult?: CodebaseMapResult;
  }): OptimizedProjectData {
    return {
      metadata: this.optimizeMetadata(data.metadata),
      techStack: this.optimizeTechStack(data.techReport),
      dependencies: this.optimizeDependencies(data.harvestResult, data.dependencySummary),
      commands: this.optimizeCommands(data.commandContextResult),
      codebase: this.optimizeCodebase(data.codebaseMapResult),
      context: this.optimizeContext(data.commandContextResult || data.codebaseMapResult),
    };
  }

  // ── Metadata Optimization ──────────────────────────────────────

  /**
   * Optimize project metadata.
   */
  private optimizeMetadata(metadata?: ProjectMetadata): OptimizedProjectData['metadata'] {
    if (!metadata) {
      return {
        authors: [],
        keywords: [],
      };
    }

    return {
      name: metadata.name,
      version: metadata.version,
      description: metadata.description,
      authors: metadata.authors.map(a => ({
        name: a.name,
        email: a.email,
        url: a.url,
      })),
      license: metadata.license ? {
        spdx: metadata.license.spdx,
        name: metadata.license.name,
      } : undefined,
      repository: metadata.repository ? {
        type: metadata.repository.type,
        url: metadata.repository.url,
      } : undefined,
      homepage: metadata.homepage,
      keywords: metadata.keywords,
    };
  }

  // ── Tech Stack Optimization ──────────────────────────────────────

  /**
   * Optimize technology stack data.
   */
  private optimizeTechStack(techReport?: TechReport): OptimizedProjectData['techStack'] {
    if (!techReport) {
      return {
        projectTypes: [],
        languages: [],
        totalFiles: 0,
      };
    }

    // Convert Map to array
    const languages: SerializableLanguage[] = Array.from(techReport.languages.values()).map(lang => ({
      name: lang.name,
      badgeSlug: lang.badgeSlug,
      color: lang.color,
      fileCount: lang.fileCount,
    }));

    // Sort by file count if enabled
    if (this.options.sortResults) {
      languages.sort((a, b) => b.fileCount - a.fileCount);
    }

    return {
      projectTypes: techReport.projectTypes,
      languages,
      totalFiles: techReport.totalFiles,
    };
  }

  // ── Dependencies Optimization ──────────────────────────────────────

  /**
   * Optimize dependency data.
   */
  private optimizeDependencies(
    harvestResult?: HarvestResult,
    dependencySummary?: DependencySummary[]
  ): OptimizedProjectData['dependencies'] {
    if (!harvestResult) {
      return {
        byCategory: [],
        byType: [],
        totalDependencies: 0,
      };
    }

    // Convert Map to array
    const allDeps: SerializableDependency[] = [];
    for (const [name, deps] of harvestResult.dependencies) {
      for (const dep of deps) {
        allDeps.push({
          name,
          version: dep.version,
          type: dep.type,
          source: dep.source,
        });
      }
    }

    // Group by type
    const byType = this.groupByType(allDeps);

    // Use dependency summary if available
    const byCategory = dependencySummary ? dependencySummary.map(summary => ({
      category: summary.category,
      items: summary.items,
    })) : [];

    return {
      byCategory,
      byType,
      totalDependencies: harvestResult.totalDependencies,
    };
  }

  /**
   * Group dependencies by type.
   */
  private groupByType(dependencies: SerializableDependency[]): Array<{
    type: string;
    items: SerializableDependency[];
  }> {
    const grouped = new Map<string, SerializableDependency[]>();

    for (const dep of dependencies) {
      const existing = grouped.get(dep.type);
      if (existing) {
        existing.push(dep);
      } else {
        grouped.set(dep.type, [dep]);
      }
    }

    const result = Array.from(grouped.entries()).map(([type, items]) => ({
      type,
      items,
    }));

    if (this.options.sortResults) {
      result.sort((a, b) => b.items.length - a.items.length);
    }

    return result;
  }

  // ── Commands Optimization ──────────────────────────────────────

  /**
   * Optimize command data.
   */
  private optimizeCommands(commandContextResult?: CommandContextResult): OptimizedProjectData['commands'] {
    if (!commandContextResult) {
      return {
        byType: [],
        entryPoints: [],
        scriptFiles: [],
        buildConfigs: [],
        totalCommands: 0,
      };
    }

    // Convert Map to array
    const byType = Array.from(commandContextResult.commandsByType.entries()).map(([type, commands]) => ({
      type,
      items: commands.map(cmd => ({
        type: cmd.type,
        command: cmd.command,
        description: cmd.description,
        source: cmd.source,
        lineNumber: cmd.lineNumber,
        confidence: cmd.confidence,
      })),
    }));

    // Optimize entry points
    const entryPoints = commandContextResult.entryPoints.map(ep => ({
      path: ep.relativePath,
      type: ep.type,
      confidence: ep.confidence,
    }));

    // Optimize script files
    const scriptFiles = commandContextResult.scriptFiles.map(sf => ({
      path: sf.relativePath,
      scriptType: sf.scriptType,
      commandCount: sf.commands.length,
    }));

    // Optimize build configs
    const buildConfigs = commandContextResult.buildConfigs.map(bc => ({
      type: bc.type,
      source: bc.source,
      commandCount: bc.commands.length,
    }));

    return {
      byType,
      entryPoints,
      scriptFiles,
      buildConfigs,
      totalCommands: commandContextResult.commandStats.totalCommands,
    };
  }

  // ── Codebase Optimization ──────────────────────────────────────

  /**
   * Optimize codebase data.
   */
  private optimizeCodebase(codebaseMapResult?: CodebaseMapResult): OptimizedProjectData['codebase'] {
    if (!codebaseMapResult) {
      return {
        elements: [],
        apiEndpoints: [],
        features: [],
        relationships: [],
        summary: {
          architecture: 'Unknown',
          mainComponents: [],
          keyFeatures: [],
        },
      };
    }

    const { codebaseMap, summary } = codebaseMapResult;

    // Filter elements by confidence and visibility
    const elements = codebaseMap.elements
      .filter(e => e.confidence >= (this.options.minConfidence ?? 0.5))
      .filter(e => this.options.includePrivate || e.visibility !== 'private')
      .slice(0, this.options.maxItemsPerCategory)
      .map(e => ({
        type: e.type,
        name: e.name,
        filePath: e.filePath,
        startLine: e.startLine,
        visibility: e.visibility,
        isExported: e.isExported,
        confidence: e.confidence,
      }));

    // Optimize API endpoints
    const apiEndpoints = codebaseMap.apiEndpoints
      .filter(ep => ep.isPublic)
      .slice(0, this.options.maxItemsPerCategory)
      .map(ep => ({
        method: ep.method,
        path: ep.path,
        filePath: ep.filePath,
        lineNumber: ep.lineNumber,
        isPublic: ep.isPublic,
      }));

    // Optimize features
    const features = codebaseMap.features
      .filter(f => f.confidence >= (this.options.minConfidence ?? 0.5))
      .slice(0, this.options.maxItemsPerCategory)
      .map(f => ({
        name: f.name,
        description: f.description,
        category: f.category,
        confidence: f.confidence,
        fileCount: f.files.length,
      }));

    // Optimize relationships
    const relationships = codebaseMap.relationships
      .filter(r => r.confidence >= (this.options.minConfidence ?? 0.5))
      .slice(0, this.options.maxItemsPerCategory)
      .map(r => ({
        source: r.source,
        target: r.target,
        type: r.type,
        confidence: r.confidence,
      }));

    return {
      elements,
      apiEndpoints,
      features,
      relationships,
      summary: {
        architecture: summary.architecture,
        mainComponents: summary.mainComponents,
        keyFeatures: summary.keyFeatures,
        apiStyle: summary.apiStyle,
      },
    };
  }

  // ── Context Optimization ──────────────────────────────────────

  /**
   * Optimize context data.
   */
  private optimizeContext(result?: ContextBuildResult | CodebaseMapResult): OptimizedProjectData['context'] {
    if (!result) {
      return {
        filesIncluded: 0,
        totalTokens: 0,
        tokenUsagePercent: 0,
        averageScore: 0,
      };
    }

    return {
      filesIncluded: result.fileCount,
      totalTokens: result.totalTokens,
      tokenUsagePercent: result.stats.tokenUsagePercent,
      averageScore: result.stats.averageScore,
    };
  }

  // ── Helper Methods ──────────────────────────────────────

  /**
   * Convert a Map to a serializable array.
   */
  public static mapToArray<K, V>(map: Map<K, V>): Array<{ key: K; value: V }> {
    return Array.from(map.entries()).map(([key, value]) => ({ key, value }));
  }

  /**
   * Convert an array back to a Map.
   */
  public static arrayToMap<K, V>(array: Array<{ key: K; value: V }>): Map<K, V> {
    return new Map(array.map(({ key, value }) => [key, value]));
  }

  /**
   * Flatten nested objects to a single level.
   */
  public static flattenObject(obj: Record<string, unknown>, separator: string = '.'): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    function flatten(current: Record<string, unknown>, parentKey: string = '') {
      for (const key in current) {
        if (Object.prototype.hasOwnProperty.call(current, key)) {
          const newKey = parentKey ? `${parentKey}${separator}${key}` : key;
          const value = current[key];

          if (value && typeof value === 'object' && !Array.isArray(value)) {
            flatten(value as Record<string, unknown>, newKey);
          } else {
            result[newKey] = value;
          }
        }
      }
    }

    flatten(obj);
    return result;
  }

  /**
   * Sanitize a string for Markdown rendering.
   */
  public static sanitizeForMarkdown(text: string): string {
    return text
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/&/g, '&')
      .replace(/"/g, '"')
      .replace(/'/g, '&#39;');
  }

  /**
   * Format a file path for display (relative to project root).
   */
  public static formatFilePath(filePath: string, rootPath?: string): string {
    if (rootPath) {
      return path.relative(rootPath, filePath);
    }
    return path.basename(filePath);
  }

  /**
   * Get a summary of the optimized data.
   */
  public getOptimizationSummary(data: OptimizedProjectData): string {
    const lines: string[] = [
      '# Optimized Data Summary',
      '',
      '## Metadata',
      `- Name: ${data.metadata.name || 'Unknown'}`,
      `- Version: ${data.metadata.version || 'Unknown'}`,
      `- Description: ${data.metadata.description || 'No description'}`,
      `- Authors: ${data.metadata.authors.length}`,
      `- License: ${data.metadata.license?.spdx || data.metadata.license?.name || 'Unknown'}`,
      '',
      '## Tech Stack',
      `- Project Types: ${data.techStack.projectTypes.map(pt => pt.label).join(', ')}`,
      `- Languages: ${data.techStack.languages.map(l => l.name).join(', ')}`,
      `- Total Files: ${data.techStack.totalFiles}`,
      '',
      '## Dependencies',
      `- Total Dependencies: ${data.dependencies.totalDependencies}`,
      `- Categories: ${data.dependencies.byCategory.length}`,
      `- Types: ${data.dependencies.byType.length}`,
      '',
      '## Commands',
      `- Total Commands: ${data.commands.totalCommands}`,
      `- Entry Points: ${data.commands.entryPoints.length}`,
      `- Script Files: ${data.commands.scriptFiles.length}`,
      `- Build Configs: ${data.commands.buildConfigs.length}`,
      '',
      '## Codebase',
      `- Elements: ${data.codebase.elements.length}`,
      `- API Endpoints: ${data.codebase.apiEndpoints.length}`,
      `- Features: ${data.codebase.features.length}`,
      `- Relationships: ${data.codebase.relationships.length}`,
      `- Architecture: ${data.codebase.summary.architecture}`,
      '',
      '## Context',
      `- Files Included: ${data.context.filesIncluded}`,
      `- Total Tokens: ${data.context.totalTokens}`,
      `- Token Usage: ${data.context.tokenUsagePercent.toFixed(1)}%`,
      `- Average Score: ${data.context.averageScore.toFixed(2)}`,
      '',
    ];

    return lines.join('\n');
  }

  /**
   * Export optimized data as JSON.
   */
  public exportAsJSON(data: OptimizedProjectData, pretty: boolean = true): string {
    return JSON.stringify(data, null, pretty ? 2 : 0);
  }

  /**
   * Validate optimized data structure.
   */
  public validateData(data: OptimizedProjectData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields
    if (!data.metadata) {
      errors.push('Missing metadata');
    }
    if (!data.techStack) {
      errors.push('Missing techStack');
    }
    if (!data.dependencies) {
      errors.push('Missing dependencies');
    }
    if (!data.commands) {
      errors.push('Missing commands');
    }
    if (!data.codebase) {
      errors.push('Missing codebase');
    }
    if (!data.context) {
      errors.push('Missing context');
    }

    // Check data types
    if (!Array.isArray(data.techStack.projectTypes)) {
      errors.push('techStack.projectTypes is not an array');
    }
    if (!Array.isArray(data.techStack.languages)) {
      errors.push('techStack.languages is not an array');
    }
    if (!Array.isArray(data.dependencies.byCategory)) {
      errors.push('dependencies.byCategory is not an array');
    }
    if (!Array.isArray(data.dependencies.byType)) {
      errors.push('dependencies.byType is not an array');
    }
    if (!Array.isArray(data.commands.byType)) {
      errors.push('commands.byType is not an array');
    }
    if (!Array.isArray(data.codebase.elements)) {
      errors.push('codebase.elements is not an array');
    }
    if (!Array.isArray(data.codebase.apiEndpoints)) {
      errors.push('codebase.apiEndpoints is not an array');
    }
    if (!Array.isArray(data.codebase.features)) {
      errors.push('codebase.features is not an array');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
