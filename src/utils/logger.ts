/**
 * Logger — lightweight, chalk-based console output for the CLI.
 *
 * Provides styled `info`, `success`, `warn`, `error`, `step`, and `debug` helpers
 * so every part of the tool prints consistently.
 *
 * Supports two global modes:
 *   • `globalThis.QUIET_MODE`  — suppresses non-essential output (CI/CD friendly)
 *   • `globalThis.DEBUG_MODE`  — enables verbose debug logging with stack traces
 *
 * @module utils/logger
 */

import chalk from 'chalk';

/**
 * Declare global flags for quiet and debug modes.
 */
declare global {
  // eslint-disable-next-line no-var
  var QUIET_MODE: boolean;
  // eslint-disable-next-line no-var
  var DEBUG_MODE: boolean;
}

// Initialize globals if not yet set
globalThis.QUIET_MODE = globalThis.QUIET_MODE ?? false;
globalThis.DEBUG_MODE = globalThis.DEBUG_MODE ?? false;

export const logger = {
  /** General information (cyan). Suppressed in quiet mode. */
  info(msg: string): void {
    if (!globalThis.QUIET_MODE) {
      console.log(chalk.cyan('ℹ  ') + msg);
    }
  },

  /**
   * Success / completion messages (green).
   * In quiet mode, only the final "generated successfully" message is shown.
   */
  success(msg: string): void {
    if (globalThis.QUIET_MODE) {
      if (msg.includes('generated successfully')) {
        console.log(chalk.green('✔  ') + msg);
      }
    } else {
      console.log(chalk.green('✔  ') + msg);
    }
  },

  /** Warnings (yellow). Always shown. */
  warn(msg: string): void {
    console.log(chalk.yellow('⚠  ') + msg);
  },

  /** Errors (red). Always shown. */
  error(msg: string): void {
    console.error(chalk.red('✘  ') + msg);
  },

  /** Step header — used before each pipeline phase (bold magenta). Suppressed in quiet mode. */
  step(current: number, total: number, label: string): void {
    if (!globalThis.QUIET_MODE) {
      console.log('\n' + chalk.bold.magenta(`── Step ${current}/${total}: ${label} ──`));
    }
  },

  /** Simple divider. Suppressed in quiet mode. */
  divider(): void {
    if (!globalThis.QUIET_MODE) {
      console.log(chalk.dim('─'.repeat(50)));
    }
  },

  /**
   * Debug output — only shown when `--debug` flag is active.
   * Logs a label and optionally a data payload (objects are JSON-stringified).
   */
  debug(label: string, data?: unknown): void {
    if (globalThis.DEBUG_MODE) {
      console.log(chalk.dim(`\n[DEBUG] ${label}`));
      if (data !== undefined) {
        if (typeof data === 'object' && data !== null) {
          console.log(chalk.dim(JSON.stringify(data, null, 2)));
        } else {
          console.log(chalk.dim(String(data)));
        }
      }
    }
  },
};
