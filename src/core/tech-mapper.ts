/**
 * TechMapper — Detects project types and maps file extensions to languages.
 *
 * Consumes the `FileInfo[]` produced by `FileScanner` (scanner.ts) and
 * outputs structured tech-stack data that downstream modules (badge engine,
 * AI prompt builder, etc.) can use directly.
 *
 * @module core/tech-mapper
 */

import path from 'path';
import { FileInfo } from './scanner.js';

// ─────────────────────────── Types ───────────────────────────

/**
 * Describes a single project-type detection result.
 */
export interface ProjectType {
  /** Machine-readable identifier, e.g. "nodejs" */
  id: string;
  /** Human-readable label, e.g. "Node.js" */
  label: string;
  /** Optional icon / badge slug (shields.io compatible) */
  badgeSlug: string;
  /** Hex colour for the badge background */
  color: string;
  /** The marker file that triggered the detection */
  detectedBy: string;
}

/**
 * Language information inferred from a file extension.
 */
export interface LanguageInfo {
  /** Canonical language name, e.g. "TypeScript" */
  name: string;
  /** shields.io / simple-icons slug */
  badgeSlug: string;
  /** Hex colour for the badge background */
  color: string;
}

/**
 * Aggregated technology report produced by `TechMapper.analyze()`.
 */
export interface TechReport {
  /** Project types detected (Node.js, Rust, Python …) */
  projectTypes: ProjectType[];
  /** Map of language name → aggregated info + file count */
  languages: Map<string, LanguageInfo & { fileCount: number }>;
  /** Total number of source files analysed */
  totalFiles: number;
}

// ─────────────────── Marker-file → Project Type ──────────────────

/**
 * Registry of marker files / directory names and the project type they imply.
 * Each entry maps a **file name** (case-sensitive) to a `ProjectType` template.
 */
const PROJECT_MARKERS: ReadonlyMap<string, Omit<ProjectType, 'detectedBy'>> = new Map([
  // ── JavaScript / TypeScript ecosystem ──
  ['package.json',      { id: 'nodejs',      label: 'Node.js',       badgeSlug: 'node.js',       color: '339933' }],
  ['tsconfig.json',     { id: 'typescript',  label: 'TypeScript',    badgeSlug: 'typescript',    color: '3178C6' }],
  ['deno.json',         { id: 'deno',        label: 'Deno',          badgeSlug: 'deno',          color: '000000' }],
  ['deno.jsonc',        { id: 'deno',        label: 'Deno',          badgeSlug: 'deno',          color: '000000' }],
  ['bun.lockb',         { id: 'bun',         label: 'Bun',           badgeSlug: 'bun',           color: 'FBCB29' }],
  ['next.config.js',    { id: 'nextjs',      label: 'Next.js',       badgeSlug: 'next.js',       color: '000000' }],
  ['next.config.mjs',   { id: 'nextjs',      label: 'Next.js',       badgeSlug: 'next.js',       color: '000000' }],
  ['next.config.ts',    { id: 'nextjs',      label: 'Next.js',       badgeSlug: 'next.js',       color: '000000' }],
  ['nuxt.config.ts',    { id: 'nuxtjs',      label: 'Nuxt.js',       badgeSlug: 'nuxt.js',       color: '00DC82' }],
  ['nuxt.config.js',    { id: 'nuxtjs',      label: 'Nuxt.js',       badgeSlug: 'nuxt.js',       color: '00DC82' }],
  ['vite.config.ts',    { id: 'vite',        label: 'Vite',          badgeSlug: 'vite',          color: '646CFF' }],
  ['vite.config.js',    { id: 'vite',        label: 'Vite',          badgeSlug: 'vite',          color: '646CFF' }],
  ['angular.json',      { id: 'angular',     label: 'Angular',       badgeSlug: 'angular',       color: 'DD0031' }],
  ['svelte.config.js',  { id: 'svelte',      label: 'Svelte',        badgeSlug: 'svelte',        color: 'FF3E00' }],
  ['svelte.config.ts',  { id: 'svelte',      label: 'Svelte',        badgeSlug: 'svelte',        color: 'FF3E00' }],
  ['astro.config.mjs',  { id: 'astro',       label: 'Astro',         badgeSlug: 'astro',         color: 'FF5D01' }],

  // ── Python ecosystem ──
  ['requirements.txt',  { id: 'python',      label: 'Python',        badgeSlug: 'python',        color: '3776AB' }],
  ['setup.py',          { id: 'python',      label: 'Python',        badgeSlug: 'python',        color: '3776AB' }],
  ['setup.cfg',         { id: 'python',      label: 'Python',        badgeSlug: 'python',        color: '3776AB' }],
  ['pyproject.toml',    { id: 'python',      label: 'Python',        badgeSlug: 'python',        color: '3776AB' }],
  ['Pipfile',           { id: 'python',      label: 'Python',        badgeSlug: 'python',        color: '3776AB' }],
  ['manage.py',         { id: 'django',      label: 'Django',        badgeSlug: 'django',        color: '092E20' }],

  // ── Rust ──
  ['Cargo.toml',        { id: 'rust',        label: 'Rust',          badgeSlug: 'rust',          color: '000000' }],

  // ── Go ──
  ['go.mod',            { id: 'go',          label: 'Go',            badgeSlug: 'go',            color: '00ADD8' }],

  // ── Java / JVM ──
  ['pom.xml',           { id: 'java-maven',  label: 'Java (Maven)',  badgeSlug: 'apachemaven',   color: 'C71A36' }],
  ['build.gradle',      { id: 'java-gradle', label: 'Java (Gradle)', badgeSlug: 'gradle',        color: '02303A' }],
  ['build.gradle.kts',  { id: 'kotlin-gradle', label: 'Kotlin (Gradle)', badgeSlug: 'kotlin',   color: '7F52FF' }],

  // ── .NET / C# ──
  ['*.csproj',          { id: 'dotnet',      label: '.NET',          badgeSlug: '.net',          color: '512BD4' }],
  ['*.sln',             { id: 'dotnet',      label: '.NET',          badgeSlug: '.net',          color: '512BD4' }],

  // ── Ruby ──
  ['Gemfile',           { id: 'ruby',        label: 'Ruby',          badgeSlug: 'ruby',          color: 'CC342D' }],

  // ── PHP ──
  ['composer.json',     { id: 'php',         label: 'PHP',           badgeSlug: 'php',           color: '777BB4' }],

  // ── Swift ──
  ['Package.swift',     { id: 'swift',       label: 'Swift',         badgeSlug: 'swift',         color: 'F05138' }],

  // ── Dart / Flutter ──
  ['pubspec.yaml',      { id: 'dart',        label: 'Dart / Flutter', badgeSlug: 'flutter',      color: '02569B' }],

  // ── Elixir ──
  ['mix.exs',           { id: 'elixir',      label: 'Elixir',        badgeSlug: 'elixir',        color: '4B275F' }],

  // ── Docker / Infra ──
  ['Dockerfile',        { id: 'docker',      label: 'Docker',        badgeSlug: 'docker',        color: '2496ED' }],
  ['docker-compose.yml',{ id: 'docker',      label: 'Docker',        badgeSlug: 'docker',        color: '2496ED' }],
  ['docker-compose.yaml',{ id: 'docker',     label: 'Docker',        badgeSlug: 'docker',        color: '2496ED' }],

  // ── Terraform ──
  ['main.tf',           { id: 'terraform',   label: 'Terraform',     badgeSlug: 'terraform',     color: '7B42BC' }],

  // ── Kubernetes ──
  ['k8s.yaml',          { id: 'kubernetes',  label: 'Kubernetes',    badgeSlug: 'kubernetes',    color: '326CE5' }],
]);

// ─────────────────── Extension → Language ──────────────────

/**
 * Maps a file extension (without the dot) to its language metadata.
 * Covers the most widely-used languages and config formats.
 */
const EXTENSION_LANGUAGE_MAP: ReadonlyMap<string, LanguageInfo> = new Map([
  // ── Web / JS family ──
  ['js',    { name: 'JavaScript',  badgeSlug: 'javascript',  color: 'F7DF1E' }],
  ['mjs',   { name: 'JavaScript',  badgeSlug: 'javascript',  color: 'F7DF1E' }],
  ['cjs',   { name: 'JavaScript',  badgeSlug: 'javascript',  color: 'F7DF1E' }],
  ['jsx',   { name: 'React JSX',   badgeSlug: 'react',       color: '61DAFB' }],
  ['ts',    { name: 'TypeScript',  badgeSlug: 'typescript',  color: '3178C6' }],
  ['tsx',   { name: 'React TSX',   badgeSlug: 'react',       color: '61DAFB' }],
  ['vue',   { name: 'Vue',         badgeSlug: 'vue.js',      color: '4FC08D' }],
  ['svelte',{ name: 'Svelte',      badgeSlug: 'svelte',      color: 'FF3E00' }],

  // ── Markup & style ──
  ['html',  { name: 'HTML',        badgeSlug: 'html5',       color: 'E34F26' }],
  ['htm',   { name: 'HTML',        badgeSlug: 'html5',       color: 'E34F26' }],
  ['css',   { name: 'CSS',         badgeSlug: 'css3',        color: '1572B6' }],
  ['scss',  { name: 'SCSS',        badgeSlug: 'sass',        color: 'CC6699' }],
  ['sass',  { name: 'Sass',        badgeSlug: 'sass',        color: 'CC6699' }],
  ['less',  { name: 'Less',        badgeSlug: 'less',        color: '1D365D' }],

  // ── Python ──
  ['py',    { name: 'Python',      badgeSlug: 'python',      color: '3776AB' }],
  ['pyw',   { name: 'Python',      badgeSlug: 'python',      color: '3776AB' }],
  ['pyi',   { name: 'Python',      badgeSlug: 'python',      color: '3776AB' }],
  ['ipynb', { name: 'Jupyter',     badgeSlug: 'jupyter',     color: 'F37626' }],

  // ── Rust ──
  ['rs',    { name: 'Rust',        badgeSlug: 'rust',        color: '000000' }],

  // ── Go ──
  ['go',    { name: 'Go',          badgeSlug: 'go',          color: '00ADD8' }],

  // ── Java / JVM ──
  ['java',  { name: 'Java',        badgeSlug: 'java',        color: 'ED8B00' }],
  ['kt',    { name: 'Kotlin',      badgeSlug: 'kotlin',      color: '7F52FF' }],
  ['kts',   { name: 'Kotlin',      badgeSlug: 'kotlin',      color: '7F52FF' }],
  ['scala', { name: 'Scala',       badgeSlug: 'scala',       color: 'DC322F' }],
  ['clj',   { name: 'Clojure',     badgeSlug: 'clojure',     color: '5881D8' }],
  ['groovy',{ name: 'Groovy',      badgeSlug: 'apachegroovy',color: '4298B8' }],

  // ── C / C++ ──
  ['c',     { name: 'C',           badgeSlug: 'c',           color: 'A8B9CC' }],
  ['h',     { name: 'C',           badgeSlug: 'c',           color: 'A8B9CC' }],
  ['cpp',   { name: 'C++',         badgeSlug: 'cplusplus',   color: '00599C' }],
  ['cxx',   { name: 'C++',         badgeSlug: 'cplusplus',   color: '00599C' }],
  ['cc',    { name: 'C++',         badgeSlug: 'cplusplus',   color: '00599C' }],
  ['hpp',   { name: 'C++',         badgeSlug: 'cplusplus',   color: '00599C' }],

  // ── C# ──
  ['cs',    { name: 'C#',          badgeSlug: 'csharp',      color: '239120' }],

  // ── Ruby ──
  ['rb',    { name: 'Ruby',        badgeSlug: 'ruby',        color: 'CC342D' }],
  ['erb',   { name: 'ERB',         badgeSlug: 'ruby',        color: 'CC342D' }],

  // ── PHP ──
  ['php',   { name: 'PHP',         badgeSlug: 'php',         color: '777BB4' }],

  // ── Swift / Obj-C ──
  ['swift', { name: 'Swift',       badgeSlug: 'swift',       color: 'F05138' }],
  ['m',     { name: 'Objective-C', badgeSlug: 'apple',       color: '000000' }],
  ['mm',    { name: 'Objective-C++', badgeSlug: 'apple',     color: '000000' }],

  // ── Dart ──
  ['dart',  { name: 'Dart',        badgeSlug: 'dart',        color: '0175C2' }],

  // ── Elixir / Erlang ──
  ['ex',    { name: 'Elixir',      badgeSlug: 'elixir',      color: '4B275F' }],
  ['exs',   { name: 'Elixir',      badgeSlug: 'elixir',      color: '4B275F' }],
  ['erl',   { name: 'Erlang',      badgeSlug: 'erlang',      color: 'A90533' }],

  // ── Shell ──
  ['sh',    { name: 'Shell',       badgeSlug: 'gnubash',     color: '4EAA25' }],
  ['bash',  { name: 'Bash',        badgeSlug: 'gnubash',     color: '4EAA25' }],
  ['zsh',   { name: 'Zsh',         badgeSlug: 'gnubash',     color: '4EAA25' }],
  ['ps1',   { name: 'PowerShell',  badgeSlug: 'powershell',  color: '5391FE' }],
  ['bat',   { name: 'Batch',       badgeSlug: 'windows',     color: '0078D6' }],
  ['cmd',   { name: 'Batch',       badgeSlug: 'windows',     color: '0078D6' }],

  // ── Haskell ──
  ['hs',    { name: 'Haskell',     badgeSlug: 'haskell',     color: '5D4F85' }],

  // ── Lua ──
  ['lua',   { name: 'Lua',         badgeSlug: 'lua',         color: '2C2D72' }],

  // ── R ──
  ['r',     { name: 'R',           badgeSlug: 'r',           color: '276DC3' }],
  ['rmd',   { name: 'R Markdown',  badgeSlug: 'r',           color: '276DC3' }],

  // ── Data / Config ──
  ['json',  { name: 'JSON',        badgeSlug: 'json',        color: '000000' }],
  ['yaml',  { name: 'YAML',        badgeSlug: 'yaml',        color: 'CB171E' }],
  ['yml',   { name: 'YAML',        badgeSlug: 'yaml',        color: 'CB171E' }],
  ['toml',  { name: 'TOML',        badgeSlug: 'toml',        color: '9C4121' }],
  ['xml',   { name: 'XML',         badgeSlug: 'xml',         color: '005FAD' }],
  ['sql',   { name: 'SQL',         badgeSlug: 'postgresql',  color: '4169E1' }],

  // ── Docs ──
  ['md',    { name: 'Markdown',    badgeSlug: 'markdown',    color: '000000' }],
  ['mdx',   { name: 'MDX',         badgeSlug: 'mdx',         color: '1B1F24' }],
  ['rst',   { name: 'reStructuredText', badgeSlug: 'readthedocs', color: '8CA1AF' }],
  ['tex',   { name: 'LaTeX',       badgeSlug: 'latex',       color: '008080' }],

  // ── Infra / DevOps ──
  ['tf',    { name: 'Terraform',   badgeSlug: 'terraform',   color: '7B42BC' }],
  ['hcl',   { name: 'HCL',         badgeSlug: 'terraform',   color: '7B42BC' }],
]);

// ─────────────────────────── Service ───────────────────────────

/**
 * `TechMapper` analyses a scanned file list to detect the project's
 * technology stack and map every source file to its language.
 *
 * @example
 * ```ts
 * import { FileScanner } from './scanner.js';
 * import { TechMapper }  from './tech-mapper.js';
 *
 * const scanner = new FileScanner('./my-project');
 * const files   = await scanner.scan();
 * const mapper  = new TechMapper();
 * const report  = mapper.analyze(files);
 *
 * console.log(report.projectTypes);   // [{ id: 'nodejs', … }]
 * console.log(report.languages);      // Map { 'TypeScript' => { … } }
 * ```
 */
export class TechMapper {
  // ── Public read-only access to the registries ──

  /** Marker-file registry (useful for downstream tools to extend or inspect). */
  public static readonly markers = PROJECT_MARKERS;

  /** Extension → language registry. */
  public static readonly extensions = EXTENSION_LANGUAGE_MAP;

  // ── Core analysis ──

  /**
   * Analyse an array of `FileInfo` objects and produce a `TechReport`.
   *
   * @param files - The file list returned by `FileScanner.scan()`.
   * @returns A `TechReport` with detected project types and language breakdown.
   */
  public analyze(files: FileInfo[]): TechReport {
    const projectTypes = this.detectProjectTypes(files);
    const languages = this.mapLanguages(files);

    return {
      projectTypes,
      languages,
      totalFiles: files.length,
    };
  }

  // ── Project-type detection ──

  /**
   * Walk the file list and check each name against the marker registry.
   * Glob-style markers (e.g. `*.csproj`) are matched with a simple
   * extension check.
   */
  private detectProjectTypes(files: FileInfo[]): ProjectType[] {
    /** Track seen project IDs to avoid duplicates. */
    const seen = new Set<string>();
    const results: ProjectType[] = [];

    for (const file of files) {
      const fileName = file.name;

      // 1. Exact match
      const exact = PROJECT_MARKERS.get(fileName);
      if (exact && !seen.has(exact.id)) {
        seen.add(exact.id);
        results.push({ ...exact, detectedBy: fileName });
        continue;
      }

      // 2. Glob-style match (entries that start with *)
      for (const [pattern, meta] of PROJECT_MARKERS) {
        if (!pattern.startsWith('*')) continue;
        const suffix = pattern.slice(1); // e.g. ".csproj"
        if (fileName.endsWith(suffix) && !seen.has(meta.id)) {
          seen.add(meta.id);
          results.push({ ...meta, detectedBy: fileName });
        }
      }
    }

    return results;
  }

  // ── Language mapping ──

  /**
   * Count files per language and aggregate the metadata.
   */
  private mapLanguages(files: FileInfo[]): Map<string, LanguageInfo & { fileCount: number }> {
    const result = new Map<string, LanguageInfo & { fileCount: number }>();

    for (const file of files) {
      const ext = file.extension.toLowerCase();
      const lang = EXTENSION_LANGUAGE_MAP.get(ext);

      if (!lang) continue;

      const existing = result.get(lang.name);
      if (existing) {
        existing.fileCount += 1;
      } else {
        result.set(lang.name, { ...lang, fileCount: 1 });
      }
    }

    return result;
  }

  // ── Convenience helpers ──

  /**
   * Return the `LanguageInfo` for a single file extension.
   * Returns `undefined` if the extension is not recognised.
   *
   * @param extension - Extension string **without** the leading dot.
   */
  public static getLanguageForExtension(extension: string): LanguageInfo | undefined {
    return EXTENSION_LANGUAGE_MAP.get(extension.toLowerCase());
  }

  /**
   * Return a shields.io badge URL for a given language or project type.
   *
   * @param slug   - The `badgeSlug` from a `LanguageInfo` or `ProjectType`.
   * @param label  - The visible label text.
   * @param color  - Hex colour string (without `#`).
   */
  public static buildBadgeUrl(slug: string, label: string, color: string): string {
    const encodedLabel = encodeURIComponent(label);
    return `https://img.shields.io/badge/${encodedLabel}-${color}?style=for-the-badge&logo=${slug}&logoColor=white`;
  }
}
