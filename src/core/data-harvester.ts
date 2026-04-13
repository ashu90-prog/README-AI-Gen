/**
 * DataHarvester — Extracts raw dependency data from configuration files.
 *
 * Consumes the `FileInfo[]` produced by `FileScanner` (scanner.ts) and
 * parses configuration files (package.json, requirements.txt, etc.) to
 * extract structured dependency information for downstream analysis.
 *
 * @module core/data-harvester
 */

import fs from 'fs-extra';
import path from 'path';
import { FileInfo } from './scanner.js';

// ─────────────────────────── Types ───────────────────────────

/**
 * Represents a single dependency entry.
 */
export interface Dependency {
  /** The dependency name or identifier */
  name: string;
  /** The version or version range (if available) */
  version?: string;
  /** The type of dependency (e.g., 'runtime', 'dev', 'peer', etc.) */
  type: DependencyType;
  /** The source file this dependency was extracted from */
  source: string;
}

/**
 * Dependency type classification.
 */
export type DependencyType = 'runtime' | 'dev' | 'peer' | 'optional' | 'unknown';

/**
 * Configuration file type identifier.
 */
export type ConfigFileType =
  | 'package.json'
  | 'requirements.txt'
  | 'pyproject.toml'
  | 'setup.py'
  | 'Cargo.toml'
  | 'go.mod'
  | 'pom.xml'
  | 'build.gradle'
  | 'Gemfile'
  | 'composer.json'
  | 'unknown';

/**
 * Harvested data from a single configuration file.
 */
export interface ConfigFileData {
  /** The type of configuration file */
  fileType: ConfigFileType;
  /** The path to the configuration file */
  filePath: string;
  /** Extracted dependencies */
  dependencies: Dependency[];
  /** Any metadata extracted from the file */
  metadata?: Record<string, unknown>;
}

/**
 * Complete harvest result containing all extracted data.
 */
export interface HarvestResult {
  /** All configuration files found and parsed */
  configFiles: ConfigFileData[];
  /** All dependencies grouped by name */
  dependencies: Map<string, Dependency[]>;
  /** Total number of dependencies found */
  totalDependencies: number;
}

// ─────────────────── Configuration File Patterns ──────────────────

/**
 * Registry of configuration file patterns and their types.
 */
const CONFIG_FILE_PATTERNS: ReadonlyMap<string, ConfigFileType> = new Map([
  // JavaScript/TypeScript ecosystem
  ['package.json', 'package.json'],
  ['package-lock.json', 'package.json'],
  ['yarn.lock', 'package.json'],
  ['pnpm-lock.yaml', 'package.json'],

  // Python ecosystem
  ['requirements.txt', 'requirements.txt'],
  ['requirements-dev.txt', 'requirements.txt'],
  ['pyproject.toml', 'pyproject.toml'],
  ['setup.py', 'setup.py'],
  ['setup.cfg', 'setup.py'],
  ['Pipfile', 'pyproject.toml'],
  ['poetry.lock', 'pyproject.toml'],

  // Rust
  ['Cargo.toml', 'Cargo.toml'],
  ['Cargo.lock', 'Cargo.toml'],

  // Go
  ['go.mod', 'go.mod'],
  ['go.sum', 'go.mod'],

  // Java/JVM
  ['pom.xml', 'pom.xml'],
  ['build.gradle', 'build.gradle'],
  ['build.gradle.kts', 'build.gradle'],
  ['gradle.properties', 'build.gradle'],

  // Ruby
  ['Gemfile', 'Gemfile'],
  ['Gemfile.lock', 'Gemfile'],

  // PHP
  ['composer.json', 'composer.json'],
  ['composer.lock', 'composer.json'],
]);

// ─────────────────────────── Service ───────────────────────────

/**
 * `DataHarvester` extracts dependency information from configuration files.
 *
 * @example
 * ```ts
 * import { FileScanner } from './scanner.js';
 * import { DataHarvester } from './data-harvester.js';
 *
 * const scanner = new FileScanner('./my-project');
 * const files = await scanner.scan();
 * const harvester = new DataHarvester();
 * const result = await harvester.harvest(files);
 *
 * console.log(result.configFiles);    // Array of parsed config files
 * console.log(result.dependencies);   // Map of dependency name → entries
 * ```
 */
export class DataHarvester {
  // ── Public read-only access to the registry ──

  /** Configuration file pattern registry. */
  public static readonly configPatterns = CONFIG_FILE_PATTERNS;

  // ── Core harvesting ──

  /**
   * Harvest dependency data from a list of files.
   *
   * @param files - The file list returned by `FileScanner.scan()`.
   * @returns A `HarvestResult` with all extracted dependency data.
   */
  public async harvest(files: FileInfo[]): Promise<HarvestResult> {
    const configFiles: ConfigFileData[] = [];
    const dependencies = new Map<string, Dependency[]>();

    for (const file of files) {
      const fileType = this.identifyConfigFile(file.name);
      
      if (fileType === 'unknown') {
        continue;
      }

      try {
        const configFileData = await this.parseConfigFile(file, fileType);
        configFiles.push(configFileData);

        for (const dep of configFileData.dependencies) {
          const existing = dependencies.get(dep.name);
          if (existing) {
            existing.push(dep);
          } else {
            dependencies.set(dep.name, [dep]);
          }
        }
      } catch (error) {
        console.warn(`Failed to parse ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      configFiles,
      dependencies,
      totalDependencies: Array.from(dependencies.values()).reduce((sum, deps) => sum + deps.length, 0),
    };
  }

  // ── Configuration file identification ──

  /**
   * Identify the type of a configuration file by its name.
   */
  private identifyConfigFile(fileName: string): ConfigFileType {
    return CONFIG_FILE_PATTERNS.get(fileName) || 'unknown';
  }

  // ── Configuration file parsing ──

  /**
   * Parse a configuration file and extract its dependencies.
   */
  private async parseConfigFile(file: FileInfo, fileType: ConfigFileType): Promise<ConfigFileData> {
    const content = await fs.readFile(file.path, 'utf-8');

    switch (fileType) {
      case 'package.json':
        return this.parsePackageJson(file.path, content);
      case 'requirements.txt':
        return this.parseRequirementsTxt(file.path, content);
      case 'pyproject.toml':
        return this.parsePyprojectToml(file.path, content);
      case 'setup.py':
        return this.parseSetupPy(file.path, content);
      case 'Cargo.toml':
        return this.parseCargoToml(file.path, content);
      case 'go.mod':
        return this.parseGoMod(file.path, content);
      case 'pom.xml':
        return this.parsePomXml(file.path, content);
      case 'build.gradle':
        return this.parseBuildGradle(file.path, content);
      case 'Gemfile':
        return this.parseGemfile(file.path, content);
      case 'composer.json':
        return this.parseComposerJson(file.path, content);
      default:
        return {
          fileType,
          filePath: file.path,
          dependencies: [],
        };
    }
  }

  // ── Package.json parsing ──

  private parsePackageJson(filePath: string, content: string): ConfigFileData {
    const json = JSON.parse(content);
    const dependencies: Dependency[] = [];

    const addDeps = (deps: Record<string, string> | undefined, type: DependencyType) => {
      if (!deps) return;
      for (const [name, version] of Object.entries(deps)) {
        dependencies.push({ name, version, type, source: filePath });
      }
    };

    addDeps(json.dependencies as Record<string, string>, 'runtime');
    addDeps(json.devDependencies as Record<string, string>, 'dev');
    addDeps(json.peerDependencies as Record<string, string>, 'peer');
    addDeps(json.optionalDependencies as Record<string, string>, 'optional');

    return {
      fileType: 'package.json',
      filePath,
      dependencies,
      metadata: {
        name: json.name,
        version: json.version,
        description: json.description,
      },
    };
  }

  // ── Requirements.txt parsing ──

  private parseRequirementsTxt(filePath: string, content: string): ConfigFileData {
    const dependencies: Dependency[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) {
        continue;
      }

      const match = trimmed.match(/^([a-zA-Z0-9._-]+)(?:[>=<~!]+(.+))?$/);
      if (match) {
        const name = match[1];
        const version = match[2] || undefined;
        dependencies.push({ name, version, type: 'runtime', source: filePath });
      }
    }

    return {
      fileType: 'requirements.txt',
      filePath,
      dependencies,
    };
  }

  // ── Pyproject.toml parsing ──

  private parsePyprojectToml(filePath: string, content: string): ConfigFileData {
    const dependencies: Dependency[] = [];

    const parseSection = (section: string, type: DependencyType) => {
      const regex = new RegExp(`\\[${section}\\]([\\s\\S]*?)(?=\\[|$)`);
      const match = content.match(regex);
      
      if (!match) return;

      const sectionContent = match[1];
      const depRegex = /^([a-zA-Z0-9._-]+)\s*=\s*["']?([^"'\n]+)["']?$/gm;
      
      let depMatch;
      while ((depMatch = depRegex.exec(sectionContent)) !== null) {
        const name = depMatch[1];
        const version = depMatch[2].replace(/["']/g, '');
        dependencies.push({ name, version, type, source: filePath });
      }
    };

    parseSection('dependencies', 'runtime');
    parseSection('dev-dependencies', 'dev');
    parseSection('tool.poetry.dependencies', 'runtime');
    parseSection('tool.poetry.dev-dependencies', 'dev');

    return {
      fileType: 'pyproject.toml',
      filePath,
      dependencies,
    };
  }

  // ── Setup.py parsing ──

  private parseSetupPy(filePath: string, content: string): ConfigFileData {
    const dependencies: Dependency[] = [];

    const installRequiresMatch = content.match(/install_requires\s*=\s*\[([^\]]+)\]/);
    if (installRequiresMatch) {
      const depsContent = installRequiresMatch[1];
      const depRegex = /["']([^"']+)["']/g;
      let depMatch;
      
      while ((depMatch = depRegex.exec(depsContent)) !== null) {
        const depString = depMatch[1];
        const nameMatch = depString.match(/^([a-zA-Z0-9._-]+)/);
        if (nameMatch) {
          const name = nameMatch[1];
          const versionMatch = depString.match(/[>=<~!]+(.+)/);
          const version = versionMatch ? versionMatch[1] : undefined;
          dependencies.push({ name, version, type: 'runtime', source: filePath });
        }
      }
    }

    return {
      fileType: 'setup.py',
      filePath,
      dependencies,
    };
  }

  // ── Cargo.toml parsing ──

  private parseCargoToml(filePath: string, content: string): ConfigFileData {
    const dependencies: Dependency[] = [];

    const parseSection = (section: string, type: DependencyType) => {
      const regex = new RegExp(`\\[${section}\\]([\\s\\S]*?)(?=\\[|$)`);
      const match = content.match(regex);
      
      if (!match) return;

      const sectionContent = match[1];
      const depRegex = /^([a-zA-Z0-9_-]+)\s*=\s*["']?([^"'\n]+)["']?$/gm;
      
      let depMatch;
      while ((depMatch = depRegex.exec(sectionContent)) !== null) {
        const name = depMatch[1];
        const version = depMatch[2].replace(/["']/g, '');
        dependencies.push({ name, version, type, source: filePath });
      }
    };

    parseSection('dependencies', 'runtime');
    parseSection('dev-dependencies', 'dev');

    return {
      fileType: 'Cargo.toml',
      filePath,
      dependencies,
    };
  }

  // ── Go.mod parsing ──

  private parseGoMod(filePath: string, content: string): ConfigFileData {
    const dependencies: Dependency[] = [];
    const lines = content.split('\n');

    let inRequire = false;
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('require')) {
        inRequire = true;
        continue;
      }

      if (inRequire && trimmed.startsWith(')')) {
        inRequire = false;
        continue;
      }

      if (inRequire) {
        const match = trimmed.match(/^([a-zA-Z0-9._/-]+)\s+([a-zA-Z0-9._/-]+)$/);
        if (match) {
          const name = match[1];
          const version = match[2];
          dependencies.push({ name, version, type: 'runtime', source: filePath });
        }
      }
    }

    return {
      fileType: 'go.mod',
      filePath,
      dependencies,
    };
  }

  // ── Pom.xml parsing ──

  private parsePomXml(filePath: string, content: string): ConfigFileData {
    const dependencies: Dependency[] = [];

    const depRegex = /<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<version>([^<]*)<\/version>[\s\S]*?<\/dependency>/g;
    
    let depMatch;
    while ((depMatch = depRegex.exec(content)) !== null) {
      const groupId = depMatch[1].trim();
      const artifactId = depMatch[2].trim();
      const version = depMatch[3].trim() || undefined;
      const name = `${groupId}:${artifactId}`;
      dependencies.push({ name, version, type: 'runtime', source: filePath });
    }

    return {
      fileType: 'pom.xml',
      filePath,
      dependencies,
    };
  }

  // ── Build.gradle parsing ──

  private parseBuildGradle(filePath: string, content: string): ConfigFileData {
    const dependencies: Dependency[] = [];

    const depRegex = /(?:implementation|api|testImplementation|compile|runtime|testCompile)\s*['"]([^'"]+)['"]/g;
    
    let depMatch;
    while ((depMatch = depRegex.exec(content)) !== null) {
      const depString = depMatch[1];
      const parts = depString.split(':');
      const name = parts[0] || depString;
      const version = parts[2] || undefined;
      const type = depString.includes('test') ? 'dev' : 'runtime';
      dependencies.push({ name, version, type, source: filePath });
    }

    return {
      fileType: 'build.gradle',
      filePath,
      dependencies,
    };
  }

  // ── Gemfile parsing ──

  private parseGemfile(filePath: string, content: string): ConfigFileData {
    const dependencies: Dependency[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('source') || trimmed.startsWith('group')) {
        continue;
      }

      const match = trimmed.match(/^gem\s+['"]([^'"]+)['"](?:,\s*['"]?([^'"]+)['"])?/);
      if (match) {
        const name = match[1];
        const version = match[2] || undefined;
        dependencies.push({ name, version, type: 'runtime', source: filePath });
      }
    }

    return {
      fileType: 'Gemfile',
      filePath,
      dependencies,
    };
  }

  // ── Composer.json parsing ──

  private parseComposerJson(filePath: string, content: string): ConfigFileData {
    const json = JSON.parse(content);
    const dependencies: Dependency[] = [];

    const addDeps = (deps: Record<string, string> | undefined, type: DependencyType) => {
      if (!deps) return;
      for (const [name, version] of Object.entries(deps)) {
        dependencies.push({ name, version, type, source: filePath });
      }
    };

    addDeps(json.require as Record<string, string>, 'runtime');
    addDeps(json['require-dev'] as Record<string, string>, 'dev');

    return {
      fileType: 'composer.json',
      filePath,
      dependencies,
      metadata: {
        name: json.name,
        version: json.version,
        description: json.description,
      },
    };
  }

  // ── Convenience helpers ──

  /**
   * Get all dependencies of a specific type.
   */
  public getDependenciesByType(result: HarvestResult, type: DependencyType): Dependency[] {
    const allDeps: Dependency[] = [];
    for (const deps of result.dependencies.values()) {
      allDeps.push(...deps.filter(d => d.type === type));
    }
    return allDeps;
  }

  /**
   * Get unique dependency names.
   */
  public getUniqueDependencyNames(result: HarvestResult): string[] {
    return Array.from(result.dependencies.keys());
  }

  /**
   * Get dependencies grouped by source file.
   */
  public getDependenciesBySource(result: HarvestResult): Map<string, Dependency[]> {
    const bySource = new Map<string, Dependency[]>();
    for (const configFile of result.configFiles) {
      bySource.set(configFile.filePath, configFile.dependencies);
    }
    return bySource;
  }
}
