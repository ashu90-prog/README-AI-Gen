/**
 * MetadataExtractor — Pulls project-level metadata from config files.
 *
 * Consumes the `FileInfo[]` produced by `FileScanner` (scanner.ts),
 * reads the most common manifest files (package.json, pyproject.toml,
 * Cargo.toml, etc.), and returns a unified `ProjectMetadata` object.
 *
 * Downstream consumers (AI prompt builder, Markdown engine) can use this
 * without caring which ecosystem the project belongs to.
 *
 * @module core/metadata-extractor
 */

import fs from 'fs-extra';
import path from 'path';
import { FileInfo } from './scanner.js';

// ─────────────────────────── Types ───────────────────────────

/**
 * Normalised author representation.
 */
export interface AuthorInfo {
  /** Display name.  May be `undefined` if only an email is available. */
  name?: string;
  /** Email address. */
  email?: string;
  /** URL (homepage / GitHub profile). */
  url?: string;
}

/**
 * License information extracted from a manifest.
 */
export interface LicenseInfo {
  /** SPDX identifier (e.g. "MIT", "Apache-2.0"). */
  spdx?: string;
  /** Full license name if SPDX is not available. */
  name?: string;
}

/**
 * Repository information.
 */
export interface RepositoryInfo {
  /** Repository type (e.g. "git"). */
  type?: string;
  /** Repository URL. */
  url?: string;
}

/**
 * Unified project metadata aggregated from one or more manifest files.
 * Fields are optional because not every ecosystem exposes every field.
 */
export interface ProjectMetadata {
  /** Project / package name. */
  name?: string;
  /** Semantic version string. */
  version?: string;
  /** Short description / tagline. */
  description?: string;
  /** Authors / maintainers. */
  authors: AuthorInfo[];
  /** License details. */
  license?: LicenseInfo;
  /** Repository URL. */
  repository?: RepositoryInfo;
  /** Homepage / documentation URL. */
  homepage?: string;
  /** Keywords / tags. */
  keywords: string[];
  /** The manifest file(s) this metadata was extracted from. */
  sources: string[];
}

// ─────────────────── Manifest file names ──────────────────

/**
 * Ordered list of manifest file names to probe.
 * Earlier entries have higher priority when merging.
 */
const MANIFEST_FILES: readonly string[] = [
  'package.json',      // Node.js / npm / yarn / pnpm
  'pyproject.toml',    // Python (PEP 621 / Poetry)
  'setup.cfg',         // Python (setuptools)
  'setup.py',          // Python (legacy)
  'Cargo.toml',        // Rust
  'go.mod',            // Go
  'pom.xml',           // Java (Maven)
  'build.gradle',      // Java / Kotlin (Gradle)
  'build.gradle.kts',  // Kotlin DSL (Gradle)
  'Gemfile',           // Ruby
  'composer.json',     // PHP
  'pubspec.yaml',      // Dart / Flutter
  'Package.swift',     // Swift
  'mix.exs',           // Elixir
  'deno.json',         // Deno
  'deno.jsonc',        // Deno
];

// ─────────────────────────── Service ───────────────────────────

/**
 * `MetadataExtractor` scans the file list for known manifest files and
 * returns a merged `ProjectMetadata` object.
 *
 * @example
 * ```ts
 * import { FileScanner }       from './scanner.js';
 * import { MetadataExtractor } from './metadata-extractor.js';
 *
 * const scanner   = new FileScanner('./my-project');
 * const files     = await scanner.scan();
 * const extractor = new MetadataExtractor();
 * const metadata  = await extractor.extract(files);
 *
 * console.log(metadata.name);        // "my-project"
 * console.log(metadata.description); // "A blazing-fast CLI tool"
 * ```
 */
export class MetadataExtractor {
  /** Ordered manifest file names that are probed. */
  public static readonly manifestFiles = MANIFEST_FILES;

  // ── Core extraction ──

  /**
   * Walk the `FileInfo[]` list, parse every recognised manifest, and
   * merge the results into a single `ProjectMetadata`.
   *
   * Fields from higher-priority manifests (earlier in `MANIFEST_FILES`)
   * win when there is a conflict.
   *
   * @param files - Output of `FileScanner.scan()`.
   */
  public async extract(files: FileInfo[]): Promise<ProjectMetadata> {
    // Build a quick lookup: baseName → FileInfo
    const byName = new Map<string, FileInfo>();
    for (const f of files) {
      if (!byName.has(f.name)) {
        byName.set(f.name, f);
      }
    }

    const merged: ProjectMetadata = {
      authors: [],
      keywords: [],
      sources: [],
    };

    // Probe manifests in priority order
    for (const manifestName of MANIFEST_FILES) {
      const file = byName.get(manifestName);
      if (!file) continue;

      try {
        const partial = await this.parseManifest(file);
        if (partial) {
          this.merge(merged, partial, file.path);
        }
      } catch {
        // Silently skip unparseable manifests — other modules may
        // still extract useful data from the remaining files.
      }
    }

    return merged;
  }

  // ── Manifest dispatch ──

  /**
   * Dispatch to the correct parser based on the file name.
   */
  private async parseManifest(file: FileInfo): Promise<Partial<ProjectMetadata> | null> {
    const content = await fs.readFile(file.path, 'utf-8');
    const name = file.name;

    if (name === 'package.json')      return this.parsePackageJson(content);
    if (name === 'pyproject.toml')    return this.parsePyprojectToml(content);
    if (name === 'setup.cfg')         return this.parseSetupCfg(content);
    if (name === 'setup.py')          return this.parseSetupPy(content);
    if (name === 'Cargo.toml')        return this.parseCargoToml(content);
    if (name === 'go.mod')            return this.parseGoMod(content);
    if (name === 'pom.xml')           return this.parsePomXml(content);
    if (name === 'composer.json')     return this.parseComposerJson(content);
    if (name === 'pubspec.yaml')      return this.parsePubspecYaml(content);
    if (name === 'mix.exs')           return this.parseMixExs(content);
    if (name === 'deno.json' || name === 'deno.jsonc') return this.parseDenoJson(content);

    // build.gradle / build.gradle.kts / Gemfile / Package.swift
    // have very limited metadata — skip for now.
    return null;
  }

  // ── Merging utility ──

  /**
   * Merge `partial` into `merged`, preferring values already set.
   */
  private merge(merged: ProjectMetadata, partial: Partial<ProjectMetadata>, source: string): void {
    merged.sources.push(source);

    // Simple scalar fields — first one wins
    if (!merged.name        && partial.name)        merged.name        = partial.name;
    if (!merged.version     && partial.version)     merged.version     = partial.version;
    if (!merged.description && partial.description) merged.description = partial.description;
    if (!merged.license     && partial.license)     merged.license     = partial.license;
    if (!merged.repository  && partial.repository)  merged.repository  = partial.repository;
    if (!merged.homepage    && partial.homepage)     merged.homepage    = partial.homepage;

    // Authors — de-duplicate by name
    if (partial.authors) {
      const existing = new Set(merged.authors.map(a => a.name?.toLowerCase()));
      for (const a of partial.authors) {
        if (a.name && !existing.has(a.name.toLowerCase())) {
          merged.authors.push(a);
          existing.add(a.name.toLowerCase());
        } else if (!a.name) {
          merged.authors.push(a);
        }
      }
    }

    // Keywords — deduplicate
    if (partial.keywords) {
      const kwSet = new Set(merged.keywords.map(k => k.toLowerCase()));
      for (const kw of partial.keywords) {
        if (!kwSet.has(kw.toLowerCase())) {
          merged.keywords.push(kw);
          kwSet.add(kw.toLowerCase());
        }
      }
    }
  }

  // ────────────────────── Individual parsers ──────────────────────

  // ── package.json ──

  private parsePackageJson(content: string): Partial<ProjectMetadata> {
    const json = JSON.parse(content);
    const result: Partial<ProjectMetadata> = {};

    if (json.name)        result.name        = json.name;
    if (json.version)     result.version     = json.version;
    if (json.description) result.description = json.description;
    if (json.homepage)    result.homepage    = json.homepage;

    // Author — can be a string or object
    result.authors = this.parseNpmAuthor(json.author);
    if (Array.isArray(json.contributors)) {
      for (const c of json.contributors) {
        result.authors.push(...this.parseNpmAuthor(c));
      }
    }

    // License
    if (typeof json.license === 'string') {
      result.license = { spdx: json.license };
    } else if (json.license?.type) {
      result.license = { spdx: json.license.type };
    }

    // Repository
    if (typeof json.repository === 'string') {
      result.repository = { url: json.repository, type: 'git' };
    } else if (json.repository?.url) {
      result.repository = { url: json.repository.url, type: json.repository.type || 'git' };
    }

    // Keywords
    if (Array.isArray(json.keywords)) {
      result.keywords = json.keywords.filter((k: unknown) => typeof k === 'string');
    }

    return result;
  }

  /**
   * Parse npm-style author field (string or object).
   */
  private parseNpmAuthor(raw: unknown): AuthorInfo[] {
    if (!raw) return [];

    if (typeof raw === 'string') {
      // "Name <email> (url)"
      const match = raw.match(/^([^<(]+)?(?:\s*<([^>]+)>)?(?:\s*\(([^)]+)\))?$/);
      if (match) {
        return [{
          name: match[1]?.trim(),
          email: match[2]?.trim(),
          url: match[3]?.trim(),
        }];
      }
      return [{ name: raw.trim() }];
    }

    if (typeof raw === 'object' && raw !== null) {
      const obj = raw as Record<string, unknown>;
      return [{
        name: typeof obj.name === 'string' ? obj.name : undefined,
        email: typeof obj.email === 'string' ? obj.email : undefined,
        url: typeof obj.url === 'string' ? obj.url : undefined,
      }];
    }

    return [];
  }

  // ── pyproject.toml (PEP 621 + Poetry) ──

  private parsePyprojectToml(content: string): Partial<ProjectMetadata> {
    const result: Partial<ProjectMetadata> = {};

    // [project] section (PEP 621) or [tool.poetry]
    const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (nameMatch) result.name = nameMatch[1];

    const versionMatch = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
    if (versionMatch) result.version = versionMatch[1];

    const descMatch = content.match(/^\s*description\s*=\s*"([^"]+)"/m);
    if (descMatch) result.description = descMatch[1];

    // Authors = ["Name <email>"]
    const authorsMatch = content.match(/^\s*authors\s*=\s*\[([^\]]+)\]/m);
    if (authorsMatch) {
      result.authors = [];
      const entries = authorsMatch[1].matchAll(/"([^"]+)"/g);
      for (const entry of entries) {
        const authorStr = entry[1];
        const m = authorStr.match(/^([^<]+?)(?:\s*<([^>]+)>)?$/);
        if (m) {
          result.authors.push({ name: m[1].trim(), email: m[2]?.trim() });
        }
      }
    }

    // License
    const licenseMatch = content.match(/^\s*license\s*=\s*"([^"]+)"/m);
    if (licenseMatch) result.license = { spdx: licenseMatch[1] };

    // Keywords
    const kwMatch = content.match(/^\s*keywords\s*=\s*\[([^\]]+)\]/m);
    if (kwMatch) {
      result.keywords = [];
      const kwEntries = kwMatch[1].matchAll(/"([^"]+)"/g);
      for (const kw of kwEntries) {
        result.keywords.push(kw[1]);
      }
    }

    return result;
  }

  // ── setup.cfg ──

  private parseSetupCfg(content: string): Partial<ProjectMetadata> {
    const result: Partial<ProjectMetadata> = {};
    const get = (key: string): string | undefined => {
      const m = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)`, 'm'));
      return m?.[1]?.trim();
    };

    result.name        = get('name');
    result.version     = get('version');
    result.description = get('description');
    result.homepage    = get('url') || get('home-page');

    const author = get('author');
    const email  = get('author_email') || get('author-email');
    if (author || email) {
      result.authors = [{ name: author, email }];
    }

    const license = get('license');
    if (license) result.license = { name: license };

    return result;
  }

  // ── setup.py ──

  private parseSetupPy(content: string): Partial<ProjectMetadata> {
    const result: Partial<ProjectMetadata> = {};

    const str = (key: string): string | undefined => {
      const m = content.match(new RegExp(`${key}\\s*=\\s*['"]([^'"]+)['"]`));
      return m?.[1];
    };

    result.name        = str('name');
    result.version     = str('version');
    result.description = str('description');

    const author = str('author');
    const email  = str('author_email');
    if (author || email) {
      result.authors = [{ name: author, email }];
    }

    const license = str('license');
    if (license) result.license = { name: license };

    return result;
  }

  // ── Cargo.toml ──

  private parseCargoToml(content: string): Partial<ProjectMetadata> {
    const result: Partial<ProjectMetadata> = {};

    // [package] section
    const pkgSection = content.match(/\[package\]([\s\S]*?)(?=\n\[|$)/);
    const section = pkgSection?.[1] || content;

    const str = (key: string): string | undefined => {
      const m = section.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm'));
      return m?.[1];
    };

    result.name        = str('name');
    result.version     = str('version');
    result.description = str('description');
    result.homepage    = str('homepage') || str('documentation');

    const license = str('license');
    if (license) result.license = { spdx: license };

    // Authors = ["Name <email>"]
    const authorsMatch = section.match(/^\s*authors\s*=\s*\[([^\]]+)\]/m);
    if (authorsMatch) {
      result.authors = [];
      const entries = authorsMatch[1].matchAll(/"([^"]+)"/g);
      for (const entry of entries) {
        const authorStr = entry[1];
        const m = authorStr.match(/^([^<]+?)(?:\s*<([^>]+)>)?$/);
        if (m) {
          result.authors.push({ name: m[1].trim(), email: m[2]?.trim() });
        }
      }
    }

    // Keywords
    const kwMatch = section.match(/^\s*keywords\s*=\s*\[([^\]]+)\]/m);
    if (kwMatch) {
      result.keywords = [];
      const kwEntries = kwMatch[1].matchAll(/"([^"]+)"/g);
      for (const kw of kwEntries) {
        result.keywords.push(kw[1]);
      }
    }

    // Repository
    const repo = str('repository');
    if (repo) result.repository = { url: repo, type: 'git' };

    return result;
  }

  // ── go.mod ──

  private parseGoMod(content: string): Partial<ProjectMetadata> {
    const moduleMatch = content.match(/^\s*module\s+(\S+)/m);
    if (!moduleMatch) return {};

    const modulePath = moduleMatch[1];
    // Use the last path segment as the name
    const segments = modulePath.split('/');
    return {
      name: segments[segments.length - 1],
      repository: { url: `https://${modulePath}`, type: 'git' },
    };
  }

  // ── pom.xml ──

  private parsePomXml(content: string): Partial<ProjectMetadata> {
    const result: Partial<ProjectMetadata> = {};

    const tag = (name: string): string | undefined => {
      // Only match top-level tags, not nested inside <dependencies>
      const m = content.match(new RegExp(`<${name}>([^<]+)</${name}>`));
      return m?.[1]?.trim();
    };

    const artifactId = tag('artifactId');
    const groupId    = tag('groupId');

    result.name        = artifactId || groupId;
    result.version     = tag('version');
    result.description = tag('description');
    result.homepage    = tag('url');

    // License
    const licenseName = content.match(/<license>\s*<name>([^<]+)<\/name>/);
    if (licenseName) result.license = { name: licenseName[1].trim() };

    return result;
  }

  // ── composer.json ──

  private parseComposerJson(content: string): Partial<ProjectMetadata> {
    const json = JSON.parse(content);
    const result: Partial<ProjectMetadata> = {};

    if (json.name)        result.name        = json.name;
    if (json.version)     result.version     = json.version;
    if (json.description) result.description = json.description;
    if (json.homepage)    result.homepage    = json.homepage;

    if (Array.isArray(json.authors)) {
      result.authors = json.authors.map((a: Record<string, string>) => ({
        name: a.name,
        email: a.email,
        url: a.homepage,
      }));
    }

    if (json.license) {
      result.license = { spdx: Array.isArray(json.license) ? json.license[0] : json.license };
    }

    if (Array.isArray(json.keywords)) {
      result.keywords = json.keywords;
    }

    return result;
  }

  // ── pubspec.yaml (Dart / Flutter) ──

  private parsePubspecYaml(content: string): Partial<ProjectMetadata> {
    const result: Partial<ProjectMetadata> = {};

    const str = (key: string): string | undefined => {
      const m = content.match(new RegExp(`^${key}:\\s*(.+)`, 'm'));
      return m?.[1]?.trim().replace(/^['"]|['"]$/g, '');
    };

    result.name        = str('name');
    result.version     = str('version');
    result.description = str('description');
    result.homepage    = str('homepage') || str('repository');

    const author = str('author');
    if (author) {
      const m = author.match(/^([^<]+?)(?:\s*<([^>]+)>)?$/);
      if (m) result.authors = [{ name: m[1].trim(), email: m[2]?.trim() }];
    }

    return result;
  }

  // ── mix.exs (Elixir) ──

  private parseMixExs(content: string): Partial<ProjectMetadata> {
    const result: Partial<ProjectMetadata> = {};

    const str = (key: string): string | undefined => {
      const m = content.match(new RegExp(`${key}:\\s*"([^"]+)"`));
      return m?.[1];
    };

    // App name is typically an atom `:my_app`
    const appMatch = content.match(/app:\s*:(\w+)/);
    if (appMatch) result.name = appMatch[1];

    result.version     = str('version');
    result.description = str('description');

    return result;
  }

  // ── deno.json / deno.jsonc ──

  private parseDenoJson(content: string): Partial<ProjectMetadata> {
    // Strip JSON comments for deno.jsonc
    const cleaned = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    try {
      const json = JSON.parse(cleaned);
      const result: Partial<ProjectMetadata> = {};

      if (json.name)        result.name        = json.name;
      if (json.version)     result.version     = json.version;
      if (json.description) result.description = json.description;

      return result;
    } catch {
      return {};
    }
  }
}
