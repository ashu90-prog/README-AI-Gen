/**
 * ResponseParser — Processes, validates, and structures raw AI output.
 *
 * This module sits between the AI engine and the final Markdown engine.
 * It takes the raw text returned by any AI provider and:
 *
 *   1. Parses it into discrete, typed README sections.
 *   2. Validates that mentioned technologies actually exist in the project.
 *   3. Extracts executable commands ("Suggested Commands") from prose.
 *   4. Normalises Markdown formatting inconsistencies across providers.
 *
 * Consumes types from:
 *   • `ai-types.ts`   → `AIResponse`
 *   • `tech-mapper.ts` → `TechReport`
 *   • `data-harvester.ts` → `HarvestResult`
 *   • `prompts.ts`     → `ReadmeSection`
 *
 * @module core/response-parser
 */

import { AIResponse } from './ai-types.js';
import { TechReport } from './tech-mapper.js';
import { HarvestResult } from './data-harvester.js';

// ─────────────────────────── Types ───────────────────────────

/**
 * A single extracted command with its context.
 */
export interface ExtractedCommand {
  /** The raw command string (e.g. "npm install"). */
  command: string;
  /** Human-readable purpose / description of the command. */
  purpose: string;
  /** Category of the command. */
  category: CommandCategory;
  /** The shell language (for code-block rendering). */
  shell: 'bash' | 'powershell' | 'cmd' | 'sh' | 'generic';
}

/**
 * Category of extracted command.
 */
export type CommandCategory =
  | 'install'
  | 'build'
  | 'run'
  | 'test'
  | 'lint'
  | 'deploy'
  | 'setup'
  | 'other';

/**
 * A discrete README section parsed from AI output.
 */
export interface ParsedSection {
  /** Machine-readable section identifier. */
  id: string;
  /** Human-readable heading text (as written by the AI). */
  heading: string;
  /** Markdown content belonging to this section. */
  content: string;
  /** Nesting level (1 = `#`, 2 = `##`, etc.) */
  level: number;
}

/**
 * A validation issue found in the AI output.
 */
export interface ValidationIssue {
  /** Severity level. */
  severity: 'error' | 'warning' | 'info';
  /** Machine-readable issue code. */
  code: string;
  /** Human-readable description of the problem. */
  message: string;
  /** The offending text, if applicable. */
  offendingText?: string;
  /** Suggested replacement or fix, if applicable. */
  suggestion?: string;
}

/**
 * Complete result of parsing and validating an AI response.
 */
export interface ParseResult {
  /** The full (possibly sanitised) Markdown output. */
  markdown: string;
  /** Discrete sections extracted from the output. */
  sections: ParsedSection[];
  /** Commands extracted from the output. */
  commands: ExtractedCommand[];
  /** Validation issues found. */
  issues: ValidationIssue[];
  /** Whether the output passed validation (no errors, warnings allowed). */
  valid: boolean;
  /** Statistics about the parsing process. */
  stats: ParseStats;
}

/**
 * Statistics about the parsing process.
 */
export interface ParseStats {
  /** Total character count of the raw response. */
  rawLength: number;
  /** Total character count after sanitisation. */
  sanitisedLength: number;
  /** Number of sections extracted. */
  sectionCount: number;
  /** Number of commands extracted. */
  commandCount: number;
  /** Number of code blocks found. */
  codeBlockCount: number;
  /** Number of validation issues by severity. */
  issueCounts: Record<ValidationIssue['severity'], number>;
}

// ─────────────────── Command Detection Patterns ──────────────────

/**
 * Patterns for classifying extracted commands into categories.
 * Evaluated in order — first match wins.
 */
const COMMAND_CATEGORY_PATTERNS: ReadonlyArray<readonly [RegExp, CommandCategory]> = [
  // Install
  [/\b(npm\s+install|npm\s+i|yarn\s+add|yarn\s+install|pnpm\s+(install|add)|pip\s+install|pip3\s+install|poetry\s+(install|add)|cargo\s+(install|add)|go\s+(install|get)|bundle\s+install|composer\s+(install|require)|apt-get\s+install|brew\s+install|gem\s+install|conda\s+install)\b/i, 'install'],

  // Build
  [/\b(npm\s+run\s+build|yarn\s+build|pnpm\s+build|cargo\s+build|go\s+build|make\s+build|make\s+all|gradle\s+build|mvn\s+(compile|package|install)|tsc|webpack|vite\s+build|next\s+build|docker\s+build)\b/i, 'build'],

  // Test
  [/\b(npm\s+test|npm\s+run\s+test|yarn\s+test|pnpm\s+test|cargo\s+test|go\s+test|pytest|python\s+-m\s+pytest|rspec|phpunit|jest|vitest|mocha|make\s+test)\b/i, 'test'],

  // Lint
  [/\b(npm\s+run\s+lint|yarn\s+lint|pnpm\s+lint|eslint|prettier|cargo\s+clippy|cargo\s+fmt|golangci-lint|flake8|pylint|ruff|black|rubocop|php-cs-fixer)\b/i, 'lint'],

  // Run / Start
  [/\b(npm\s+(start|run\s+dev|run\s+start)|yarn\s+(start|dev)|pnpm\s+(start|dev)|cargo\s+run|go\s+run|python\s+\S+\.py|python3|node\s+|deno\s+run|flask\s+run|uvicorn|gunicorn|rails\s+s|php\s+artisan\s+serve|docker\s+run|docker-compose\s+up)\b/i, 'run'],

  // Deploy
  [/\b(docker\s+push|fly\s+deploy|vercel|netlify\s+deploy|heroku|kubectl\s+apply|terraform\s+apply|aws\s+deploy|gcloud\s+deploy|npm\s+publish|cargo\s+publish)\b/i, 'deploy'],

  // Setup / Init
  [/\b(git\s+clone|mkdir|cp\s+\.env|mv\s+\.env|touch|chmod|echo|export|source|npx\s+create|create-react-app|create-next-app|cargo\s+init|go\s+mod\s+init)\b/i, 'setup'],
];

/**
 * Patterns that indicate a shell language.
 */
const SHELL_DETECTION_PATTERNS: ReadonlyArray<readonly [RegExp, ExtractedCommand['shell']]> = [
  [/\b(powershell|pwsh|Set-|Get-|\$env:)\b/i, 'powershell'],
  [/\b(cmd|@echo|set\s+\w+=)\b/i, 'cmd'],
  [/^#!\s*\/bin\/(ba)?sh/m, 'sh'],
  [/\b(bash|source\s+|export\s+\w+=)\b/i, 'bash'],
];

// ────────────────────── Known-hallucination signals ──────────────────

/**
 * Well-known library names that AI models frequently hallucinate.
 * Lowercase for case-insensitive comparison.
 */
const COMMON_HALLUCINATIONS: ReadonlySet<string> = new Set([
  'supertest-express',
  'express-logger',
  'react-native-web-dom',
  'fastify-express',
  'node-cron-scheduler',
  'python-dotenv-vault',
  'cargo-workspace-tools',
]);

// ─────────────────────────── Service ───────────────────────────

/**
 * `ResponseParser` processes raw AI text into structured, validated output.
 *
 * @example
 * ```ts
 * import { ResponseParser } from './response-parser.js';
 *
 * const parser = new ResponseParser();
 * const result = parser.parse(aiResponse, techReport, harvestResult);
 *
 * if (result.valid) {
 *   console.log(result.sections);  // Structured sections
 *   console.log(result.commands);  // Extracted commands
 * } else {
 *   console.warn(result.issues);   // Validation problems
 * }
 * ```
 */
export class ResponseParser {

  // ── Public API ──────────────────────────────────────────────

  /**
   * Parse, validate, and structure a raw AI response.
   *
   * @param response      - The normalised `AIResponse` from `AIEngine.chat()`.
   * @param techReport    - The `TechReport` from `TechMapper.analyze()`.
   * @param harvestResult - The `HarvestResult` from `DataHarvester.harvest()`.
   * @returns A fully structured `ParseResult`.
   */
  public parse(
    response: AIResponse,
    techReport: TechReport,
    harvestResult: HarvestResult,
  ): ParseResult {
    const raw = response.content;

    // Step 1 — Sanitise raw output
    const sanitised = this.sanitise(raw);

    // Step 2 — Extract sections
    const sections = this.extractSections(sanitised);

    // Step 3 — Extract commands
    const commands = this.extractCommands(sanitised);

    // Step 4 — Validate against project truth
    const issues = this.validate(sanitised, techReport, harvestResult);

    // Step 5 — Build stats
    const stats = this.buildStats(raw, sanitised, sections, commands, issues);

    return {
      markdown: sanitised,
      sections,
      commands,
      issues,
      valid: !issues.some(i => i.severity === 'error'),
      stats,
    };
  }

  /**
   * Quick helper: parse only sections (no validation).
   */
  public parseSectionsOnly(content: string): ParsedSection[] {
    return this.extractSections(this.sanitise(content));
  }

  /**
   * Quick helper: extract only commands (no validation).
   */
  public parseCommandsOnly(content: string): ExtractedCommand[] {
    return this.extractCommands(this.sanitise(content));
  }

  // ── 1. Sanitisation ──────────────────────────────────────────

  /**
   * Clean up common AI formatting quirks:
   *   • Strip leading/trailing markdown fences wrapping the entire response
   *   • Normalise inconsistent heading levels
   *   • Fix broken link syntax
   *   • Remove invisible Unicode characters
   */
  private sanitise(raw: string): string {
    let text = raw;

    // 1a. Strip wrapping ``` blocks that some providers add
    text = this.stripOuterCodeFence(text);

    // 1b. Remove zero-width characters & BOM
    text = text.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');

    // 1c. Normalise line endings
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 1d. Collapse more than 3 consecutive blank lines into 2
    text = text.replace(/\n{4,}/g, '\n\n\n');

    // 1e. Fix stray HTML comments that some models produce
    text = text.replace(/<!--\s*end\s*-->/gi, '');

    // 1f. Trim
    text = text.trim();

    return text;
  }

  /**
   * If the entire response is wrapped in a single ```markdown ... ``` fence,
   * strip that outer fence to avoid a doubly-fenced README.
   */
  private stripOuterCodeFence(text: string): string {
    const trimmed = text.trim();

    // Matches: ```markdown\n ... \n``` (with optional language tag)
    const outerFenceRe = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i;
    const match = trimmed.match(outerFenceRe);

    if (match) {
      return match[1];
    }

    return text;
  }

  // ── 2. Section extraction ────────────────────────────────────

  /**
   * Split Markdown into discrete sections based on heading lines.
   */
  private extractSections(markdown: string): ParsedSection[] {
    const lines = markdown.split('\n');
    const sections: ParsedSection[] = [];
    let currentSection: ParsedSection | null = null;
    let contentLines: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headingMatch) {
        // Flush the previous section
        if (currentSection) {
          currentSection.content = contentLines.join('\n').trim();
          sections.push(currentSection);
        }

        const level = headingMatch[1].length;
        const heading = headingMatch[2].trim();

        currentSection = {
          id: this.headingToId(heading),
          heading,
          content: '',
          level,
        };
        contentLines = [];
      } else {
        contentLines.push(line);
      }
    }

    // Flush the last section
    if (currentSection) {
      currentSection.content = contentLines.join('\n').trim();
      sections.push(currentSection);
    }

    return sections;
  }

  /**
   * Convert a heading string to a kebab-case identifier.
   */
  private headingToId(heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')     // Remove non-word characters except spaces and hyphens
      .replace(/\s+/g, '-')          // Spaces → hyphens
      .replace(/-+/g, '-')           // Collapse multiple hyphens
      .replace(/^-|-$/g, '');        // Trim leading/trailing hyphens
  }

  // ── 3. Command extraction ────────────────────────────────────

  /**
   * Scan the Markdown for code blocks and inline commands, then classify
   * each one with a category and detected shell language.
   */
  private extractCommands(markdown: string): ExtractedCommand[] {
    const commands: ExtractedCommand[] = [];
    const seen = new Set<string>(); // De-duplicate

    // 3a. Extract from fenced code blocks (```bash ... ```)
    this.extractFromCodeBlocks(markdown, commands, seen);

    // 3b. Extract inline backtick commands that look executable
    this.extractInlineCommands(markdown, commands, seen);

    return commands;
  }

  /**
   * Parse fenced code blocks and identify executable commands within them.
   */
  private extractFromCodeBlocks(
    markdown: string,
    commands: ExtractedCommand[],
    seen: Set<string>,
  ): void {
    // matches ```lang\n...\n``` — captures lang and body
    const codeBlockRe = /```(\w*)\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRe.exec(markdown)) !== null) {
      const lang = (match[1] || '').toLowerCase();
      const body = match[2].trim();

      // Only process blocks that look like shell commands
      const isShellBlock = ['bash', 'sh', 'shell', 'zsh', 'cmd', 'powershell', 'ps1', 'bat', 'console', 'terminal', ''].includes(lang);
      if (!isShellBlock) continue;

      // Extract context: look for a heading or paragraph before this code block
      const beforeBlock = markdown.substring(0, match.index);
      const purpose = this.inferPurpose(beforeBlock);

      const lines = body.split('\n');
      for (const line of lines) {
        const cleaned = line.replace(/^\$\s*/, '').replace(/^>\s*/, '').trim();
        if (!cleaned || cleaned.startsWith('#') || cleaned.startsWith('//')) continue;

        // Check if this is actually a command (not just output)
        if (!this.looksLikeCommand(cleaned)) continue;

        if (seen.has(cleaned)) continue;
        seen.add(cleaned);

        commands.push({
          command: cleaned,
          purpose: purpose || this.inferPurposeFromCommand(cleaned),
          category: this.classifyCommand(cleaned),
          shell: this.detectShell(cleaned, lang),
        });
      }
    }
  }

  /**
   * Find inline backtick commands (e.g. "Run `npm start` to begin").
   */
  private extractInlineCommands(
    markdown: string,
    commands: ExtractedCommand[],
    seen: Set<string>,
  ): void {
    // Pattern: backtick-wrapped text that looks like a command
    const inlineRe = /`([^`]{3,80})`/g;
    let match: RegExpExecArray | null;

    while ((match = inlineRe.exec(markdown)) !== null) {
      const candidate = match[1].trim();

      // Must start with a known command keyword
      if (!this.looksLikeCommand(candidate)) continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);

      // Grab surrounding text for context
      const start = Math.max(0, match.index - 120);
      const context = markdown.substring(start, match.index);
      const purpose = this.inferPurpose(context) || this.inferPurposeFromCommand(candidate);

      commands.push({
        command: candidate,
        purpose,
        category: this.classifyCommand(candidate),
        shell: this.detectShell(candidate, ''),
      });
    }
  }

  /**
   * Heuristic: does this string look like a shell command?
   */
  private looksLikeCommand(text: string): boolean {
    // Must start with a known command prefix
    const commandPrefixes = /^(npm|npx|yarn|pnpm|pip|pip3|python|python3|node|deno|bun|cargo|go|make|mvn|gradle|docker|docker-compose|kubectl|terraform|git|brew|apt-get|gem|bundle|composer|php|ruby|rails|flask|uvicorn|gunicorn|mix|elixir|swift|dart|flutter|rustup|curl|wget|mkdir|cp|mv|touch|chmod|echo|export|source|cd|cat|ls|set|.\/)/.test(text);
    if (commandPrefixes) return true;

    // Also catch lines beginning with $
    if (text.startsWith('$') || text.startsWith('>')) return true;

    return false;
  }

  /**
   * Classify a command into a `CommandCategory`.
   */
  private classifyCommand(command: string): CommandCategory {
    for (const [pattern, category] of COMMAND_CATEGORY_PATTERNS) {
      if (pattern.test(command)) return category;
    }
    return 'other';
  }

  /**
   * Detect the shell language from a command string or code-block lang.
   */
  private detectShell(command: string, blockLang: string): ExtractedCommand['shell'] {
    // Use explicit code-block lang if recognisable
    const langMap: Record<string, ExtractedCommand['shell']> = {
      bash: 'bash', sh: 'sh', shell: 'bash', zsh: 'bash',
      powershell: 'powershell', ps1: 'powershell',
      cmd: 'cmd', bat: 'cmd',
    };
    if (blockLang && langMap[blockLang]) return langMap[blockLang];

    // Infer from command content
    for (const [pattern, shell] of SHELL_DETECTION_PATTERNS) {
      if (pattern.test(command)) return shell;
    }

    return 'bash'; // Default to bash
  }

  /**
   * Look backwards in the text for a heading or descriptive sentence.
   */
  private inferPurpose(textBefore: string): string {
    // Find the last heading
    const headings = textBefore.match(/^#{1,6}\s+(.+)$/gm);
    if (headings && headings.length > 0) {
      const lastHeading = headings[headings.length - 1];
      return lastHeading.replace(/^#{1,6}\s+/, '').trim();
    }

    // Find the last sentence
    const sentences = textBefore.match(/[^.!?\n]+[.!?]/g);
    if (sentences && sentences.length > 0) {
      const last = sentences[sentences.length - 1].trim();
      if (last.length < 100) return last;
    }

    return '';
  }

  /**
   * Infer a purpose string from the command itself.
   */
  private inferPurposeFromCommand(command: string): string {
    const category = this.classifyCommand(command);
    const purposeMap: Record<CommandCategory, string> = {
      install: 'Install dependencies',
      build: 'Build the project',
      run: 'Run the application',
      test: 'Run tests',
      lint: 'Lint / format code',
      deploy: 'Deploy the application',
      setup: 'Project setup',
      other: 'Run command',
    };
    return purposeMap[category];
  }

  // ── 4. Validation ────────────────────────────────────────────

  /**
   * Validate AI output against the project's actual tech stack and dependencies.
   */
  private validate(
    markdown: string,
    techReport: TechReport,
    harvestResult: HarvestResult,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // 4a. Check for hallucinated libraries
    this.checkHallucinatedLibraries(markdown, harvestResult, issues);

    // 4b. Check for tech-stack mismatches
    this.checkTechStackMismatches(markdown, techReport, issues);

    // 4c. Check for broken Markdown syntax
    this.checkMarkdownSyntax(markdown, issues);

    // 4d. Check for empty or suspiciously short sections
    this.checkContentQuality(markdown, issues);

    return issues;
  }

  /**
   * Scan for library names mentioned in install commands that are NOT in
   * the project's actual dependency list.
   */
  private checkHallucinatedLibraries(
    markdown: string,
    harvestResult: HarvestResult,
    issues: ValidationIssue[],
  ): void {
    // Build a set of all known dependency names (lowercase)
    const knownDeps = new Set<string>();
    for (const [name] of harvestResult.dependencies) {
      knownDeps.add(name.toLowerCase());
    }

    // Find install commands in the text
    const installRe = /(?:npm\s+install|npm\s+i|yarn\s+add|pnpm\s+add|pip\s+install|pip3\s+install)\s+([^\n`]+)/gi;
    let match: RegExpExecArray | null;

    while ((match = installRe.exec(markdown)) !== null) {
      const argsStr = match[1].trim();
      // Split by whitespace, filter out flags (--save-dev, -D, etc.)
      const packages = argsStr
        .split(/\s+/)
        .filter(p => !p.startsWith('-') && p.length > 1);

      for (const pkg of packages) {
        const cleaned = pkg.replace(/@[\^~]?[\d.]+$/, '').toLowerCase(); // strip version suffix
        if (!cleaned) continue;

        // Check known hallucinations
        if (COMMON_HALLUCINATIONS.has(cleaned)) {
          issues.push({
            severity: 'error',
            code: 'HALLUCINATED_LIBRARY',
            message: `Known hallucinated library "${pkg}" found in install command.`,
            offendingText: pkg,
            suggestion: `Remove "${pkg}" — it does not exist on any package registry.`,
          });
          continue;
        }

        // Check if the library is actually in the project
        if (knownDeps.size > 0 && !knownDeps.has(cleaned) && !cleaned.startsWith('@types/')) {
          issues.push({
            severity: 'warning',
            code: 'UNKNOWN_DEPENDENCY',
            message: `Library "${pkg}" appears in an install command but is not listed in the project's dependencies.`,
            offendingText: pkg,
            suggestion: `Verify that "${pkg}" is actually required. It may be a hallucination or an optional dependency.`,
          });
        }
      }
    }
  }

  /**
   * Look for technology names in the README that contradict the detected stack.
   */
  private checkTechStackMismatches(
    markdown: string,
    techReport: TechReport,
    issues: ValidationIssue[],
  ): void {
    const detectedLanguages = new Set(
      Array.from(techReport.languages.keys()).map(l => l.toLowerCase()),
    );
    const detectedProjects = new Set(
      techReport.projectTypes.map(p => p.id.toLowerCase()),
    );

    // Contradictory ecosystem mentions
    const ecosystemPairs: Array<[string, RegExp, string]> = [
      ['nodejs',  /\b(pip\s+install|conda\s+install|requirements\.txt)\b/i, 'Python package manager referenced in a Node.js project'],
      ['python',  /\b(npm\s+install|yarn\s+add|pnpm\s+add)\b/i,            'npm/yarn/pnpm referenced in a Python project'],
      ['rust',    /\b(npm\s+install|pip\s+install)\b/i,                     'npm/pip referenced in a Rust project'],
      ['go',      /\b(npm\s+install|pip\s+install)\b/i,                     'npm/pip referenced in a Go project'],
    ];

    for (const [ecosystem, pattern, message] of ecosystemPairs) {
      // Only check if the project is this ecosystem AND not also the other ecosystem
      const isThisEcosystem = detectedProjects.has(ecosystem);
      if (!isThisEcosystem) continue;

      if (pattern.test(markdown)) {
        // Check it's not a multi-ecosystem project
        const mentionedOther = ecosystem === 'nodejs'
          ? detectedProjects.has('python')
          : detectedProjects.has('nodejs');

        if (!mentionedOther) {
          issues.push({
            severity: 'warning',
            code: 'ECOSYSTEM_MISMATCH',
            message,
            suggestion: `Ensure the install instructions match the detected project type (${ecosystem}).`,
          });
        }
      }
    }

    // Check for language names that are completely absent from the project
    const languageMentionRe = /\b(Python|Rust|Go(?:lang)?|Java(?:Script)?|TypeScript|Ruby|PHP|Swift|Dart|Elixir|Kotlin|Scala|C\+\+|C#)\b/gi;
    let langMatch: RegExpExecArray | null;

    while ((langMatch = languageMentionRe.exec(markdown)) !== null) {
      const mentioned = langMatch[1];
      const normalisedMention = mentioned.toLowerCase()
        .replace('golang', 'go')
        .replace('javascript', 'javascript')
        .replace('c++', 'c++')
        .replace('c#', 'c#');

      // Check if this language is actually detected
      const isDetected = detectedLanguages.has(mentioned.toLowerCase()) ||
                         detectedLanguages.has(normalisedMention) ||
                         // Also check common aliases
                         (normalisedMention === 'javascript' && detectedLanguages.has('react jsx')) ||
                         (normalisedMention === 'typescript' && detectedLanguages.has('react tsx'));

      // Allow mentions of languages in generic/educational context
      // Only flag if the language is prominently featured (mentioned multiple times)
      if (!isDetected && techReport.languages.size > 0) {
        const count = (markdown.match(new RegExp(`\\b${mentioned}\\b`, 'gi')) || []).length;
        if (count >= 3) {
          issues.push({
            severity: 'info',
            code: 'UNDETECTED_LANGUAGE_MENTION',
            message: `"${mentioned}" is mentioned ${count} times but was not detected in the project files.`,
            suggestion: `Verify that the README accurately reflects the project's actual tech stack.`,
          });
        }
      }
    }
  }

  /**
   * Check for common Markdown syntax problems.
   */
  private checkMarkdownSyntax(
    markdown: string,
    issues: ValidationIssue[],
  ): void {
    // Unclosed code fences
    const fenceCount = (markdown.match(/```/g) || []).length;
    if (fenceCount % 2 !== 0) {
      issues.push({
        severity: 'error',
        code: 'UNCLOSED_CODE_FENCE',
        message: `Odd number of code fences (${fenceCount}) — likely an unclosed \`\`\` block.`,
        suggestion: 'Add a closing ``` to the Markdown output.',
      });
    }

    // Broken image/link syntax: ![text](  or [text](
    const brokenLinkRe = /!?\[([^\]]*)\]\(\s*\)/g;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = brokenLinkRe.exec(markdown)) !== null) {
      issues.push({
        severity: 'warning',
        code: 'EMPTY_LINK_TARGET',
        message: `Empty link/image target for "${linkMatch[1]}".`,
        offendingText: linkMatch[0],
        suggestion: 'Provide a valid URL or remove the link.',
      });
    }

    // Headings without space after #
    const badHeadingRe = /^(#{1,6})[^#\s]/gm;
    let headingMatch: RegExpExecArray | null;
    while ((headingMatch = badHeadingRe.exec(markdown)) !== null) {
      issues.push({
        severity: 'warning',
        code: 'MALFORMED_HEADING',
        message: `Heading marker "${headingMatch[1]}" missing a space before the title text.`,
        offendingText: headingMatch[0],
        suggestion: `Add a space after "${headingMatch[1]}".`,
      });
    }
  }

  /**
   * Flag suspiciously short or empty sections.
   */
  private checkContentQuality(
    markdown: string,
    issues: ValidationIssue[],
  ): void {
    const sections = this.extractSections(markdown);

    for (const section of sections) {
      if (section.content.length === 0) {
        issues.push({
          severity: 'warning',
          code: 'EMPTY_SECTION',
          message: `Section "${section.heading}" has no content.`,
          suggestion: 'Either populate the section or remove the heading.',
        });
      } else if (section.content.length < 20 && section.level <= 2) {
        issues.push({
          severity: 'info',
          code: 'SHORT_SECTION',
          message: `Top-level section "${section.heading}" has very little content (${section.content.length} chars).`,
          suggestion: 'Consider expanding this section for a more comprehensive README.',
        });
      }
    }

    // Check overall length
    if (markdown.length < 200) {
      issues.push({
        severity: 'warning',
        code: 'VERY_SHORT_README',
        message: `The generated README is only ${markdown.length} characters — this seems too short.`,
        suggestion: 'The AI may not have received enough context. Try increasing the context window or providing more files.',
      });
    }
  }

  // ── 5. Stats ─────────────────────────────────────────────────

  /**
   * Build parsing statistics.
   */
  private buildStats(
    raw: string,
    sanitised: string,
    sections: ParsedSection[],
    commands: ExtractedCommand[],
    issues: ValidationIssue[],
  ): ParseStats {
    const codeBlockCount = (sanitised.match(/```/g) || []).length / 2;

    return {
      rawLength: raw.length,
      sanitisedLength: sanitised.length,
      sectionCount: sections.length,
      commandCount: commands.length,
      codeBlockCount: Math.floor(codeBlockCount),
      issueCounts: {
        error: issues.filter(i => i.severity === 'error').length,
        warning: issues.filter(i => i.severity === 'warning').length,
        info: issues.filter(i => i.severity === 'info').length,
      },
    };
  }

  // ── Convenience: get sections by ID ──────────────────────────

  /**
   * Retrieve a specific section by its ID from a parse result.
   *
   * Useful for the Markdown engine (Day 6) when it needs to slot
   * AI-generated content into specific README regions.
   */
  public static getSectionById(
    sections: ParsedSection[],
    id: string,
  ): ParsedSection | undefined {
    return sections.find(s => s.id === id);
  }

  /**
   * Retrieve all sections matching a list of IDs.
   */
  public static getSectionsByIds(
    sections: ParsedSection[],
    ids: string[],
  ): ParsedSection[] {
    const idSet = new Set(ids);
    return sections.filter(s => idSet.has(s.id));
  }

  /**
   * Group commands by category for display.
   */
  public static groupCommandsByCategory(
    commands: ExtractedCommand[],
  ): Map<CommandCategory, ExtractedCommand[]> {
    const map = new Map<CommandCategory, ExtractedCommand[]>();
    for (const cmd of commands) {
      const list = map.get(cmd.category);
      if (list) {
        list.push(cmd);
      } else {
        map.set(cmd.category, [cmd]);
      }
    }
    return map;
  }
}
