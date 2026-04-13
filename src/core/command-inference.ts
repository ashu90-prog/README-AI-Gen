/**
 * CommandInference — Validates AI-inferred commands and provides heuristic fallbacks.
 *
 * This module acts as the final gate between raw AI suggestions and the
 * commands shown to the user.  It has two complementary responsibilities:
 *
 *   1. **CommandValidator** — Cross-references AI-generated commands
 *      (from `ResponseParser.ExtractedCommand`) against the detected
 *      `TechReport` (from `TechMapper`) and static analysis commands
 *      (from `CommandContextBuilder`) to reject or flag mismatches
 *      (e.g. `pip install` in a pure Node.js project).
 *
 *   2. **HeuristicFallback** — When the AI response is empty, incomplete,
 *      or too unreliable, falls back to standard commands derived purely
 *      from the detected project type and build configuration.
 *
 * Consumes types from:
 *   • `tech-mapper.ts`            → `TechReport`, `ProjectType`
 *   • `response-parser.ts`        → `ExtractedCommand`, `CommandCategory`
 *   • `command-context-builder.ts` → `DetectedCommand`, `CommandContextResult`
 *   • `data-harvester.ts`         → `HarvestResult`
 *
 * Produces:
 *   • `ValidatedCommand[]` — cleaned, validated, ready for CLI display
 *
 * @module core/command-inference
 */

import { TechReport, ProjectType } from './tech-mapper.js';
import { ExtractedCommand, CommandCategory } from './response-parser.js';
import { DetectedCommand, CommandContextResult } from './command-context-builder.js';
import { HarvestResult } from './data-harvester.js';

// ─────────────────────────── Types ───────────────────────────

/**
 * A command that has passed validation (or was generated heuristically).
 */
export interface ValidatedCommand {
  /** The command string to display / execute. */
  command: string;
  /** Human-readable description. */
  description: string;
  /** Broad category. */
  category: CommandCategory;
  /** Where this command came from. */
  source: CommandSource;
  /** Confidence score (0-1); higher = more trustworthy. */
  confidence: number;
  /** Validation issues that were found but deemed acceptable. */
  warnings: string[];
}

/**
 * Provenance of a validated command.
 */
export type CommandSource =
  | 'ai'              // From AI response (parsed by ResponseParser)
  | 'static-analysis' // From CommandContextBuilder / build-file parsing
  | 'heuristic';      // Generated from detected project type alone

/**
 * Outcome of validating a single AI-extracted command.
 */
export interface CommandValidationResult {
  /** The original command. */
  original: ExtractedCommand;
  /** Whether the command is acceptable. */
  accepted: boolean;
  /** Confidence adjustment (negative = less trustworthy). */
  confidenceAdjust: number;
  /** Reasons for rejection or warnings. */
  reasons: string[];
}

/**
 * The full inference result produced by `CommandInference.infer()`.
 */
export interface InferenceResult {
  /** Final merged list of validated commands (sorted by category priority). */
  commands: ValidatedCommand[];
  /** AI commands that were rejected during validation. */
  rejected: CommandValidationResult[];
  /** Whether fallback heuristics were used (AI was insufficient). */
  usedFallback: boolean;
  /** Summary stats. */
  stats: {
    aiCommandsReceived: number;
    aiCommandsAccepted: number;
    aiCommandsRejected: number;
    staticCommandsUsed: number;
    heuristicCommandsUsed: number;
  };
}

// ─────────────────── Ecosystem → Package Manager mapping ───────────────────

/**
 * Maps project-type IDs to their canonical package-manager commands.
 * Used for both validation (wrong PM detection) and heuristic fallbacks.
 */
interface EcosystemCommands {
  /** Package managers that belong to this ecosystem. */
  packageManagers: RegExp;
  /** Package managers that do NOT belong to this ecosystem. */
  foreignManagers: RegExp;
  /** Heuristic fallback commands keyed by category. */
  fallbacks: Partial<Record<CommandCategory, FallbackSpec>>;
}

interface FallbackSpec {
  command: string;
  description: string;
}

const ECOSYSTEM_COMMANDS: ReadonlyMap<string, EcosystemCommands> = new Map([
  // ── Node.js / TypeScript ──
  ['nodejs', {
    packageManagers: /\b(npm|npx|yarn|pnpm|bun)\b/i,
    foreignManagers: /\b(pip|pip3|poetry|conda|cargo|go\s+get|bundle|composer|gem|mix)\b/i,
    fallbacks: {
      install: { command: 'npm install',    description: 'Install project dependencies' },
      build:   { command: 'npm run build',  description: 'Build the project' },
      test:    { command: 'npm test',       description: 'Run the test suite' },
      run:     { command: 'npm start',      description: 'Start the application' },
      lint:    { command: 'npm run lint',    description: 'Lint the codebase' },
    },
  }],

  // ── Python ──
  ['python', {
    packageManagers: /\b(pip|pip3|poetry|conda|pipenv|uv)\b/i,
    foreignManagers: /\b(npm|yarn|pnpm|cargo|go\s+get|bundle|composer|gem)\b/i,
    fallbacks: {
      install: { command: 'pip install -r requirements.txt', description: 'Install Python dependencies' },
      build:   { command: 'python setup.py build',           description: 'Build the project' },
      test:    { command: 'pytest',                          description: 'Run tests with pytest' },
      run:     { command: 'python main.py',                  description: 'Run the application' },
      lint:    { command: 'ruff check .',                    description: 'Lint the codebase' },
    },
  }],

  // ── Django (Python sub-type) ──
  ['django', {
    packageManagers: /\b(pip|pip3|poetry|conda|pipenv|uv)\b/i,
    foreignManagers: /\b(npm|yarn|pnpm|cargo|go\s+get|bundle|composer|gem)\b/i,
    fallbacks: {
      install: { command: 'pip install -r requirements.txt', description: 'Install Python dependencies' },
      build:   { command: 'python manage.py collectstatic',  description: 'Collect static files' },
      test:    { command: 'python manage.py test',           description: 'Run Django tests' },
      run:     { command: 'python manage.py runserver',      description: 'Start the Django dev server' },
    },
  }],

  // ── Rust ──
  ['rust', {
    packageManagers: /\b(cargo|rustup)\b/i,
    foreignManagers: /\b(npm|yarn|pip|pip3|go\s+get|bundle|composer|gem)\b/i,
    fallbacks: {
      install: { command: 'cargo build',       description: 'Build and fetch dependencies' },
      build:   { command: 'cargo build --release', description: 'Build a release binary' },
      test:    { command: 'cargo test',         description: 'Run the test suite' },
      run:     { command: 'cargo run',          description: 'Run the application' },
      lint:    { command: 'cargo clippy',       description: 'Lint with Clippy' },
    },
  }],

  // ── Go ──
  ['go', {
    packageManagers: /\b(go)\b/i,
    foreignManagers: /\b(npm|yarn|pip|pip3|cargo|bundle|composer|gem)\b/i,
    fallbacks: {
      install: { command: 'go mod download', description: 'Download Go module dependencies' },
      build:   { command: 'go build ./...',  description: 'Build the project' },
      test:    { command: 'go test ./...',   description: 'Run all tests' },
      run:     { command: 'go run .',        description: 'Run the application' },
      lint:    { command: 'golangci-lint run', description: 'Lint the codebase' },
    },
  }],

  // ── Java (Maven) ──
  ['java-maven', {
    packageManagers: /\b(mvn|maven)\b/i,
    foreignManagers: /\b(npm|yarn|pip|cargo|go\s+get|bundle|composer|gem)\b/i,
    fallbacks: {
      install: { command: 'mvn install',  description: 'Install dependencies and build' },
      build:   { command: 'mvn package',  description: 'Package the application' },
      test:    { command: 'mvn test',     description: 'Run the test suite' },
      run:     { command: 'mvn exec:java', description: 'Run the application' },
    },
  }],

  // ── Java (Gradle) ──
  ['java-gradle', {
    packageManagers: /\b(gradle|gradlew)\b/i,
    foreignManagers: /\b(npm|yarn|pip|cargo|go\s+get|bundle|composer|gem|mvn)\b/i,
    fallbacks: {
      install: { command: './gradlew build',    description: 'Build and fetch dependencies' },
      build:   { command: './gradlew assemble',  description: 'Assemble the project' },
      test:    { command: './gradlew test',      description: 'Run the test suite' },
      run:     { command: './gradlew run',       description: 'Run the application' },
    },
  }],

  // ── Kotlin (Gradle) ──
  ['kotlin-gradle', {
    packageManagers: /\b(gradle|gradlew)\b/i,
    foreignManagers: /\b(npm|yarn|pip|cargo|go\s+get|bundle|composer|gem|mvn)\b/i,
    fallbacks: {
      install: { command: './gradlew build',    description: 'Build and fetch dependencies' },
      build:   { command: './gradlew assemble',  description: 'Assemble the project' },
      test:    { command: './gradlew test',      description: 'Run the test suite' },
      run:     { command: './gradlew run',       description: 'Run the application' },
    },
  }],

  // ── Ruby ──
  ['ruby', {
    packageManagers: /\b(bundle|gem|rake)\b/i,
    foreignManagers: /\b(npm|yarn|pip|cargo|go\s+get|composer)\b/i,
    fallbacks: {
      install: { command: 'bundle install', description: 'Install Ruby gems' },
      build:   { command: 'rake build',     description: 'Build the project' },
      test:    { command: 'bundle exec rspec', description: 'Run RSpec tests' },
      run:     { command: 'bundle exec ruby main.rb', description: 'Run the application' },
    },
  }],

  // ── PHP ──
  ['php', {
    packageManagers: /\b(composer|php|artisan)\b/i,
    foreignManagers: /\b(npm|yarn|pip|cargo|go\s+get|bundle|gem)\b/i,
    fallbacks: {
      install: { command: 'composer install',        description: 'Install PHP dependencies' },
      build:   { command: 'composer dump-autoload',  description: 'Rebuild autoloader' },
      test:    { command: 'vendor/bin/phpunit',       description: 'Run PHPUnit tests' },
      run:     { command: 'php artisan serve',        description: 'Start the Laravel dev server' },
    },
  }],

  // ── Dart / Flutter ──
  ['dart', {
    packageManagers: /\b(dart|flutter|pub)\b/i,
    foreignManagers: /\b(npm|yarn|pip|cargo|go\s+get|bundle|composer|gem)\b/i,
    fallbacks: {
      install: { command: 'flutter pub get',  description: 'Install Dart/Flutter dependencies' },
      build:   { command: 'flutter build',    description: 'Build the application' },
      test:    { command: 'flutter test',     description: 'Run Flutter tests' },
      run:     { command: 'flutter run',      description: 'Run the application' },
    },
  }],

  // ── Elixir ──
  ['elixir', {
    packageManagers: /\b(mix|hex)\b/i,
    foreignManagers: /\b(npm|yarn|pip|cargo|go\s+get|bundle|composer|gem)\b/i,
    fallbacks: {
      install: { command: 'mix deps.get',   description: 'Fetch Elixir dependencies' },
      build:   { command: 'mix compile',    description: 'Compile the project' },
      test:    { command: 'mix test',       description: 'Run ExUnit tests' },
      run:     { command: 'mix phx.server', description: 'Start the Phoenix server' },
    },
  }],

  // ── .NET / C# ──
  ['dotnet', {
    packageManagers: /\b(dotnet|nuget)\b/i,
    foreignManagers: /\b(npm|yarn|pip|cargo|go\s+get|bundle|composer|gem)\b/i,
    fallbacks: {
      install: { command: 'dotnet restore', description: 'Restore NuGet packages' },
      build:   { command: 'dotnet build',   description: 'Build the project' },
      test:    { command: 'dotnet test',    description: 'Run the test suite' },
      run:     { command: 'dotnet run',     description: 'Run the application' },
    },
  }],

  // ── Swift ──
  ['swift', {
    packageManagers: /\b(swift|spm)\b/i,
    foreignManagers: /\b(npm|yarn|pip|cargo|go\s+get|bundle|composer|gem)\b/i,
    fallbacks: {
      install: { command: 'swift package resolve', description: 'Resolve Swift packages' },
      build:   { command: 'swift build',            description: 'Build the project' },
      test:    { command: 'swift test',             description: 'Run the test suite' },
      run:     { command: 'swift run',              description: 'Run the application' },
    },
  }],

  // ── Docker ──
  ['docker', {
    packageManagers: /\b(docker|docker-compose)\b/i,
    foreignManagers: /(?!)/,  // Docker can coexist with anything
    fallbacks: {
      build: { command: 'docker build -t app .', description: 'Build the Docker image' },
      run:   { command: 'docker-compose up',     description: 'Start all services' },
    },
  }],
]);

// ─────────────────── Category display priority ───────────────────

/**
 * Preferred order for displaying command categories.
 */
const CATEGORY_PRIORITY: ReadonlyArray<CommandCategory> = [
  'install', 'build', 'run', 'test', 'lint', 'deploy', 'setup', 'other',
];

// ─────────────────────────── Service ───────────────────────────

/**
 * `CommandInference` validates AI-generated commands and fills gaps with
 * heuristic defaults based on the detected project type.
 *
 * @example
 * ```ts
 * import { CommandInference } from './command-inference.js';
 * import { ResponseParser }   from './response-parser.js';
 *
 * const parser  = new ResponseParser();
 * const parsed  = parser.parse(aiResponse, techReport, harvestResult);
 *
 * const inference = new CommandInference();
 * const result = inference.infer(
 *   parsed.commands,
 *   techReport,
 *   commandContextResult,
 *   harvestResult,
 * );
 *
 * for (const cmd of result.commands) {
 *   console.log(`${cmd.category}: ${cmd.command} — ${cmd.description}`);
 * }
 * ```
 */
export class CommandInference {

  // ── Public API ──────────────────────────────────────────────

  /**
   * Run the full inference pipeline:
   *   1. Validate each AI-extracted command.
   *   2. Merge accepted commands with static-analysis commands.
   *   3. Fill missing categories with heuristic defaults.
   *   4. De-duplicate and sort.
   *
   * @param aiCommands     - Commands extracted from AI output by `ResponseParser`.
   * @param techReport     - `TechReport` from `TechMapper.analyze()`.
   * @param commandContext - Result from `CommandContextBuilder.buildCommandContext()`.
   * @param harvestResult  - `HarvestResult` from `DataHarvester.harvest()`.
   * @returns A fully validated and merged `InferenceResult`.
   */
  public infer(
    aiCommands: ExtractedCommand[],
    techReport: TechReport,
    commandContext: CommandContextResult | null,
    harvestResult: HarvestResult,
  ): InferenceResult {
    const ecosystem = this.resolveEcosystem(techReport);

    // ── Step 1: Validate AI commands ──
    const validationResults = aiCommands.map(cmd =>
      this.validateCommand(cmd, techReport, ecosystem, harvestResult),
    );

    const accepted = validationResults.filter(r => r.accepted);
    const rejected = validationResults.filter(r => !r.accepted);

    // ── Step 2: Convert accepted AI commands to ValidatedCommands ──
    const aiValidated: ValidatedCommand[] = accepted.map(r => ({
      command: r.original.command,
      description: r.original.purpose || this.describeCategory(r.original.category),
      category: r.original.category,
      source: 'ai' as CommandSource,
      confidence: Math.max(0, Math.min(1, 0.8 + r.confidenceAdjust)),
      warnings: r.reasons.filter(r => !r.startsWith('[OK]')),
    }));

    // ── Step 3: Incorporate static-analysis commands ──
    const staticValidated = this.incorporateStaticCommands(
      commandContext, ecosystem,
    );

    // ── Step 4: Merge (AI takes priority, static fills gaps) ──
    const merged = this.mergeCommands(aiValidated, staticValidated);

    // ── Step 5: Check if AI was sufficient ──
    const coreCategoriesCovered = this.coreCategoriesCovered(merged);
    let usedFallback = false;

    if (!coreCategoriesCovered) {
      const heuristics = this.generateHeuristicFallbacks(techReport, merged);
      merged.push(...heuristics);
      usedFallback = heuristics.length > 0;
    }

    // ── Step 6: De-duplicate and sort ──
    const deduped = this.deduplicateCommands(merged);
    const sorted = this.sortByCategory(deduped);

    return {
      commands: sorted,
      rejected,
      usedFallback,
      stats: {
        aiCommandsReceived: aiCommands.length,
        aiCommandsAccepted: accepted.length,
        aiCommandsRejected: rejected.length,
        staticCommandsUsed: staticValidated.length,
        heuristicCommandsUsed: usedFallback
          ? sorted.filter(c => c.source === 'heuristic').length
          : 0,
      },
    };
  }

  /**
   * Convenience: Run heuristic inference ONLY (no AI input).
   * Useful when the AI call is skipped or fails entirely.
   */
  public inferFromHeuristics(
    techReport: TechReport,
    commandContext: CommandContextResult | null,
  ): InferenceResult {
    return this.infer([], techReport, commandContext, {
      configFiles: [],
      dependencies: new Map(),
      totalDependencies: 0,
    });
  }

  // ── 1. Ecosystem resolution ──────────────────────────────────

  /**
   * Determine the primary ecosystem from the TechReport.
   * Prefers more specific types (e.g. `django` over `python`).
   */
  private resolveEcosystem(techReport: TechReport): EcosystemCommands | null {
    const projectIds = techReport.projectTypes.map(p => p.id);

    // Prefer specific sub-types first
    for (const id of projectIds) {
      const eco = ECOSYSTEM_COMMANDS.get(id);
      if (eco) return eco;
    }

    return null;
  }

  /**
   * Return ALL matching ecosystems (for multi-ecosystem projects).
   */
  private resolveAllEcosystems(techReport: TechReport): Map<string, EcosystemCommands> {
    const result = new Map<string, EcosystemCommands>();
    for (const pt of techReport.projectTypes) {
      const eco = ECOSYSTEM_COMMANDS.get(pt.id);
      if (eco) result.set(pt.id, eco);
    }
    return result;
  }

  // ── 2. Single-command validation ─────────────────────────────

  /**
   * Validate a single AI-generated command against the project reality.
   */
  private validateCommand(
    cmd: ExtractedCommand,
    techReport: TechReport,
    primaryEco: EcosystemCommands | null,
    harvestResult: HarvestResult,
  ): CommandValidationResult {
    const reasons: string[] = [];
    let confidenceAdjust = 0;
    let accepted = true;

    // 2a. Foreign PM check
    if (primaryEco) {
      if (primaryEco.foreignManagers.test(cmd.command)) {
        // Before rejecting, check if the project is multi-ecosystem
        const allEcos = this.resolveAllEcosystems(techReport);
        const isForeignValid = Array.from(allEcos.values()).some(eco =>
          eco.packageManagers.test(cmd.command),
        );

        if (!isForeignValid) {
          reasons.push(
            `Foreign package manager detected: "${cmd.command}" does not match the project ecosystem.`,
          );
          confidenceAdjust -= 0.5;
          accepted = false;
        }
      }
    }

    // 2b. Empty / whitespace-only command
    if (!cmd.command.trim()) {
      reasons.push('Command is empty or whitespace-only.');
      accepted = false;
    }

    // 2c. Dangerously generic commands
    const dangerousPatterns = [
      /^rm\s+-rf\s+\//,
      /^sudo\s+rm/,
      /^:(){ :\|:& };:/,
      /^dd\s+if=/,
    ];
    for (const dp of dangerousPatterns) {
      if (dp.test(cmd.command)) {
        reasons.push(`Potentially destructive command detected: "${cmd.command}".`);
        confidenceAdjust -= 0.8;
        accepted = false;
      }
    }

    // 2d. Suspiciously long commands (likely AI hallucination of code)
    if (cmd.command.length > 200) {
      reasons.push('Command is suspiciously long — may be hallucinated code rather than a shell command.');
      confidenceAdjust -= 0.3;
      accepted = false;
    }

    // 2e. Commands referencing non-existent files from harvested data
    // (Only check for common entry-point references like `python <file>`)
    const fileRefMatch = cmd.command.match(
      /\b(?:python|python3|node|ts-node|deno\s+run)\s+(\S+\.\w+)/i,
    );
    if (fileRefMatch) {
      const referencedFile = fileRefMatch[1];
      // This is a soft check — we warn but don't reject
      reasons.push(`[INFO] References file "${referencedFile}" — verify it exists.`);
      confidenceAdjust -= 0.05;
    }

    // 2f. Boost confidence for commands that match static analysis
    if (primaryEco && primaryEco.packageManagers.test(cmd.command)) {
      confidenceAdjust += 0.1;
    }

    return { original: cmd, accepted, confidenceAdjust, reasons };
  }

  // ── 3. Static-analysis command incorporation ─────────────────

  /**
   * Convert static-analysis `DetectedCommand`s into `ValidatedCommand`s,
   * filtering to keep only high-confidence, non-duplicate entries.
   */
  private incorporateStaticCommands(
    commandContext: CommandContextResult | null,
    ecosystem: EcosystemCommands | null,
  ): ValidatedCommand[] {
    if (!commandContext) return [];

    const results: ValidatedCommand[] = [];

    for (const [type, commands] of commandContext.commandsByType) {
      // Map CommandType → CommandCategory (they're very similar, with minor naming differences)
      const category = this.mapCommandTypeToCategory(type);

      for (const cmd of commands) {
        // Only include high-confidence static commands
        if (cmd.confidence < 0.7) continue;

        // Validate against ecosystem
        if (ecosystem && ecosystem.foreignManagers.test(cmd.command)) {
          continue; // Skip foreign-ecosystem commands
        }

        results.push({
          command: cmd.command,
          description: cmd.description || this.describeCategory(category),
          category,
          source: 'static-analysis',
          confidence: cmd.confidence,
          warnings: [],
        });
      }
    }

    return results;
  }

  // ── 4. Merging ───────────────────────────────────────────────

  /**
   * Merge AI-validated commands with static-analysis commands.
   * AI commands take priority; static fills in missing categories.
   */
  private mergeCommands(
    aiCommands: ValidatedCommand[],
    staticCommands: ValidatedCommand[],
  ): ValidatedCommand[] {
    const result: ValidatedCommand[] = [...aiCommands];
    const coveredCategories = new Set(aiCommands.map(c => c.category));

    for (const cmd of staticCommands) {
      if (!coveredCategories.has(cmd.category)) {
        result.push(cmd);
        coveredCategories.add(cmd.category);
      }
    }

    return result;
  }

  // ── 5. Heuristic fallback ────────────────────────────────────

  /**
   * Check if the core categories (install, build, run, test) are covered.
   */
  private coreCategoriesCovered(commands: ValidatedCommand[]): boolean {
    const categories = new Set(commands.map(c => c.category));
    return categories.has('install') && categories.has('run');
  }

  /**
   * Generate heuristic fallback commands for any missing core categories.
   */
  private generateHeuristicFallbacks(
    techReport: TechReport,
    existingCommands: ValidatedCommand[],
  ): ValidatedCommand[] {
    const coveredCategories = new Set(existingCommands.map(c => c.category));
    const results: ValidatedCommand[] = [];
    const coreCategories: CommandCategory[] = ['install', 'build', 'run', 'test'];

    // Try each project type in order of detection
    for (const pt of techReport.projectTypes) {
      const eco = ECOSYSTEM_COMMANDS.get(pt.id);
      if (!eco) continue;

      for (const cat of coreCategories) {
        if (coveredCategories.has(cat)) continue;

        const fallback = eco.fallbacks[cat];
        if (fallback) {
          results.push({
            command: fallback.command,
            description: fallback.description,
            category: cat,
            source: 'heuristic',
            confidence: 0.6,
            warnings: [`Generated from heuristic for detected project type: ${pt.label}`],
          });
          coveredCategories.add(cat);
        }
      }
    }

    return results;
  }

  // ── 6. De-duplication and sorting ────────────────────────────

  /**
   * Remove duplicate commands (same command string, keep highest confidence).
   */
  private deduplicateCommands(commands: ValidatedCommand[]): ValidatedCommand[] {
    const seen = new Map<string, ValidatedCommand>();

    for (const cmd of commands) {
      const key = cmd.command.toLowerCase().trim();
      const existing = seen.get(key);

      if (!existing || cmd.confidence > existing.confidence) {
        seen.set(key, cmd);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Sort commands by category priority order.
   */
  private sortByCategory(commands: ValidatedCommand[]): ValidatedCommand[] {
    const priorityMap = new Map(CATEGORY_PRIORITY.map((cat, idx) => [cat, idx]));

    return [...commands].sort((a, b) => {
      const pa = priorityMap.get(a.category) ?? 99;
      const pb = priorityMap.get(b.category) ?? 99;
      if (pa !== pb) return pa - pb;
      // Within the same category, prefer higher confidence
      return b.confidence - a.confidence;
    });
  }

  // ── Helpers ──────────────────────────────────────────────────

  /**
   * Map a `CommandType` (from command-context-builder) to a `CommandCategory`
   * (from response-parser). They're nearly identical but have minor naming diffs.
   */
  private mapCommandTypeToCategory(type: string): CommandCategory {
    const mapping: Record<string, CommandCategory> = {
      install: 'install',
      build: 'build',
      test: 'test',
      run: 'run',
      dev: 'run',       // 'dev' maps to 'run'
      lint: 'lint',
      format: 'lint',   // 'format' maps to 'lint'
      clean: 'other',
      deploy: 'deploy',
    };
    return mapping[type] ?? 'other';
  }

  /**
   * Generate a human-readable description for a command category.
   */
  private describeCategory(category: CommandCategory): string {
    const descriptions: Record<CommandCategory, string> = {
      install: 'Install dependencies',
      build: 'Build the project',
      run: 'Run the application',
      test: 'Run the test suite',
      lint: 'Lint / format code',
      deploy: 'Deploy the application',
      setup: 'Project setup',
      other: 'Run command',
    };
    return descriptions[category];
  }

  // ── Static convenience ───────────────────────────────────────

  /**
   * Convert `ValidatedCommand[]` into the `InferredCommand[]` format
   * expected by `CliDisplay.displayInferredCommands()` from `cli-display.ts`.
   *
   * This bridges the gap between this module and the CLI visualisation layer.
   */
  public static toInferredCommands(
    commands: ValidatedCommand[],
  ): Array<{ type: string; command: string; description: string }> {
    // Capitalise category names for the CLI display
    const labelMap: Record<CommandCategory, string> = {
      install: 'Install',
      build: 'Build',
      run: 'Run',
      test: 'Test',
      lint: 'Lint',
      deploy: 'Deploy',
      setup: 'Setup',
      other: 'Other',
    };

    return commands.map(cmd => ({
      type: labelMap[cmd.category] || 'Other',
      command: cmd.command,
      description: cmd.description,
    }));
  }

  /**
   * Expose the heuristic fallback table for downstream agents to extend.
   */
  public static readonly ecosystems = ECOSYSTEM_COMMANDS;
}
