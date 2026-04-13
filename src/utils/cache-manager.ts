/**
 * CacheManager — Manages analysis cache for faster re-runs.
 *
 * Stores and loads cached analysis data from `.readme-ai-gen-cache.json`
 * in the project root. Cache includes file hashes to detect project changes.
 *
 * Features:
 *   • Load/save cache with structured data
 *   • File hash-based staleness detection
 *   • TTL-based expiration
 *   • Project path validation
 *
 * @module utils/cache-manager
 */

import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { FileInfo } from '../core/scanner.js';
import { TechReport } from '../core/tech-mapper.js';
import { ProjectMetadata } from '../core/metadata-extractor.js';
import { ValidatedCommand } from '../core/command-inference.js';

// ─────────────────────────── Types ───────────────────────────

/**
 * Cached data structure stored in `.readme-ai-gen-cache.json`.
 */
export interface CacheData {
  /** Cache format version */
  version: string;
  /** When the cache was created/updated */
  cachedAt: string;
  /** Time-to-live in hours */
  ttlHours: number;
  /** Absolute path to the project that was analyzed */
  projectPath: string;
  /** File hashes for staleness detection */
  fileHashes: Record<string, string>;
  /** The actual cached analysis data */
  cachedData: {
    techReport: TechReport;
    metadata: ProjectMetadata;
    commands: ValidatedCommand[];
    tree: string;
    fileCount: number;
  };
}

/**
 * Key files to hash for cache validation.
 */
const CACHE_KEY_FILES = [
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'composer.json',
  'pubspec.yaml',
  'mix.exs',
  'deno.json',
  'deno.jsonc',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'vite.config.ts',
  'vite.config.js',
  'angular.json',
  'svelte.config.js',
  'svelte.config.ts',
  'astro.config.mjs',
];

const CACHE_FILENAME = '.readme-ai-gen-cache.json';
const CACHE_VERSION = '1.0.0';

// ─────────────────────────── Helpers ───────────────────────────

/**
 * Compute SHA-256 hash of a file's contents.
 */
function hashFile(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

// ─────────────────────────── CacheManager ───────────────────────────

/**
 * `CacheManager` handles loading, saving, and validating the analysis cache.
 *
 * @example
 * ```ts
 * const cache = new CacheManager('/path/to/project');
 *
 * // Try to load existing cache
 * const cached = await cache.load();
 * if (cached && !await cache.isStale()) {
 *   // Use cached data
 *   console.log(cached.cachedData.techReport);
 * }
 *
 * // Save new cache
 * await cache.save({ techReport, metadata, commands, tree, fileCount });
 * ```
 */
export class CacheManager {
  private projectPath: string;
  private cacheFilePath: string;

  /**
   * Create a new CacheManager.
   *
   * @param projectPath - Absolute path to the project root.
   */
  constructor(projectPath: string) {
    this.projectPath = path.resolve(projectPath);
    this.cacheFilePath = path.join(this.projectPath, CACHE_FILENAME);
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Load cache from disk if it exists.
   *
   * @returns Parsed cache data or null if no cache file exists.
   */
  public async load(): Promise<CacheData | null> {
    try {
      if (!(await fs.pathExists(this.cacheFilePath))) {
        return null;
      }

      const raw = await fs.readFile(this.cacheFilePath, 'utf-8');
      const data = JSON.parse(raw) as CacheData;

      // Validate basic structure
      if (!data.version || !data.cachedAt || !data.projectPath) {
        return null;
      }

      return data;
    } catch {
      return null;
    }
  }

  /**
   * Save cache data to disk.
   *
   * @param cacheData - The analysis data to cache.
   */
  public async save(cacheData: CacheData['cachedData']): Promise<void> {
    // Compute file hashes for current project state
    const fileHashes = this.computeFileHashes();

    const data: CacheData = {
      version: CACHE_VERSION,
      cachedAt: new Date().toISOString(),
      ttlHours: 24, // Default, can be overridden
      projectPath: this.projectPath,
      fileHashes,
      cachedData: cacheData,
    };

    await fs.writeFile(this.cacheFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Save cache with a custom TTL.
   *
   * @param cacheData - The analysis data to cache.
   * @param ttlHours - Time-to-live in hours.
   */
  public async saveWithTtl(cacheData: CacheData['cachedData'], ttlHours: number): Promise<void> {
    const fileHashes = this.computeFileHashes();

    const data: CacheData = {
      version: CACHE_VERSION,
      cachedAt: new Date().toISOString(),
      ttlHours,
      projectPath: this.projectPath,
      fileHashes,
      cachedData: cacheData,
    };

    await fs.writeFile(this.cacheFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Delete the cache file.
   */
  public async clear(): Promise<void> {
    try {
      if (await fs.pathExists(this.cacheFilePath)) {
        await fs.unlink(this.cacheFilePath);
      }
    } catch {
      // Ignore errors when clearing cache
    }
  }

  /**
   * Check if the cache file exists.
   */
  public async exists(): Promise<boolean> {
    return fs.pathExists(this.cacheFilePath);
  }

  /**
   * Check if the cache is stale or invalid.
   *
   * Cache is stale if:
   * - No cache file exists
   * - TTL has expired
   * - Project path has changed
   * - Any key file hash differs from cached version
   *
   * @returns True if cache is stale/invalid and should be rebuilt.
   */
  public async isStale(): Promise<boolean> {
    const cached = await this.load();
    if (!cached) {
      return true;
    }

    // Check project path
    if (cached.projectPath !== this.projectPath) {
      return true;
    }

    // Check TTL
    const cachedAt = new Date(cached.cachedAt).getTime();
    const ttlMs = cached.ttlHours * 60 * 60 * 1000;
    const now = Date.now();

    if (now - cachedAt > ttlMs) {
      return true;
    }

    // Check file hashes
    const currentHashes = this.computeFileHashes();
    for (const [fileName, cachedHash] of Object.entries(cached.fileHashes)) {
      const currentHash = currentHashes[fileName];
      if (!currentHash || currentHash !== cachedHash) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get the absolute path to the cache file.
   */
  public getCacheFilePath(): string {
    return this.cacheFilePath;
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Compute hashes of key project files.
   */
  private computeFileHashes(): Record<string, string> {
    const hashes: Record<string, string> = {};

    for (const fileName of CACHE_KEY_FILES) {
      const filePath = path.join(this.projectPath, fileName);
      const hash = hashFile(filePath);
      if (hash) {
        hashes[fileName] = hash;
      }
    }

    return hashes;
  }
}
