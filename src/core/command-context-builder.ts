/**
 * CommandContextBuilder — Extends ContextBuilder for command inference.
 *
 * This module extends the ContextBuilder to specifically identify and extract
 * information relevant for inferring common commands (install, build, test, run).
 *
 * Features:
 *   • Identifies likely entry points (main.ts, index.js, manage.py, etc.)
 *   • Scans for script directories (scripts/, bin/) with execution logic
 *   • Extracts command snippets from build files (Makefile, docker-compose.yml, package.json scripts)
 *   • Provides structured command context for AI analysis
 *
 * @module core/command-context-builder
 */

import fs from 'fs-extra';
import path from 'path';
import { FileInfo } from './scanner.js';
import { TechReport, ProjectType } from './tech-mapper.js';
import { ContextBuilder, ContextBuilderOptions, FileWithContext, ContextBuildResult } from './context-builder.js';

// ─────────────────────────── Types ───────────────────────────

/**
 * Command type classification.
 */
export type CommandType = 'install' | 'build' | 'test' | 'run' | 'dev' | 'lint' | 'format' | 'clean' | 'deploy' | 'other';

/**
 * A detected command with its metadata.
 */
export interface DetectedCommand {
  /** The command type */
  type: CommandType;
  /** The command string (e.g., "npm install", "python manage.py runserver") */
  command: string;
  /** Description of what the command does */
  description?: string;
  /** The source file this command was extracted from */
  source: string;
  /** The line number where this command was found */
  lineNumber?: number;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * An entry point file with its metadata.
 */
export interface EntryPoint {
  /** The file information */
  file: FileInfo;
  /** The type of entry point */
  type: 'main' | 'index' | 'app' | 'server' | 'cli' | 'bin' | 'other';
  /** Confidence score (0-1) */
  confidence: number;
  /** Relative path from project root */
  relativePath: string;
}

/**
 * A script file with execution logic.
 */
export interface ScriptFile {
  /** The file information */
  file: FileInfo;
  /** The type of script (shell, python, node, etc.) */
  scriptType: 'shell' | 'python' | 'node' | 'ruby' | 'go' | 'other';
  /** Extracted commands from this script */
  commands: DetectedCommand[];
  /** Relative path from project root */
  relativePath: string;
}

/**
 * Build configuration data.
 */
export interface BuildConfig {
  /** The type of build configuration */
  type: 'makefile' | 'docker-compose' | 'package-json' | 'npm' | 'yarn' | 'pnpm' | 'cargo' | 'gradle' | 'maven' | 'other';
  /** The source file */
  source: string;
  /** Extracted commands */
  commands: DetectedCommand[];
  /** Raw configuration data (for reference) */
  rawData?: Record<string, unknown>;
}

/**
 * Extended context build result with command inference data.
 */
export interface CommandContextResult extends ContextBuildResult {
  /** Detected entry points */
  entryPoints: EntryPoint[];
  /** Script files with execution logic */
  scriptFiles: ScriptFile[];
  /** Build configurations */
  buildConfigs: BuildConfig[];
  /** All detected commands grouped by type */
  commandsByType: Map<CommandType, DetectedCommand[]>;
  /** Statistics about command detection */
  commandStats: {
    totalCommands: number;
    totalEntryPoints: number;
    totalScriptFiles: number;
    totalBuildConfigs: number;
  };
}

/**
 * Options for command context building.
 */
export interface CommandContextOptions extends ContextBuilderOptions {
  /** Whether to include script files in the main context */
  includeScripts?: boolean;
  /** Whether to include build files in the main context */
  includeBuildFiles?: boolean;
  /** Maximum number of commands to extract per file */
  maxCommandsPerFile?: number;
}

// ─────────────────── Entry Point Patterns ──────────────────

/**
 * Entry point file patterns and their types.
 */
const ENTRY_POINT_PATTERNS: ReadonlyArray<readonly [RegExp, EntryPoint['type'], number]> = [
  // Main entry points
  [/^(main|index|app|server|client|entry|init|start)$/i, 'main', 0.95],
  [/^(main|index|app|server|client|entry|init|start)\.(ts|js|py|rs|go|java|cs)$/i, 'main', 0.95],
  
  // CLI entry points
  [/^(cli|commander|cmd)$/i, 'cli', 0.90],
  [/^(cli|commander|cmd)\.(ts|js|py|rs|go)$/i, 'cli', 0.90],
  
  // Bin scripts
  [/^bin\//, 'bin', 0.85],
  [/(^|\/)bin\//, 'bin', 0.85],
  
  // App entry points
  [/^app\.(ts|js|py|rs|go)$/i, 'app', 0.90],
  [/^server\.(ts|js|py|rs|go)$/i, 'server', 0.90],
  
  // Django/Flask
  [/^manage\.py$/, 'main', 0.95],
  [/^wsgi\.py$/, 'main', 0.85],
  [/^asgi\.py$/, 'main', 0.85],
  
  // Node.js
  [/^index\.(ts|js|tsx|jsx)$/, 'index', 0.95],
  [/^server\.(ts|js)$/, 'server', 0.90],
  
  // Rust
  [/^main\.rs$/, 'main', 0.95],
  [/^lib\.rs$/, 'main', 0.85],
  
  // Go
  [/^main\.go$/, 'main', 0.95],
  
  // Java
  [/^Main\.java$/, 'main', 0.95],
  [/^Application\.java$/, 'main', 0.85],
];

// ─────────────────── Script Directory Patterns ──────────────────

/**
 * Script directory patterns.
 */
const SCRIPT_DIRECTORIES: ReadonlySet<string> = new Set([
  'scripts',
  'bin',
  'tools',
  'utils',
  'hack',
  'script',
]);

/**
 * Script file extensions.
 */
const SCRIPT_EXTENSIONS: ReadonlyMap<string, ScriptFile['scriptType']> = new Map([
  ['sh', 'shell'],
  ['bash', 'shell'],
  ['zsh', 'shell'],
  ['fish', 'shell'],
  ['ps1', 'shell'],
  ['bat', 'shell'],
  ['cmd', 'shell'],
  ['py', 'python'],
  ['js', 'node'],
  ['ts', 'node'],
  ['rb', 'ruby'],
  ['go', 'go'],
]);

// ─────────────────── Command Type Patterns ──────────────────

/**
 * Patterns for detecting command types from script names and content.
 */
const COMMAND_TYPE_PATTERNS: ReadonlyArray<readonly [RegExp, CommandType]> = [
  // Install commands
  [/^(install|setup|deps|dependencies|bootstrap)$/i, 'install'],
  [/install|setup|npm install|pip install|cargo install|go get/i, 'install'],
  
  // Build commands
  [/^(build|compile|make|bundle|transpile)$/i, 'build'],
  [/build|compile|make|webpack|vite|tsc|cargo build|go build/i, 'build'],
  
  // Test commands
  [/^(test|spec|check|verify|validate)$/i, 'test'],
  [/test|spec|jest|pytest|cargo test|go test/i, 'test'],
  
  // Run commands
  [/^(run|start|serve|dev|dev-server)$/i, 'run'],
  [/run|start|serve|dev|npm start|python manage.py runserver/i, 'run'],
  
  // Development commands
  [/^(dev|develop|watch|watch-mode)$/i, 'dev'],
  [/dev|watch|hot-reload|nodemon/i, 'dev'],
  
  // Lint commands
  [/^(lint|linting|check-style|style-check)$/i, 'lint'],
  [/lint|eslint|prettier|flake8|black|ruff|golangci-lint/i, 'lint'],
  
  // Format commands
  [/^(format|fmt|prettier|black|gofmt)$/i, 'format'],
  [/format|fmt|prettier|black|gofmt|rustfmt/i, 'format'],
  
  // Clean commands
  [/^(clean|clear|reset|purge)$/i, 'clean'],
  [/clean|clear|reset|purge|rm -rf/i, 'clean'],
  
  // Deploy commands
  [/^(deploy|release|publish|ship)$/i, 'deploy'],
  [/deploy|release|publish|ship|npm publish/i, 'deploy'],
];

// ─────────────────── Build File Patterns ──────────────────

/**
 * Build file patterns and their types.
 */
const BUILD_FILE_PATTERNS: ReadonlyMap<string, BuildConfig['type']> = new Map([
  ['Makefile', 'makefile'],
  ['makefile', 'makefile'],
  ['docker-compose.yml', 'docker-compose'],
  ['docker-compose.yaml', 'docker-compose'],
  ['package.json', 'package-json'],
  ['package-lock.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['Cargo.toml', 'cargo'],
  ['build.gradle', 'gradle'],
  ['build.gradle.kts', 'gradle'],
  ['pom.xml', 'maven'],
]);

// ─────────────────────────── Service ───────────────────────────

/**
 * `CommandContextBuilder` extends ContextBuilder to add command inference capabilities.
 *
 * @example
 * ```ts
 * import { FileScanner } from './scanner.js';
 * import { TechMapper } from './tech-mapper.js';
 * import { CommandContextBuilder } from './command-context-builder.js';
 *
 * const scanner = new FileScanner('./my-project');
 * const files = await scanner.scan();
 *
 * const mapper = new TechMapper();
 * const techReport = mapper.analyze(files);
 *
 * const builder = new CommandContextBuilder();
 * const result = await builder.buildCommandContext(files, techReport);
 *
 * console.log(`Found ${result.entryPoints.length} entry points`);
 * console.log(`Detected ${result.commandStats.totalCommands} commands`);
 * ```
 */
export class CommandContextBuilder extends ContextBuilder {
  private commandOptions: CommandContextOptions;

  constructor(options: CommandContextOptions = {}) {
    super(options);
    this.commandOptions = {
      ...options,
      includeScripts: options.includeScripts ?? true,
      includeBuildFiles: options.includeBuildFiles ?? true,
      maxCommandsPerFile: options.maxCommandsPerFile ?? 50,
    };
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Build command context by analyzing files for command-related information.
   *
   * @param files - The file list from `FileScanner.scan()`.
   * @param techReport - The tech report from `TechMapper.analyze()`.
   * @returns A `CommandContextResult` with command inference data.
   */
  public async buildCommandContext(
    files: FileInfo[],
    techReport: TechReport
  ): Promise<CommandContextResult> {
    // Build the base context first
    const baseContext = await this.build(files, techReport);

    // Detect entry points
    const entryPoints = this.detectEntryPoints(files);

    // Detect script files
    const scriptFiles = await this.detectScriptFiles(files);

    // Detect build configurations
    const buildConfigs = await this.detectBuildConfigs(files);

    // Extract commands from all sources
    const allCommands = this.extractAllCommands(entryPoints, scriptFiles, buildConfigs);

    // Group commands by type
    const commandsByType = this.groupCommandsByType(allCommands);

    // Build statistics
    const commandStats = {
      totalCommands: allCommands.length,
      totalEntryPoints: entryPoints.length,
      totalScriptFiles: scriptFiles.length,
      totalBuildConfigs: buildConfigs.length,
    };

    return {
      ...baseContext,
      entryPoints,
      scriptFiles,
      buildConfigs,
      commandsByType,
      commandStats,
    };
  }

  // ── Entry Point Detection ──────────────────────────────────────

  /**
   * Detect likely entry point files.
   */
  private detectEntryPoints(files: FileInfo[]): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];

    for (const file of files) {
      const result = this.identifyEntryPoint(file);
      if (result) {
        entryPoints.push(result);
      }
    }

    // Sort by confidence (descending)
    return entryPoints.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Identify if a file is an entry point.
   */
  private identifyEntryPoint(file: FileInfo): EntryPoint | null {
    const fileName = path.basename(file.path);
    const relativePath = file.path;

    for (const [pattern, type, confidence] of ENTRY_POINT_PATTERNS) {
      if (pattern.test(fileName) || pattern.test(relativePath)) {
        return {
          file,
          type,
          confidence,
          relativePath: path.relative(process.cwd(), file.path),
        };
      }
    }

    return null;
  }

  // ── Script File Detection ──────────────────────────────────────

  /**
   * Detect script files that may contain execution logic.
   */
  private async detectScriptFiles(files: FileInfo[]): Promise<ScriptFile[]> {
    const scriptFiles: ScriptFile[] = [];

    for (const file of files) {
      const result = await this.identifyScriptFile(file);
      if (result) {
        scriptFiles.push(result);
      }
    }

    return scriptFiles;
  }

  /**
   * Identify if a file is a script file and extract its commands.
   */
  private async identifyScriptFile(file: FileInfo): Promise<ScriptFile | null> {
    // Check if file is in a script directory
    const dirPath = path.dirname(file.path);
    const dirName = path.basename(dirPath);
    const isInScriptDir = SCRIPT_DIRECTORIES.has(dirName) || dirPath.includes('/scripts/') || dirPath.includes('\\scripts\\');

    // Check if file has a script extension
    const scriptType = SCRIPT_EXTENSIONS.get(file.extension.toLowerCase());

    if (!isInScriptDir && !scriptType) {
      return null;
    }

    // Extract commands from the script
    const commands = await this.extractCommandsFromFile(file, scriptType ?? 'other');

    if (commands.length === 0) {
      return null;
    }

    return {
      file,
      scriptType: scriptType ?? 'other',
      commands,
      relativePath: path.relative(process.cwd(), file.path),
    };
  }

  // ── Build Configuration Detection ──────────────────────────────

  /**
   * Detect build configuration files.
   */
  private async detectBuildConfigs(files: FileInfo[]): Promise<BuildConfig[]> {
    const buildConfigs: BuildConfig[] = [];

    for (const file of files) {
      const result = await this.identifyBuildConfig(file);
      if (result) {
        buildConfigs.push(result);
      }
    }

    return buildConfigs;
  }

  /**
   * Identify if a file is a build configuration and extract its commands.
   */
  private async identifyBuildConfig(file: FileInfo): Promise<BuildConfig | null> {
    const fileName = file.name;
    const buildType = BUILD_FILE_PATTERNS.get(fileName);

    if (!buildType) {
      return null;
    }

    try {
      const content = await fs.readFile(file.path, 'utf-8');
      const commands = this.extractCommandsFromBuildFile(file, buildType, content);

      let rawData: Record<string, unknown> | undefined;
      try {
        if (fileName.endsWith('.json')) {
          rawData = JSON.parse(content);
        }
      } catch {
        // Ignore parse errors
      }

      return {
        type: buildType,
        source: file.path,
        commands,
        rawData,
      };
    } catch {
      return null;
    }
  }

  // ── Command Extraction ──────────────────────────────────────

  /**
   * Extract commands from a file.
   */
  private async extractCommandsFromFile(
    file: FileInfo,
    scriptType: ScriptFile['scriptType']
  ): Promise<DetectedCommand[]> {
    try {
      const content = await fs.readFile(file.path, 'utf-8');
      const commands: DetectedCommand[] = [];
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const command = this.parseCommandFromLine(line, file.path, i + 1);
        if (command) {
          commands.push(command);
        }
      }

      return commands;
    } catch {
      return [];
    }
  }

  /**
   * Parse a command from a line of text.
   */
  private parseCommandFromLine(line: string, source: string, lineNumber: number): DetectedCommand | null {
    // Skip comments and empty lines
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith('"""')) {
      return null;
    }

    // Look for common command patterns
    const commandPatterns = [
      // npm/yarn/pnpm
      /^(npm|yarn|pnpm)\s+(install|start|build|test|run|dev|lint|format|clean|deploy)\b/,
      // Python
      /^(python|python3|pip|pip3)\s+(install|run|build|test|lint|format|clean|deploy)\b/,
      // Rust
      /^(cargo)\s+(install|build|run|test|clean|doc|publish)\b/,
      // Go
      /^(go)\s+(build|run|test|install|clean|mod|fmt)\b/,
      // Make
      /^make\s+\w+/,
      // Shell commands
      /^(npm|yarn|pnpm|python|pip|cargo|go|make|docker|docker-compose)\s+/,
    ];

    for (const pattern of commandPatterns) {
      const match = line.match(pattern);
      if (match) {
        const commandType = this.inferCommandType(match[0]);
        return {
          type: commandType,
          command: match[0],
          source,
          lineNumber,
          confidence: 0.8,
        };
      }
    }

    return null;
  }

  /**
   * Extract commands from build configuration files.
   */
  private extractCommandsFromBuildFile(
    file: FileInfo,
    buildType: BuildConfig['type'],
    content: string
  ): DetectedCommand[] {
    const commands: DetectedCommand[] = [];

    switch (buildType) {
      case 'package-json':
        return this.extractCommandsFromPackageJson(file.path, content);
      case 'makefile':
        return this.extractCommandsFromMakefile(file.path, content);
      case 'docker-compose':
        return this.extractCommandsFromDockerCompose(file.path, content);
      case 'gradle':
        return this.extractCommandsFromGradle(file.path, content);
      case 'maven':
        return this.extractCommandsFromMaven(file.path, content);
      default:
        return commands;
    }
  }

  /**
   * Extract commands from package.json scripts section.
   */
  private extractCommandsFromPackageJson(filePath: string, content: string): DetectedCommand[] {
    const commands: DetectedCommand[] = [];

    try {
      const json = JSON.parse(content);
      const scripts = json.scripts as Record<string, string> | undefined;

      if (!scripts) {
        return commands;
      }

      for (const [name, command] of Object.entries(scripts)) {
        if (typeof command === 'string') {
          const commandType = this.inferCommandType(name);
          commands.push({
            type: commandType,
            command: `npm run ${name}`,
            description: name,
            source: filePath,
            confidence: 0.95,
          });
        }
      }
    } catch {
      // Ignore parse errors
    }

    return commands;
  }

  /**
   * Extract commands from Makefile.
   */
  private extractCommandsFromMakefile(filePath: string, content: string): DetectedCommand[] {
    const commands: DetectedCommand[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Look for make targets (lines ending with :)
      const targetMatch = line.match(/^(\w[\w-]*):/);
      if (targetMatch) {
        const targetName = targetMatch[1];
        const commandType = this.inferCommandType(targetName);
        commands.push({
          type: commandType,
          command: `make ${targetName}`,
          description: targetName,
          source: filePath,
          lineNumber: i + 1,
          confidence: 0.90,
        });
      }
    }

    return commands;
  }

  /**
   * Extract commands from docker-compose.yml.
   */
  private extractCommandsFromDockerCompose(filePath: string, content: string): DetectedCommand[] {
    const commands: DetectedCommand[] = [];

    // Look for common docker-compose commands
    if (content.includes('docker-compose') || content.includes('docker compose')) {
      commands.push({
        type: 'run',
        command: 'docker-compose up',
        description: 'Start services',
        source: filePath,
        confidence: 0.85,
      });
      commands.push({
        type: 'build',
        command: 'docker-compose build',
        description: 'Build services',
        source: filePath,
        confidence: 0.85,
      });
    }

    return commands;
  }

  /**
   * Extract commands from Gradle build files.
   */
  private extractCommandsFromGradle(filePath: string, content: string): DetectedCommand[] {
    const commands: DetectedCommand[] = [];

    // Look for common Gradle tasks
    const taskPatterns: ReadonlyArray<readonly [RegExp, string]> = [
      [/task\s+\w+\s*\{[^}]*type\s*:\s*Build/i, 'build'],
      [/task\s+\w+\s*\{[^}]*type\s*:\s*Test/i, 'test'],
      [/task\s+\w+\s*\{[^}]*type\s*:\s*Run/i, 'run'],
    ];

    for (const [pattern, commandType] of taskPatterns) {
      if (pattern.test(content)) {
        commands.push({
          type: commandType as CommandType,
          command: `./gradlew ${commandType}`,
          description: `Gradle ${commandType}`,
          source: filePath,
          confidence: 0.80,
        });
      }
    }

    return commands;
  }

  /**
   * Extract commands from Maven pom.xml.
   */
  private extractCommandsFromMaven(filePath: string, content: string): DetectedCommand[] {
    const commands: DetectedCommand[] = [];

    // Maven has standard lifecycle phases
    commands.push({
      type: 'build',
      command: 'mvn compile',
      description: 'Compile project',
      source: filePath,
      confidence: 0.85,
    });
    commands.push({
      type: 'test',
      command: 'mvn test',
      description: 'Run tests',
      source: filePath,
      confidence: 0.85,
    });
    commands.push({
      type: 'install',
      command: 'mvn install',
      description: 'Install to local repository',
      source: filePath,
      confidence: 0.85,
    });

    return commands;
  }

  // ── Command Type Inference ──────────────────────────────────────

  /**
   * Infer the command type from a command string or name.
   */
  private inferCommandType(commandOrName: string): CommandType {
    const lower = commandOrName.toLowerCase();

    for (const [pattern, type] of COMMAND_TYPE_PATTERNS) {
      if (pattern.test(lower)) {
        return type;
      }
    }

    return 'other';
  }

  // ── Command Aggregation ──────────────────────────────────────

  /**
   * Extract all commands from entry points, scripts, and build configs.
   */
  private extractAllCommands(
    entryPoints: EntryPoint[],
    scriptFiles: ScriptFile[],
    buildConfigs: BuildConfig[]
  ): DetectedCommand[] {
    const allCommands: DetectedCommand[] = [];

    // Add commands from script files
    for (const scriptFile of scriptFiles) {
      allCommands.push(...scriptFile.commands);
    }

    // Add commands from build configs
    for (const buildConfig of buildConfigs) {
      allCommands.push(...buildConfig.commands);
    }

    return allCommands;
  }

  /**
   * Group commands by type.
   */
  private groupCommandsByType(commands: DetectedCommand[]): Map<CommandType, DetectedCommand[]> {
    const grouped = new Map<CommandType, DetectedCommand[]>();

    for (const command of commands) {
      const existing = grouped.get(command.type);
      if (existing) {
        existing.push(command);
      } else {
        grouped.set(command.type, [command]);
      }
    }

    return grouped;
  }

  // ── Helpers ──────────────────────────────────────────────

  /**
   * Get a summary of detected commands as a formatted string.
   */
  public getCommandSummary(result: CommandContextResult): string {
    const lines: string[] = [
      '# Command Summary',
      '',
      `Total Commands: ${result.commandStats.totalCommands}`,
      `Entry Points: ${result.commandStats.totalEntryPoints}`,
      `Script Files: ${result.commandStats.totalScriptFiles}`,
      `Build Configs: ${result.commandStats.totalBuildConfigs}`,
      '',
    ];

    for (const [type, commands] of result.commandsByType) {
      if (commands.length > 0) {
        lines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)} Commands`);
        for (const cmd of commands.slice(0, 5)) { // Show max 5 per type
          lines.push(`- \`${cmd.command}\` (${cmd.source})`);
        }
        if (commands.length > 5) {
          lines.push(`  ... and ${commands.length - 5} more`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Get entry points as a formatted string.
   */
  public getEntryPointsSummary(result: CommandContextResult): string {
    const lines: string[] = [
      '# Entry Points',
      '',
    ];

    for (const entryPoint of result.entryPoints) {
      lines.push(`- ${entryPoint.relativePath} (${entryPoint.type}, confidence: ${entryPoint.confidence.toFixed(2)})`);
    }

    return lines.join('\n');
  }
}
