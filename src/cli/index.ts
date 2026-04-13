#!/usr/bin/env node

/**
 * CLI Entry Point — `readme-ai-gen`
 *
 * Uses **Commander** to define the `generate` command, parses options,
 * and orchestrates the full pipeline:
 *
 *   `FileScanner → TechMapper → TreeGenerator → ContextBuilder`
 *     → `CommandContextBuilder → CommandInference`
 *     → `CodebaseMapper → FeatureExtractor → APIExtractor`
 *     → `PromptBuilder → AIEngine → MarkdownEngine → Output`
 *
 * @module cli/index
 */

import { Command } from 'commander';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import fs from 'fs-extra';
import chalk from 'chalk';

// ── Core pipeline imports ──
import { FileScanner, FileInfo } from '../core/scanner.js';
import { TechMapper, TechReport } from '../core/tech-mapper.js';
import { MetadataExtractor } from '../core/metadata-extractor.js';
import { TreeGenerator } from '../utils/tree.js';
import { ContextBuilder } from '../core/context-builder.js';
import { CommandContextBuilder } from '../core/command-context-builder.js';
import { CommandInference, InferenceResult } from '../core/command-inference.js';
import { ResponseParser } from '../core/response-parser.js';
import { DataHarvester } from '../core/data-harvester.js';
import { CodebaseMapper } from '../core/codebase-mapper.js';
import { FeatureExtractor } from '../core/feature-extractor.js';
import { APIExtractor } from '../core/api-extractor.js';
import { DataSanitizer } from '../core/data-sanitizer.js';
import { AIEngine } from '../core/ai-engine.js';
import { AIError, AIResponse } from '../core/ai-types.js';
import { PromptBuilder } from '../utils/prompts.js';
import { CliDisplay } from '../utils/cli-display.js';
import { MarkdownEngine } from '../utils/markdown-engine.js';
import { resolveApiKey, resolveAllApiKeys, getProviderEnvVar } from '../core/api-keys.js';
import { logger } from '../utils/logger.js';
import { CacheManager } from '../utils/cache-manager.js';
import { ProgressIndicator } from '../utils/progress.js';
import type { CacheData } from '../utils/cache-manager.js';
import { getTemplate, listTemplates, loadCustomTemplate, type Template, type SectionId } from '../utils/templates.js';
import { BadgeStyle } from '../utils/badge.js';
import { Validator, type ValidationResult } from '../utils/validator.js';
import { exec } from 'child_process';

import type { AIProvider, AIRequest } from '../core/ai-types.js';

const VALID_PROVIDERS: readonly AIProvider[] = [
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'nvidia',
];

// ── Read version from package.json at runtime ──
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

const program = new Command();

// ─────────────────────────── Program metadata ───────────────────────────

program
  .name('readme-ai-gen')
  .description(
    'AI-powered CLI tool that analyses your project and generates a beautiful README.md.'
  )
  .version(pkg.version, '-v, --version', 'Print the current version');

// ─────────────────────────── keys subcommand ───────────────────────────

program
  .command('keys')
  .description('Show which AI providers have API keys configured')
  .option('--verbose', 'Show environment variable names')
  .action(keysHandler);

// ─────────────────────────── validate subcommand ───────────────────────────

program
  .command('validate')
  .description('Validate an existing README file for common issues')
  .argument('[file]', 'Path to the README file to validate', 'README.md')
  .option('--verbose', 'Show detailed validation output')
  .action(validateHandler);

// ─────────────────────────── examples subcommand ───────────────────────────

program
  .command('examples')
  .description('Show common usage examples for all commands and features')
  .action(examplesHandler);

// ─────────────────────────── generate command ───────────────────────────

program
  .command('generate')
  .description(
    'Analyse a project directory and generate a README.md\n' +
    '  Examples:\n' +
    '    readme-ai-gen generate --no-ai\n' +
    '    readme-ai-gen generate --provider openrouter --model openrouter/auto\n' +
    '    readme-ai-gen generate --interactive'
  )
  .argument('[path]', 'Path to the project root', '.')
  .option('-o, --output <file>', 'Output file path', 'README.md')
  .option('--stdout', 'Print README content to stdout instead of writing a file')
  .option('-f, --force', 'Overwrite existing file without prompting')
  .option('--max-depth <n>', 'Maximum scan depth (0 = unlimited)', '0')
  .option('--ignore <patterns...>', 'Additional glob patterns to ignore')
  .option('--no-tree', 'Skip the ASCII directory tree in the output')

  // ── AI-specific flags ──
  .option(
    '--provider <name>',
    `AI provider (${VALID_PROVIDERS.join(' | ')})`,
    'openai'
  )
  .option('--model <name>', 'Override the default model for the provider')
  .option('--api-key <key>', 'API key (overrides env variables)')
  .option('--interactive-key', 'Prompt for API key interactively')
  .option('--max-tokens <n>', 'Maximum tokens for AI generation', '4096')
  .option('--temperature <n>', 'AI temperature (0-2)', '0.7')

  // ── Extraction control flags ──
  .option('--no-ai', 'Skip AI generation (analysis-only mode)')
  .option('--no-feature-extraction', 'Skip AI-based feature extraction')
  .option('--no-api-extraction', 'Skip AI-based API endpoint extraction')
  .option('--no-command-inference', 'Skip command inference (use heuristics only)')
  .option('--max-feature-depth <n>', 'Depth of feature analysis (1-3)', '2')
  .option('--preview-commands', 'Show inferred commands before generating README')

  // ── Interactive mode ──
  .option('-i, --interactive', 'Interactive mode: guided README generation with step-by-step prompts')

  // ── Cache control flags ──
  .option('--no-cache', 'Disable cache loading (full analysis every time)')
  .option('--refresh-cache', 'Clear existing cache and rebuild')
  .option('--cache-ttl <hours>', 'Cache time-to-live in hours', '24')

  // ── Dry-run mode ──
  .option('--dry-run', 'Run full pipeline without writing output file')

  // ── Template system ──
  .option(
    '--template <name>',
    'README template to use (minimal | standard | comprehensive | api-docs)',
    'standard'
  )
  .option(
    '--custom-template <path>',
    'Path to custom template JSON file (overrides --template)'
  )
  .option(
    '--badge-style <style>',
    'Badge style (for-the-badge | flat | flat-square | plastic | social | none)',
    'for-the-badge'
  )

  // ── Section toggle flags ──
  .option('--no-overview', 'Exclude project overview section')
  .option('--no-tech-stack', 'Exclude technology stack section')
  .option('--no-commands', 'Exclude commands section')
  .option('--no-features', 'Exclude features section')
  .option('--no-api-reference', 'Exclude API reference section')
  .option('--no-installation', 'Exclude installation section')
  .option('--no-usage', 'Exclude usage section')
  .option('--no-structure', 'Exclude project structure section')
  .option('--no-contributing', 'Exclude contributing section')
  .option('--no-license', 'Exclude license section')

  // ── Validation and preview flags ──
  .option('--validate', 'Validate generated README and show results')
  .option('--stats', 'Show detailed README statistics after generation')
  .option('--preview', 'Open generated README in default markdown viewer/browser')
  .option('--format <format>', 'Output format (markdown | html | pdf)', 'markdown')

  .option('--verbose', 'Enable detailed logging')
  .option('--debug', 'Enable debug mode (show stack traces, detailed context, and environment)')
  .option('-q, --quiet', 'Quiet mode — minimal output (CI/CD friendly)')
  .action(generateHandler);

// ─────────────────────────── Interactive prompts ───────────────────────────

/**
 * Options collected from interactive mode.
 */
interface InteractiveOptions {
  projectPath: string;
  outputFile: string;
  provider: string;
  model?: string;
  maxTokens: number;
  temperature: number;
  templatePreference?: string;
  sections: string[];
  verbose: boolean;
  forceOverwrite: boolean;
}

/**
 * Available sections for the README.
 */
const AVAILABLE_SECTIONS = [
  'Overview',
  'Technology Stack',
  'Commands',
  'Features',
  'API Reference',
  'Installation',
  'Usage',
  'Project Structure',
  'Contributing',
  'License',
];

/**
 * Prompt the user for all generation options interactively.
 */
async function interactivePrompts(defaults: {
  projectPath: string;
  outputFile: string;
  provider: string;
  model?: string;
  maxTokens: number;
  temperature: number;
}): Promise<InteractiveOptions> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(chalk.cyan(prompt), (answer) => {
        resolve(answer.trim());
      });
    });

  console.log('');
  logger.divider();
  logger.info(chalk.bold(' Interactive Mode — README Generation Wizard'));
  logger.divider();
  console.log('');

  // 1. Project path
  const projectPathInput = await question(
    `Project path [${defaults.projectPath}]: `
  );
  const projectPath = projectPathInput || defaults.projectPath;

  // 2. Output file
  const outputFileInput = await question(
    `Output file [${defaults.outputFile}]: `
  );
  const outputFile = outputFileInput || defaults.outputFile;

  // 3. AI provider
  console.log('');
  console.log(chalk.bold('  AI Provider:'));
  VALID_PROVIDERS.forEach((p, i) => {
    const isDefault = p === defaults.provider;
    const marker = isDefault ? chalk.green(' (default)') : '';
    console.log(`    ${i + 1}. ${chalk.bold(p)}${marker}`);
  });
  const providerInput = await question(
    `\n  Select provider (1-${VALID_PROVIDERS.length}) or name [${defaults.provider}]: `
  );
  let provider = defaults.provider;
  if (providerInput) {
    const idx = parseInt(providerInput, 10) - 1;
    if (idx >= 0 && idx < VALID_PROVIDERS.length) {
      provider = VALID_PROVIDERS[idx];
    } else if (VALID_PROVIDERS.includes(providerInput as AIProvider)) {
      provider = providerInput;
    }
  }

  // 4. Model name
  const modelInput = await question(
    `\nModel name (leave empty for provider default): `
  );
  const model = modelInput || defaults.model;

  // 5. Max tokens
  const maxTokensInput = await question(
    `Max tokens [${defaults.maxTokens}]: `
  );
  const maxTokens = parseInt(maxTokensInput, 10) || defaults.maxTokens;

  // 6. Temperature
  const tempInput = await question(
    `Temperature (0-2) [${defaults.temperature}]: `
  );
  const temperature = parseFloat(tempInput) || defaults.temperature;

  // 7. Template preference (store for Agent 2)
  console.log('');
  console.log(chalk.bold('  Template Preference:'));
  const templates = ['minimal', 'standard', 'comprehensive', 'api-docs'];
  templates.forEach((t, i) => {
    const marker = t === 'standard' ? chalk.green(' (default)') : '';
    console.log(`    ${i + 1}. ${chalk.bold(t)}${marker}`);
  });
  const templateInput = await question(
    `\n  Select template (1-${templates.length}) [standard]: `
  );
  const templateIdx = parseInt(templateInput, 10) - 1;
  const templatePreference =
    templateIdx >= 0 && templateIdx < templates.length
      ? templates[templateIdx]
      : 'standard';

  // 8. Sections to include
  console.log('');
  console.log(chalk.bold('  Sections to Include:'));
  console.log('  (Enter numbers separated by commas, or leave empty for all)');
  AVAILABLE_SECTIONS.forEach((s, i) => {
    console.log(`    ${i + 1}. ${chalk.bold(s)}`);
  });
  const sectionsInput = await question(
    `\n  Select sections [all]: `
  );
  let sections = [...AVAILABLE_SECTIONS];
  if (sectionsInput) {
    const indices = sectionsInput
      .split(',')
      .map((s) => parseInt(s.trim(), 10) - 1)
      .filter((n) => n >= 0 && n < AVAILABLE_SECTIONS.length);
    if (indices.length > 0) {
      sections = indices.map((i) => AVAILABLE_SECTIONS[i]);
    }
  }

  // 9. Additional options
  console.log('');
  const verboseInput = await question('Verbose mode? (y/N): ');
  const verbose = verboseInput.toLowerCase() === 'y' || verboseInput.toLowerCase() === 'yes';

  const forceInput = await question('Force overwrite? (y/N): ');
  const forceOverwrite = forceInput.toLowerCase() === 'y' || forceInput.toLowerCase() === 'yes';

  rl.close();

  console.log('');
  logger.success('Options collected!');
  console.log('');

  return {
    projectPath,
    outputFile,
    provider,
    model,
    maxTokens,
    temperature,
    templatePreference,
    sections,
    verbose,
    forceOverwrite,
  };
}

// ─────────────────────────── Interactive key prompt ───────────────────────────

/**
 * Prompt the user for an API key via stdin.
 */
async function promptForApiKey(provider: AIProvider): Promise<string> {
  const envVar = getProviderEnvVar(provider);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      chalk.yellow(`\nEnter API key for ${chalk.bold(provider)} (or set ${envVar}):\n> `),
      (key) => {
        rl.close();
        resolve(key.trim());
      }
    );
  });
}

/**
 * Prompt the user to confirm overwriting an existing file.
 */
async function promptOverwrite(filePath: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      chalk.yellow(`\n⚠  ${chalk.bold(filePath)} already exists. Overwrite? (y/N): `),
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      }
    );
  });
}

// ─────────────────────────── Error formatting ───────────────────────────

/**
 * Format an error with actionable suggestions.
 */
function formatError(
  message: string,
  suggestions: string[],
  context?: Record<string, string>
): string {
  let output = chalk.red(`\n✘ ${message}\n`);

  if (context && Object.keys(context).length > 0) {
    output += chalk.dim('\n  Context:\n');
    for (const [key, value] of Object.entries(context)) {
      output += chalk.dim(`    ${key}: ${value}\n`);
    }
  }

  if (suggestions.length > 0) {
    output += chalk.yellow('\n  What you can do:\n');
    suggestions.forEach((s, i) => {
      output += chalk.yellow(`  ${i + 1}. ${s}\n`);
    });
  }

  return output;
}

/**
 * Show masked API keys and environment state (for --debug output).
 */
function showDebugEnvironment(): void {
  logger.debug('Environment', {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY
      ? `${process.env.OPENROUTER_API_KEY.slice(0, 8)}*** (set)`
      : '(not set)',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY
      ? `${process.env.OPENAI_API_KEY.slice(0, 8)}*** (set)`
      : '(not set)',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
      ? `${process.env.ANTHROPIC_API_KEY.slice(0, 8)}*** (set)`
      : '(not set)',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY
      ? `${process.env.GEMINI_API_KEY.slice(0, 8)}*** (set)`
      : '(not set)',
    NVIDIA_API_KEY: process.env.NVIDIA_API_KEY
      ? `${process.env.NVIDIA_API_KEY.slice(0, 8)}*** (set)`
      : '(not set)',
    NODE_ENV: process.env.NODE_ENV || '(not set)',
  });
}

// ─────────────────────────── keys handler ───────────────────────────

async function keysHandler(options: { verbose: boolean }): Promise<void> {
  logger.divider();
  logger.info(chalk.bold(' AI Provider Configuration'));
  logger.divider();

  const status = resolveAllApiKeys();
  let anyConfigured = false;

  for (const provider of VALID_PROVIDERS) {
    const hasKey = status[provider];
    const envVar = getProviderEnvVar(provider);
    const icon = hasKey ? chalk.green('✔') : chalk.dim('✘');
    const detail = hasKey
      ? chalk.green('configured')
      : chalk.dim('not set');

    console.log(`  ${icon}  ${chalk.bold(provider.padEnd(12))} ${detail}`);

    if (options.verbose) {
      console.log(
        `     Env: ${envVar}${process.env[envVar] ? chalk.green(' ✓') : chalk.dim(' (not set)')}`
      );
    }

    if (hasKey) anyConfigured = true;
  }

  console.log('');

  if (!anyConfigured) {
    logger.warn(
      'No API keys found. Set one via --api-key flag or an environment variable.'
    );
  } else {
    logger.success('At least one provider is ready to use.');
  }

  logger.divider();
}

// ─────────────────────────── validate handler ───────────────────────────

async function validateHandler(
  filePath: string,
  options: { verbose: boolean }
): Promise<void> {
  const resolvedPath = path.resolve(filePath);

  logger.divider();
  logger.info(chalk.bold(' README Validation'));
  logger.divider();

  // Check if file exists
  if (!fs.existsSync(resolvedPath)) {
    logger.error(`File does not exist: ${chalk.red(resolvedPath)}`);
    process.exit(1);
  }

  logger.info(`Validating: ${chalk.cyan(resolvedPath)}`);
  console.log('');

  // Read file content
  let content: string;
  try {
    content = await fs.readFile(resolvedPath, 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to read file: ${chalk.red(message)}`);
    process.exit(1);
  }

  // Run validation
  const validator = new Validator();
  const result = validator.validate(content);

  // Display results
  displayValidationResults(result, options.verbose);

  // Exit with appropriate code
  if (!result.isValid) {
    process.exit(1);
  }
}

/**
 * Display validation results with color coding.
 */
function displayValidationResults(result: ValidationResult, verbose: boolean): void {
  const stats = result.stats;

  // Statistics
  console.log(chalk.cyan('ℹ  Statistics:'));
  console.log(`   Words       : ${chalk.bold(stats.wordCount.toLocaleString())}`);
  console.log(`   Lines       : ${chalk.bold(stats.lineCount.toLocaleString())}`);
  console.log(`   Sections    : ${chalk.bold(stats.sectionCount)}`);
  console.log(`   Code blocks : ${chalk.bold(stats.codeBlockCount)}`);
  console.log(`   Links       : ${chalk.bold(stats.linkCount)}`);
  console.log(`   Badges      : ${chalk.bold(stats.badgeCount)}`);
  console.log(`   Reading time: ${chalk.bold('~' + stats.readingTimeMinutes + ' min')}`);
  console.log('');

  // Errors
  if (result.errors.length > 0) {
    console.log(chalk.red(`✘  Errors (${result.errors.length}):`));
    for (const error of result.errors) {
      const lineInfo = error.line ? ` (line ${error.line})` : '';
      console.log(
        `   ${chalk.red('✘')} [${chalk.bold(error.rule)}] ${error.message}${lineInfo}`
      );
    }
    console.log('');
  }

  // Warnings
  if (result.warnings.length > 0) {
    console.log(chalk.yellow(`⚠  Warnings (${result.warnings.length}):`));
    for (const warning of result.warnings) {
      const lineInfo = warning.line ? ` (line ${warning.line})` : '';
      console.log(
        `   ${chalk.yellow('⚠')} [${chalk.bold(warning.rule)}] ${warning.message}${lineInfo}`
      );
    }
    console.log('');
  }

  // Suggestions
  if (result.suggestions.length > 0) {
    console.log(chalk.blue(`💡 Suggestions (${result.suggestions.length}):`));
    for (const suggestion of result.suggestions) {
      const lineInfo = suggestion.line ? ` (line ${suggestion.line})` : '';
      console.log(
        `   ${chalk.blue('💡')} [${chalk.bold(suggestion.rule)}] ${suggestion.message}${lineInfo}`
      );
    }
    console.log('');
  }

  // Final status
  if (result.isValid) {
    const issueCount = result.errors.length + result.warnings.length + result.suggestions.length;
    console.log(
      chalk.green(
        `✔  README is VALID with ${result.errors.length} errors, ${result.warnings.length} warnings, ${result.suggestions.length} suggestions`
      )
    );
  } else {
    console.log(
      chalk.red(
        `✘  README is INVALID with ${result.errors.length} errors, ${result.warnings.length} warnings, ${result.suggestions.length} suggestions`
      )
    );
  }
}

/**
 * Open a file in the default markdown viewer/browser.
 */
function openInViewer(filePath: string): void {
  let command: string;

  if (process.platform === 'win32') {
    command = `start "" "${filePath}"`;
  } else if (process.platform === 'darwin') {
    command = `open "${filePath}"`;
  } else {
    command = `xdg-open "${filePath}"`;
  }

  exec(command, (error) => {
    if (error) {
      logger.warn(`Could not open preview: ${error.message}`);
      logger.info(`View README manually: ${filePath}`);
    }
  });
}

// ─────────────────────────── Examples handler ───────────────────────────

/**
 * Show categorised usage examples for all commands and features.
 */
async function examplesHandler(): Promise<void> {
  console.log('');
  logger.divider();
  logger.info(chalk.bold(' README-AI-Gen Usage Examples'));
  logger.divider();
  console.log('');

  const examples = [
    {
      category: chalk.bold('Basic Usage'),
      items: [
        {
          desc: 'Analyse project without AI (fast):',
          cmd: 'readme-ai-gen generate --no-ai',
        },
        {
          desc: 'Analyse with verbose output:',
          cmd: 'readme-ai-gen generate --no-ai --verbose',
        },
      ],
    },
    {
      category: chalk.bold('AI Generation'),
      items: [
        {
          desc: 'Generate with OpenRouter auto model (recommended):',
          cmd: 'readme-ai-gen generate --provider openrouter --model openrouter/auto',
        },
        {
          desc: 'Generate with specific model:',
          cmd: 'readme-ai-gen generate --provider openai --model gpt-4o',
        },
        {
          desc: 'Generate with custom API key:',
          cmd: 'readme-ai-gen generate --api-key sk-...',
        },
        {
          desc: 'Interactive mode (guided prompts):',
          cmd: 'readme-ai-gen generate --interactive',
        },
      ],
    },
    {
      category: chalk.bold('Templates'),
      items: [
        {
          desc: 'Generate with minimal template:',
          cmd: 'readme-ai-gen generate --template minimal',
        },
        {
          desc: 'Generate with comprehensive template:',
          cmd: 'readme-ai-gen generate --template comprehensive',
        },
        {
          desc: 'Generate with API docs template:',
          cmd: 'readme-ai-gen generate --template api-docs',
        },
        {
          desc: 'Use flat badge style:',
          cmd: 'readme-ai-gen generate --badge-style flat',
        },
        {
          desc: 'Disable badges entirely:',
          cmd: 'readme-ai-gen generate --badge-style none',
        },
      ],
    },
    {
      category: chalk.bold('Section Control'),
      items: [
        {
          desc: 'Skip overview and structure sections:',
          cmd: 'readme-ai-gen generate --no-overview --no-structure',
        },
        {
          desc: 'Only generate essentials:',
          cmd: 'readme-ai-gen generate --no-features --no-api-reference --no-contributing',
        },
      ],
    },
    {
      category: chalk.bold('Validation & Preview'),
      items: [
        {
          desc: 'Generate and validate:',
          cmd: 'readme-ai-gen generate --validate',
        },
        {
          desc: 'Validate existing README:',
          cmd: 'readme-ai-gen validate README.md',
        },
        {
          desc: 'Show detailed statistics:',
          cmd: 'readme-ai-gen generate --stats',
        },
        {
          desc: 'Open in browser after generation:',
          cmd: 'readme-ai-gen generate --preview',
        },
      ],
    },
    {
      category: chalk.bold('Cache & Performance'),
      items: [
        {
          desc: 'Use cache (default, faster):',
          cmd: 'readme-ai-gen generate',
        },
        {
          desc: 'Force full analysis (ignore cache):',
          cmd: 'readme-ai-gen generate --no-cache',
        },
        {
          desc: 'Rebuild cache:',
          cmd: 'readme-ai-gen generate --refresh-cache',
        },
        {
          desc: 'Set cache TTL to 1 hour:',
          cmd: 'readme-ai-gen generate --cache-ttl 1',
        },
      ],
    },
    {
      category: chalk.bold('Output Control'),
      items: [
        {
          desc: 'Write to custom output path:',
          cmd: 'readme-ai-gen generate --output docs/README.md',
        },
        {
          desc: 'Print to stdout (for piping):',
          cmd: 'readme-ai-gen generate --stdout > README.md',
        },
        {
          desc: 'Dry run (no file written):',
          cmd: 'readme-ai-gen generate --dry-run',
        },
        {
          desc: 'Quiet mode (CI/CD friendly):',
          cmd: 'readme-ai-gen generate --quiet',
        },
      ],
    },
    {
      category: chalk.bold('Advanced'),
      items: [
        {
          desc: 'Use custom template:',
          cmd: 'readme-ai-gen generate --custom-template my-template.json',
        },
        {
          desc: 'Limit scan depth:',
          cmd: 'readme-ai-gen generate --max-depth 3',
        },
        {
          desc: 'Ignore specific patterns:',
          cmd: 'readme-ai-gen generate --ignore "**/*.test.ts" "**/*.spec.ts"',
        },
        {
          desc: 'Interactive key prompt:',
          cmd: 'readme-ai-gen generate --interactive-key',
        },
        {
          desc: 'Debug mode (troubleshooting):',
          cmd: 'readme-ai-gen generate --debug',
        },
      ],
    },
    {
      category: chalk.bold('Utility Commands'),
      items: [
        {
          desc: 'Check API key configuration:',
          cmd: 'readme-ai-gen keys',
        },
        {
          desc: 'Show API keys with env var names:',
          cmd: 'readme-ai-gen keys --verbose',
        },
        {
          desc: 'Show this examples list:',
          cmd: 'readme-ai-gen examples',
        },
      ],
    },
  ];

  for (const group of examples) {
    console.log(`  ${group.category}`);
    console.log('');
    for (const example of group.items) {
      console.log(`    ${example.desc}`);
      console.log(`    ${chalk.green('$')} ${chalk.cyan(example.cmd)}`);
      console.log('');
    }
  }

  logger.divider();
  console.log('');
  logger.info('For full documentation, see: README.md');
  console.log('');
}

// ─────────────────────────── Generate handler ───────────────────────────

/**
 * Orchestrates the full pipeline: scan → analyse → visualise → context
 * → command inference → codebase mapping → AI → MarkdownEngine → Output.
 */
async function generateHandler(
  targetPath: string,
  options: {
    output: string;
    stdout: boolean;
    force: boolean;
    maxDepth: string;
    ignore?: string[];
    tree: boolean;
    provider: string;
    model?: string;
    apiKey?: string;
    interactiveKey: boolean;
    maxTokens: string;
    temperature: string;
    ai: boolean;
    featureExtraction: boolean;
    apiExtraction: boolean;
    commandInference: boolean;
    maxFeatureDepth: string;
    previewCommands: boolean;
    verbose: boolean;
    interactive?: boolean;
    noCache?: boolean;
    refreshCache?: boolean;
    cacheTtl?: string;
    dryRun?: boolean;
    template?: string;
    customTemplate?: string;
    badgeStyle?: string;
    overview?: boolean;
    techStack?: boolean;
    commands?: boolean;
    features?: boolean;
    apiReference?: boolean;
    installation?: boolean;
    usage?: boolean;
    structure?: boolean;
    contributing?: boolean;
    license?: boolean;
    validate?: boolean;
    stats?: boolean;
    preview?: boolean;
    format?: string;
    debug?: boolean;
    quiet?: boolean;
  }
): Promise<void> {
  // ── Set global debug / quiet flags ──
  globalThis.DEBUG_MODE = options.debug || false;
  globalThis.QUIET_MODE = options.quiet || false;

  const resolvedPath = path.resolve(targetPath);
  const maxDepth = parseInt(options.maxDepth, 10);
  const useAI = options.ai;
  const useFeatureExtraction = options.featureExtraction && useAI;
  const useAPIExtraction = options.apiExtraction && useAI;
  const useCommandInference = options.commandInference;
  const writeToStdout = options.stdout;
  const useCache = !options.noCache;
  const refreshCache = options.refreshCache || false;
  const cacheTtl = parseInt(options.cacheTtl || '24', 10);
  const isDryRun = options.dryRun || false;
  const isInteractive = options.interactive || false;

  // Show debug environment info if --debug
  if (globalThis.DEBUG_MODE) {
    showDebugEnvironment();
    logger.debug('CLI Options', options);
  }

  // ── Template system ──
  let template: Template;
  try {
    if (options.customTemplate) {
      template = loadCustomTemplate(options.customTemplate);
      logger.info(`Using custom template: ${chalk.cyan(template.name)}`);
    } else {
      template = getTemplate(options.template || 'standard');
      logger.info(`Using template: ${chalk.cyan(template.name)}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.customTemplate) {
      console.error(formatError(
        `Failed to load custom template: ${message}`,
        [
          'Check the file path is correct and the file exists',
          'Ensure the template is valid JSON with required fields',
          'Use a built-in template: --template standard',
          'See examples: readme-ai-gen examples',
        ],
        { path: options.customTemplate }
      ));
    } else {
      const availableTemplates = listTemplates().join(', ');
      console.error(formatError(
        `Invalid template: "${options.template}"`,
        [
          `Choose a valid template: --template standard`,
          `Available templates: ${availableTemplates}`,
          'Use a custom template: --custom-template my-template.json',
          'See template docs: readme-ai-gen examples',
        ]
      ));
    }
    process.exit(1);
  }

  // Validate badge style
  const validBadgeStyles: BadgeStyle[] = [
    'flat',
    'flat-square',
    'for-the-badge',
    'plastic',
    'social',
    'none',
  ];
  const badgeStyle = (options.badgeStyle || 'for-the-badge') as BadgeStyle;
  if (!validBadgeStyles.includes(badgeStyle)) {
    console.error(formatError(
      `Invalid badge style: "${options.badgeStyle}"`,
      [
        `Choose a valid style: --badge-style flat`,
        `Available styles: ${validBadgeStyles.join(', ')}`,
        `Disable badges entirely: --badge-style none`,
      ]
    ));
    process.exit(1);
  }

  // Apply section toggles to template
  let sections = [...template.sections];
  if (options.overview === false) sections = sections.filter((s) => s !== 'overview');
  if (options.techStack === false) sections = sections.filter((s) => s !== 'tech-stack');
  if (options.commands === false) sections = sections.filter((s) => s !== 'commands');
  if (options.features === false) sections = sections.filter((s) => s !== 'features');
  if (options.apiReference === false) sections = sections.filter((s) => s !== 'api-reference');
  if (options.installation === false) sections = sections.filter((s) => s !== 'installation');
  if (options.usage === false) sections = sections.filter((s) => s !== 'usage');
  if (options.structure === false) sections = sections.filter((s) => s !== 'structure');
  if (options.contributing === false) sections = sections.filter((s) => s !== 'contributing');
  if (options.license === false) sections = sections.filter((s) => s !== 'license');

  // Initialize cache manager
  const cacheManager = new CacheManager(resolvedPath);

  // Handle cache refresh
  if (refreshCache) {
    await cacheManager.clear();
    logger.info('Cache cleared for refresh.');
  }

  // Try to load cache
  let cachedData: CacheData['cachedData'] | null = null;
  let useCachedData = false;

  if (useCache && !refreshCache) {
    const cached = await cacheManager.load();
    if (cached && !(await cacheManager.isStale())) {
      cachedData = cached.cachedData;
      useCachedData = true;
      logger.info('Using cached analysis (refresh with --refresh-cache)');
    }
  }

  // Validate provider
  const provider = options.provider as AIProvider;
  if (!VALID_PROVIDERS.includes(provider)) {
    console.error(formatError(
      `Invalid provider: "${options.provider}"`,
      [
        `Choose a valid provider: --provider openrouter`,
        `Valid providers: ${VALID_PROVIDERS.join(', ')}`,
        'See available providers: https://openrouter.ai/docs',
      ]
    ));
    process.exit(1);
  }

  // Calculate total steps dynamically
  let totalSteps = 3; // scan, analyse, tree
  if (useCommandInference) totalSteps += 1;
  if (useAI) totalSteps += 4; // context + AI + sanitize + markdown assembly

  const stepLabel = (current: number, label: string) =>
    logger.step(current, totalSteps, label);

  logger.divider();
  logger.info(chalk.bold(` README-AI-Gen v${pkg.version}`));
  logger.divider();

  // ── Validate target path ──
  if (!fs.existsSync(resolvedPath)) {
    console.error(formatError(
      'Cannot read directory: Path does not exist',
      [
        'Check the path is correct',
        'Use absolute path: readme-ai-gen generate /absolute/path',
        'Run from project root: cd /your/project && readme-ai-gen generate',
      ],
      { path: resolvedPath }
    ));
    process.exit(1);
  }
  if (!fs.statSync(resolvedPath).isDirectory()) {
    console.error(formatError(
      'Path is not a directory',
      [
        'Provide a directory path, not a file',
        'Run from project root: cd /your/project && readme-ai-gen generate',
      ],
      { path: resolvedPath }
    ));
    process.exit(1);
  }

  logger.info(`Target  : ${chalk.cyan(resolvedPath)}`);

  if (writeToStdout) {
    logger.info(`Output  : ${chalk.cyan('stdout')}`);
  } else {
    logger.info(`Output  : ${chalk.cyan(options.output)}`);
  }

  logger.info(`Provider: ${chalk.cyan(provider)}${useAI ? '' : chalk.dim(' (AI disabled)')}`);
  if (options.model) logger.info(`Model   : ${chalk.cyan(options.model)}`);
  if (!useCommandInference) logger.info(`Commands: ${chalk.dim('heuristics only')}`);
  if (options.verbose) logger.info(`Verbose mode enabled`);
  console.log('');

  try {
    // ──── Step 1: Scan ──────────────────────────────────────────
    let files: FileInfo[];
    let report: TechReport;
    let treeOutput = '';
    let inferenceResult: InferenceResult | null = null;
    let stepCount = 0;

    if (useCachedData && cachedData) {
      // Use cached data
      files = [];
      report = cachedData.techReport;
      treeOutput = cachedData.tree;
      inferenceResult = { commands: cachedData.commands, rejected: [], usedFallback: false, stats: { aiCommandsReceived: 0, aiCommandsAccepted: 0, aiCommandsRejected: 0, staticCommandsUsed: cachedData.commands.length, heuristicCommandsUsed: 0 } };
      stepCount = 4; // Skip to after command inference

      logger.success(`Using cached data: ${chalk.bold(cachedData.fileCount.toString())} files`);
    } else {
      // Scan files
      stepLabel(1, 'Scanning project files');

      const scanProgress = new ProgressIndicator('Scanning project files...');
      scanProgress.start();

      const scanner = new FileScanner(resolvedPath, {
        ignorePatterns: options.ignore,
        maxDepth: maxDepth > 0 ? maxDepth : undefined,
      });

      files = await scanner.scan();

      scanProgress.stop(true);

      if (files.length === 0) {
        logger.warn('No files found in the target directory.');
        process.exit(0);
      }

      logger.success(
        `Found ${chalk.bold(files.length.toString())} file(s) in ${chalk.cyan(resolvedPath)}`
      );

      if (options.verbose) {
        logger.info('Extensions detected:');
        const extSet = new Set(files.map((f) => f.extension).filter(Boolean));
        console.log(
          '  ' +
            Array.from(extSet)
              .slice(0, 20)
              .map((e) => chalk.dim(`.${e}`))
              .join(', ')
        );
      }

      // ──── Step 2: Analyse ───────────────────────────────────────
      stepLabel(2, 'Analysing tech stack');

      const analyseProgress = new ProgressIndicator('Analysing tech stack...');
      analyseProgress.start();

      const mapper = new TechMapper();
      report = mapper.analyze(files);

      analyseProgress.stop(true);

      if (report.projectTypes.length > 0) {
        logger.success(
          `Project type(s): ${report.projectTypes.map((p) => chalk.bold(p.label)).join(', ')}`
        );
      } else {
        logger.warn('Could not detect a specific project type.');
      }

      if (options.verbose && report.languages.size > 0) {
        logger.info('Language breakdown:');
        for (const [lang, info] of report.languages) {
          console.log(
            `  ${chalk.cyan(lang)}: ${info.fileCount} file(s)`
          );
        }
      }

      // ──── Step 3: Visualise ─────────────────────────────────────

      if (options.tree) {
        stepLabel(3, 'Generating directory tree');

        const treeProgress = new ProgressIndicator('Generating directory tree...');
        treeProgress.start();

        treeOutput = TreeGenerator.generate(files, resolvedPath, {
          ignoreFolders: ['node_modules', 'dist', '.git'],
        });

        treeProgress.stop(true);

        if (options.verbose) {
          logger.info('Tree preview:');
          console.log(treeOutput);
        }

        logger.success('Directory tree generated.');
      }

      stepCount = 3;

      // ──── Step 4: Command Inference ─────────────────────────────

      if (useCommandInference) {
        stepCount++;
        stepLabel(stepCount, 'Inferring project commands');

        const cmdProgress = new ProgressIndicator('Inferring project commands...');
        cmdProgress.start();

        try {
          const cmdContextBuilder = new CommandContextBuilder({
            includeConfig: true,
            includeScripts: true,
          });

          const cmdContext = await cmdContextBuilder.buildCommandContext(files, report);

          if (options.verbose) {
            logger.info(`Entry points: ${cmdContext.commandStats.totalEntryPoints}`);
            logger.info(`Script files: ${cmdContext.commandStats.totalScriptFiles}`);
            logger.info(`Build configs: ${cmdContext.commandStats.totalBuildConfigs}`);
            logger.info(`Raw commands: ${cmdContext.commandStats.totalCommands}`);
          }

          // Run data harvester for validation context
          const harvester = new DataHarvester();
          const harvestResult = await harvester.harvest(files);

          // Run command inference (validation + heuristic fallback)
          const inference = new CommandInference();
          inferenceResult = inference.infer(
            [],
            report,
            cmdContext,
            harvestResult,
          );

          cmdProgress.stop(true);

          logger.success(
            `Commands: ${chalk.bold(inferenceResult.commands.length.toString())} validated (${inferenceResult.stats.staticCommandsUsed} static, ${inferenceResult.stats.heuristicCommandsUsed} heuristic)`
          );

          if (options.verbose && inferenceResult.commands.length > 0) {
            logger.info('Inferred commands:');
            for (const cmd of inferenceResult.commands) {
              const sourceIcon =
                cmd.source === 'heuristic'
                  ? chalk.yellow('⚙ ')
                  : cmd.source === 'static-analysis'
                    ? chalk.blue('◆ ')
                    : chalk.green('✦ ');
              console.log(
                `  ${sourceIcon}${chalk.bold(cmd.category.padEnd(8))} ${chalk.green(cmd.command)} ${chalk.dim(`— ${cmd.description}`)}`
              );
            }
          }

          // Preview mode
          if (options.previewCommands) {
            const displayCommands = inferenceResult.commands.map((cmd) => ({
              type: cmd.category.charAt(0).toUpperCase() + cmd.category.slice(1),
              command: cmd.command,
              description: `${cmd.description} (${cmd.source})`,
            }));

            console.log('');
            CliDisplay.displayInferredCommands(displayCommands);
          }
        } catch (err: unknown) {
          cmdProgress.stop(false);
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(`Command inference failed: ${chalk.yellow(message)}. Falling back to heuristics.`);

          const inference = new CommandInference();
          inferenceResult = inference.inferFromHeuristics(report, null);

          if (options.verbose && inferenceResult.commands.length > 0) {
            logger.info('Heuristic fallback commands:');
            for (const cmd of inferenceResult.commands) {
              console.log(
                `  ⚙ ${chalk.bold(cmd.category.padEnd(8))} ${chalk.green(cmd.command)} ${chalk.dim(`— ${cmd.description}`)}`
              );
            }
          }
        }
      }

      // Save cache if not using cached data
      if (useCache && !useCachedData) {
        const metadata = await (new MetadataExtractor()).extract(files);
        await cacheManager.saveWithTtl({
          techReport: report,
          metadata,
          commands: inferenceResult?.commands || [],
          tree: treeOutput,
          fileCount: files.length,
        }, cacheTtl);
        logger.info('Cache saved for faster re-runs.');
      }
    }

    // ──── Analysis-only mode? ───────────────────────────────────
    if (!useAI) {
      console.log('');
      logger.divider();
      logger.success(chalk.bold('Analysis complete!'));
      if (!writeToStdout) {
        logger.info(
          `Ready to write ${chalk.cyan(options.output)} (AI generation skipped).`
        );
      }
      logger.divider();

      if (options.verbose) {
        console.log('\n📝  README metadata collected:\n');
        console.log(`   Files      : ${report.totalFiles}`);
        console.log(`   Languages  : ${report.languages.size}`);
        console.log(`   Tree       : ${treeOutput ? chalk.green('yes') : chalk.dim('skipped')}`);
        console.log(
          `   Commands   : ${inferenceResult ? inferenceResult.commands.length : 0} inferred`
        );
        console.log('');
      }
      return;
    }

    // ──── Step 5: Build AI context ──────────────────────────────
    stepCount++;
    stepLabel(stepCount, 'Building AI context');

    const contextProgress = new ProgressIndicator('Building AI context...');
    contextProgress.start();

    const contextBuilder = new ContextBuilder({
      maxTokens: 64_000,
      maxTokensPerFile: 2000,
      includeTests: false,
      includeConfig: true,
    });

    const contextResult = await contextBuilder.build(files, report);

    contextProgress.stop(true);

    logger.success(
      `Context: ${chalk.bold(contextResult.fileCount.toString())} file(s), ${chalk.bold(contextResult.totalTokens.toLocaleString())} tokens (${contextResult.stats.tokenUsagePercent.toFixed(1)}% budget)`
    );

    if (options.verbose) {
      logger.info('Top context files:');
      contextResult.files.slice(0, 5).forEach((f) => {
        console.log(
          `  ${chalk.cyan(f.file.name)} (${f.actualTokens} tokens, score: ${f.score})`
        );
      });
    }

    // ──── Resolve API key ───────────────────────────────────────
    let resolvedKey = resolveApiKey(provider, options.apiKey);

    if (!resolvedKey && options.interactiveKey) {
      resolvedKey = await promptForApiKey(provider);
    }

    if (!resolvedKey) {
      const envVar = getProviderEnvVar(provider);
      console.error(formatError(
        `No API key found for provider "${provider}"`,
        [
          `Check your API key: readme-ai-gen keys --verbose`,
          `Set a new key: export ${envVar}=your-key-here`,
          'Use interactive key prompt: readme-ai-gen generate --interactive-key',
          `Try a different provider: readme-ai-gen generate --provider openrouter`,
        ],
        { provider, envVariable: envVar }
      ));
      process.exit(1);
    }

    // ──── Step 6: AI generation ─────────────────────────────────
    stepCount++;
    stepLabel(stepCount, 'Generating content with AI');

    const aiProgress = new ProgressIndicator('Generating content with AI...');
    aiProgress.start();

    const engine = new AIEngine({
      provider,
      providers: {
        [provider]: {
          apiKey: resolvedKey,
          model: options.model,
          maxTokens: parseInt(options.maxTokens, 10),
          temperature: parseFloat(options.temperature),
        },
      },
    });

    // Build prompt data with all available information
    const extractor = new MetadataExtractor();
    const metadata = await extractor.extract(files);

    const promptData = {
      metadata,
      techReport: report,
      dependencies: [],
      tree: treeOutput || 'No tree generated.',
      context: contextResult,
      inferenceResult: inferenceResult ?? undefined,
    };

    // Build prompt for full README generation
    const systemMsg = PromptBuilder.buildSystemMessage();
    const userMsg = PromptBuilder.buildSectionPrompt('full', promptData);

    const aiRequest: AIRequest = {
      messages: [systemMsg, userMsg],
      model: options.model,
      maxTokens: parseInt(options.maxTokens, 10),
      temperature: parseFloat(options.temperature),
    };

    if (options.verbose) {
      logger.info(`Sending request to ${chalk.bold(provider)}…`);
      logger.info(
        `Model: ${options.model || 'default'} | Max tokens: ${options.maxTokens} | Temp: ${options.temperature}`
      );
    }

    let aiResponse: AIResponse;

    try {
      aiResponse = await engine.chat(aiRequest);
    } catch (err: unknown) {
      aiProgress.stop(false);

      const errMessage = err instanceof Error ? err.message : String(err);
      const errProvider = err instanceof AIError ? err.provider : provider;
      const errStatus = err instanceof AIError ? err.statusCode : undefined;

      // Classify error and give actionable suggestions
      let suggestions: string[];
      let contextInfo: Record<string, string> = {
        provider: errProvider,
        model: options.model || 'default',
      };

      if (errMessage.includes('401') || errMessage.toLowerCase().includes('unauthorized') || errMessage.toLowerCase().includes('invalid api key')) {
        suggestions = [
          'Check your API key: readme-ai-gen keys --verbose',
          `Set a new key: export ${getProviderEnvVar(provider)}=your-key-here`,
          'Use interactive key prompt: readme-ai-gen generate --interactive-key',
          `Try a different provider: readme-ai-gen generate --provider openrouter`,
        ];
      } else if (errMessage.includes('429') || errMessage.toLowerCase().includes('rate limit')) {
        suggestions = [
          'Wait 60 seconds and retry',
          'Use --provider openrouter for higher rate limits',
          'Reduce --max-tokens to use fewer tokens',
          'Use analysis-only mode: readme-ai-gen generate --no-ai',
        ];
      } else if (errMessage.toLowerCase().includes('not available') || errMessage.toLowerCase().includes('not found') || errMessage.includes('404')) {
        suggestions = [
          'Check supported models: https://openrouter.ai/models',
          'Use auto model: --model openrouter/auto (recommended)',
          'Try a different model: --model gpt-4o-mini',
        ];
        if (options.model) contextInfo['requestedModel'] = options.model;
      } else {
        suggestions = [
          'Retry with --max-tokens set lower',
          'Check your API key: readme-ai-gen keys --verbose',
          'Try a different provider: readme-ai-gen generate --provider openrouter',
          'Use debug mode for details: readme-ai-gen generate --debug',
        ];
      }

      if (errStatus) contextInfo['statusCode'] = String(errStatus);

      console.error(formatError(
        `AI request failed: ${errMessage}`,
        suggestions,
        contextInfo
      ));

      // Debug: show stack trace
      if (globalThis.DEBUG_MODE && err instanceof Error && err.stack) {
        console.error(chalk.dim('\nStack trace:'));
        console.error(chalk.dim(err.stack));
      }

      process.exit(1);
    }

    aiProgress.stop(true);

    logger.success(
      `AI generated ${chalk.bold((aiResponse.content.length / 4).toFixed(0).toLocaleString())} tokens of content`
    );

    if (options.verbose && aiResponse.usage) {
      logger.info(
        `Usage: ${aiResponse.usage.promptTokens} prompt + ${aiResponse.usage.completionTokens} completion = ${aiResponse.usage.totalTokens} total`
      );
    }

    // ──── Step 7: Sanitize extracted data ────────────────────
    stepCount++;
    stepLabel(stepCount, 'Sanitizing extracted data');

    const sanitizeProgress = new ProgressIndicator('Sanitizing extracted data...');
    sanitizeProgress.start();

    const sanitizer = new DataSanitizer();
    const sanitizedData = sanitizer.sanitize({
      featureResult: null,
      apiResult: null,
      inferenceResult: inferenceResult,
      dependencySummary: null,
    });

    sanitizeProgress.stop(true);

    logger.success(
      `Sanitized: ${chalk.bold(sanitizedData.stats.commandsOut.toString())} commands, ` +
      `${chalk.bold(sanitizedData.stats.itemsRemoved.toString())} items removed, ` +
      `${chalk.bold(sanitizedData.stats.itemsModified.toString())} items modified`
    );

    if (options.verbose) {
      logger.info(`Sanitizer stats:`);
      console.log(`  Features  : ${sanitizedData.stats.featuresIn} → ${sanitizedData.stats.featuresOut}`);
      console.log(`  Endpoints : ${sanitizedData.stats.endpointsIn} → ${sanitizedData.stats.endpointsOut}`);
      console.log(`  Commands  : ${sanitizedData.stats.commandsIn} → ${sanitizedData.stats.commandsOut}`);
      console.log(`  Dep groups: ${sanitizedData.stats.dependencyGroupsIn} → ${sanitizedData.stats.dependencyGroupsOut}`);
    }

    // ──── Step 8: Assemble with MarkdownEngine ─────────────────
    stepCount++;
    stepLabel(stepCount, 'Assembling README');

    const markdownProgress = new ProgressIndicator('Assembling README...');
    markdownProgress.start();

    const markdownEngine = new MarkdownEngine({
      includeTree: options.tree,
      includeCommands: useCommandInference,
      includeFeatures: useFeatureExtraction,
      includeAPIs: useAPIExtraction,
      includeBadges: badgeStyle !== 'none',
      includeFooter: template.includeFooter,
      template: template.name,
      sections: sections as SectionId[],
      badgeStyle: badgeStyle,
    });

    const finalReadme = markdownEngine.build({
      metadata,
      techReport: report,
      inferenceResult: inferenceResult,
      featureResult: null,
      apiResult: null,
      sanitizedData,
      aiContent: {
        fullReadme: aiResponse.content,
      },
      tree: treeOutput || undefined,
    });

    markdownProgress.stop(true);

    logger.success(`README assembled: ${chalk.bold((finalReadme.length / 4).toFixed(0))} tokens`);

    // ──── Write output ──────────────────────────────────────────
    if (isDryRun) {
      // Dry-run mode: show summary and preview without writing
      console.log('');
      logger.divider();
      logger.success(chalk.bold('DRY RUN COMPLETE'));
      logger.divider();
      logger.info(`README would be written to: ${chalk.cyan(options.output)}`);

      // Calculate statistics
      const validator = new Validator();
      const stats = validator.validate(finalReadme).stats;

      logger.info(`Estimated size: ${chalk.bold(stats.wordCount.toLocaleString())} words, ~${chalk.bold(stats.readingTimeMinutes)} min read`);
      logger.info(`Lines: ${chalk.bold(stats.lineCount.toLocaleString())}`);
      logger.info(`Code blocks: ${chalk.bold(stats.codeBlockCount)}`);
      logger.info(`Badges: ${chalk.bold(stats.badgeCount)}`);
      logger.divider();

      // Show first 50 lines
      console.log('');
      logger.info(chalk.bold('Preview (first 50 lines):'));
      console.log('');
      const previewLines = finalReadme.split('\n').slice(0, 50);
      console.log(previewLines.join('\n'));
      if (stats.lineCount > 50) {
        console.log('');
        console.log(chalk.dim(`... (${stats.lineCount - 50} more lines)`));
      }
      console.log('');

      // Run validation if requested
      if (options.validate) {
        console.log('');
        logger.divider();
        logger.info(chalk.bold('Validating README...'));
        logger.divider();

        const validationResult = validator.validate(finalReadme);
        displayValidationResults(validationResult, options.verbose);

        // Exit with error code if validation failed
        if (!validationResult.isValid) {
          process.exit(1);
        }
      }

      // Show detailed stats if requested
      if (options.stats) {
        console.log('');
        logger.divider();
        logger.info(chalk.bold('Detailed Statistics:'));
        logger.divider();
        
        console.log(`   Total words     : ${chalk.bold(stats.wordCount.toLocaleString())}`);
        console.log(`   Total lines     : ${chalk.bold(stats.lineCount.toLocaleString())}`);
        console.log(`   Sections        : ${chalk.bold(stats.sectionCount)}`);
        console.log(`   Code blocks     : ${chalk.bold(stats.codeBlockCount)}`);
        console.log(`   Links           : ${chalk.bold(stats.linkCount)}`);
        console.log(`   Badges          : ${chalk.bold(stats.badgeCount)}`);
        console.log(`   Reading time    : ${chalk.bold('~' + stats.readingTimeMinutes + ' minutes')}`);
        
        if (stats.sectionCount > 0) {
          const avgWordsPerSection = Math.round(stats.wordCount / stats.sectionCount);
          console.log(`   Avg words/section: ${chalk.bold(avgWordsPerSection)}`);
        }
        
        logger.divider();
      }

      return;
    }

    if (writeToStdout) {
      process.stdout.write(finalReadme);
      console.log('');
      
      // Show stats if requested
      if (options.stats) {
        const validator = new Validator();
        const stats = validator.validate(finalReadme).stats;
        
        console.log('');
        logger.divider();
        logger.info(chalk.bold('Statistics:'));
        logger.divider();
        console.log(`   Total words     : ${chalk.bold(stats.wordCount.toLocaleString())}`);
        console.log(`   Total lines     : ${chalk.bold(stats.lineCount.toLocaleString())}`);
        console.log(`   Sections        : ${chalk.bold(stats.sectionCount)}`);
        console.log(`   Code blocks     : ${chalk.bold(stats.codeBlockCount)}`);
        console.log(`   Links           : ${chalk.bold(stats.linkCount)}`);
        console.log(`   Badges          : ${chalk.bold(stats.badgeCount)}`);
        console.log(`   Reading time    : ${chalk.bold('~' + stats.readingTimeMinutes + ' minutes')}`);
        logger.divider();
      }
      
      // Run validation if requested
      if (options.validate) {
        console.log('');
        logger.divider();
        logger.info(chalk.bold('Validating README...'));
        logger.divider();

        const validator = new Validator();
        const validationResult = validator.validate(finalReadme);
        displayValidationResults(validationResult, options.verbose);

        // Exit with error code if validation failed
        if (!validationResult.isValid) {
          process.exit(1);
        }
      }
    } else {
      const outputPath = path.resolve(options.output);

      // Collision detection
      if (fs.existsSync(outputPath) && !options.force) {
        const shouldOverwrite = await promptOverwrite(outputPath);
        if (!shouldOverwrite) {
          logger.info('Aborted. Use --force to overwrite without prompting.');
          process.exit(0);
        }
      }

      try {
        await fs.writeFile(outputPath, finalReadme, 'utf-8');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(formatError(
          `Cannot write output file: ${message}`,
          [
            'Check directory permissions',
            'Choose different output: readme-ai-gen generate --output ~/README.md',
            'Print to stdout instead: readme-ai-gen generate --stdout',
          ],
          { output: outputPath }
        ));
        if (globalThis.DEBUG_MODE && err instanceof Error && err.stack) {
          console.error(chalk.dim('\nStack trace:'));
          console.error(chalk.dim(err.stack));
        }
        process.exit(1);
      }

      console.log('');
      logger.divider();
      logger.success(chalk.bold('README.md generated successfully!'));
      logger.info(`Written to: ${chalk.cyan(outputPath)}`);
      logger.info(`Provider  : ${chalk.cyan(provider)} (${aiResponse.model})`);
      
      // Calculate and display statistics
      const wordCount = finalReadme.split(/\s+/).length;
      const readTime = Math.ceil(wordCount / 200);
      const lines = finalReadme.split('\n').length;
      const codeBlocks = (finalReadme.match(/```/g) || []).length / 2;
      const badgeCount = (finalReadme.match(/!\[.*?\]/g) || []).length;
      
      if (options.stats) {
        logger.info(`Stats     : ${chalk.bold(wordCount.toLocaleString())} words, ${chalk.bold(lines)} lines, ${chalk.bold(codeBlocks)} code blocks, ${chalk.bold(badgeCount)} badges, ~${chalk.bold(readTime)} min read`);
      } else {
        logger.info(`Stats     : ${chalk.bold(wordCount.toLocaleString())} words, ${chalk.bold(lines)} lines, ~${chalk.bold(readTime)} min read`);
      }
      
      if (inferenceResult) {
        logger.info(
          `Commands  : ${inferenceResult.commands.length} validated (${inferenceResult.stats.aiCommandsAccepted} AI, ${inferenceResult.stats.staticCommandsUsed} static, ${inferenceResult.stats.heuristicCommandsUsed} heuristic)`
        );
      }
      logger.divider();

      // Run validation if requested
      if (options.validate) {
        console.log('');
        logger.divider();
        logger.info(chalk.bold('Validating README...'));
        logger.divider();

        const validator = new Validator();
        const validationResult = validator.validate(finalReadme);

        displayValidationResults(validationResult, options.verbose);

        // Exit with error code if validation failed
        if (!validationResult.isValid) {
          process.exit(1);
        }
      }

      // Show detailed stats if requested
      if (options.stats) {
        console.log('');
        logger.divider();
        logger.info(chalk.bold('Detailed Statistics:'));
        logger.divider();
        
        const validator = new Validator();
        const stats = validator.validate(finalReadme).stats;
        
        console.log(`   Total words     : ${chalk.bold(stats.wordCount.toLocaleString())}`);
        console.log(`   Total lines     : ${chalk.bold(stats.lineCount.toLocaleString())}`);
        console.log(`   Sections        : ${chalk.bold(stats.sectionCount)}`);
        console.log(`   Code blocks     : ${chalk.bold(stats.codeBlockCount)}`);
        console.log(`   Links           : ${chalk.bold(stats.linkCount)}`);
        console.log(`   Badges          : ${chalk.bold(stats.badgeCount)}`);
        console.log(`   Reading time    : ${chalk.bold('~' + stats.readingTimeMinutes + ' minutes')}`);
        
        if (stats.sectionCount > 0) {
          const avgWordsPerSection = Math.round(stats.wordCount / stats.sectionCount);
          console.log(`   Avg words/section: ${chalk.bold(avgWordsPerSection)}`);
        }
        
        logger.divider();
      }

      // Open preview if requested
      if (options.preview) {
        console.log('');
        logger.info('Opening preview...');
        openInViewer(outputPath);
      }
    }

  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);

    if (err instanceof AIError) {
      console.error(formatError(
        `AI Error (${err.provider}): ${errMessage}`,
        [
          'Check your API key: readme-ai-gen keys --verbose',
          'Try a different provider: readme-ai-gen generate --provider openrouter',
          'Use debug mode for details: readme-ai-gen generate --debug',
        ],
        { provider: err.provider }
      ));
    } else {
      console.error(formatError(
        `Pipeline failed: ${errMessage}`,
        [
          'Check the target path is a valid project directory',
          'Try with --no-ai for analysis-only mode',
          'Use debug mode for details: readme-ai-gen generate --debug',
        ]
      ));
    }

    // Debug: show stack trace
    if (globalThis.DEBUG_MODE && err instanceof Error && err.stack) {
      console.error(chalk.dim('\nStack trace:'));
      console.error(chalk.dim(err.stack));
    }

    process.exit(1);
  }
}

// ─────────────────────────── Parse ───────────────────────────

program.parse();
