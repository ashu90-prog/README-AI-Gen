/**
 * ProgressIndicator — CLI spinner for long-running operations.
 *
 * Provides a simple, dependency-free spinner using ANSI escape codes
 * and Unicode characters. Respects quiet mode by suppressing output.
 *
 * Features:
 *   • Animated spinner with 10 frames
 *   • Start/stop/update methods
 *   • Success/failure indicators on stop
 *   • Quiet mode support
 *
 * @module utils/progress
 */

// ─────────────────────────── Spinner frames ───────────────────────────

/** Unicode spinner frames (11 frames for smooth animation). */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Success marker. */
const SUCCESS_MARKER = '✔';
/** Failure marker. */
const FAILURE_MARKER = '✘';

// ─────────────────────────── ProgressIndicator ───────────────────────────

/**
 * Configuration for the progress indicator.
 */
export interface ProgressOptions {
  /** Whether to suppress all output (default: false). */
  quiet?: boolean;
  /** Spinner frame interval in ms (default: 80). */
  interval?: number;
}

/**
 * `ProgressIndicator` displays an animated spinner with a message.
 *
 * @example
 * ```ts
 * const progress = new ProgressIndicator('Scanning project files...');
 * progress.start();
 *
 * // ... do work ...
 *
 * progress.update('Analyzing tech stack...');
 *
 * // ... more work ...
 *
 * progress.stop(true); // true = success
 * ```
 */
export class ProgressIndicator {
  private message: string;
  private frameIndex = 0;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private quiet: boolean;

  /**
   * Create a new progress indicator.
   *
   * @param message - Initial message to display.
   * @param options - Optional configuration.
   */
  constructor(message: string, options: ProgressOptions = {}) {
    this.message = message;
    this.intervalMs = options.interval ?? 80;
    this.quiet = options.quiet ?? false;
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Start the spinner animation.
   */
  public start(): void {
    if (this.isRunning || this.quiet) return;
    this.isRunning = true;
    this.frameIndex = 0;

    this.timer = setInterval(() => {
      this.render();
    }, this.intervalMs);

    // Render first frame immediately
    this.render();
  }

  /**
   * Stop the spinner and show a success/failure marker.
   *
   * @param success - Whether the operation succeeded (default: true).
   */
  public stop(success = true): void {
    if (!this.isRunning || this.quiet) {
      this.isRunning = false;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      return;
    }

    // Clear the spinner line
    this.clearLine();

    // Show result marker
    const marker = success ? SUCCESS_MARKER : FAILURE_MARKER;
    const color = success ? '\x1b[32m' : '\x1b[31m'; // green or red
    const reset = '\x1b[0m';
    process.stdout.write(`${color}${marker}${reset} ${this.message}\n`);

    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Update the spinner message.
   *
   * @param message - New message to display.
   */
  public update(message: string): void {
    this.message = message;

    if (this.isRunning && !this.quiet) {
      this.clearLine();
      this.render();
    }
  }

  /**
   * Check if the spinner is currently running.
   */
  public get running(): boolean {
    return this.isRunning;
  }

  /**
   * Set quiet mode (suppresses all output).
   */
  public setQuiet(quiet: boolean): void {
    if (quiet && this.isRunning) {
      this.stop(true);
    }
    this.quiet = quiet;
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Render the current spinner frame.
   */
  private render(): void {
    if (this.quiet) return;

    const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length];
    // Clear line and write spinner
    process.stdout.write(`\r${frame} ${this.message}   `);
    this.frameIndex++;
  }

  /**
   * Clear the current terminal line.
   */
  private clearLine(): void {
    if (this.quiet) return;
    process.stdout.write('\r\x1b[K');
  }
}

/**
 * Create and run a progress indicator for an async operation.
 *
 * This is a convenience wrapper that starts/stops the spinner automatically.
 *
 * @example
 * ```ts
 * const result = await withProgress('Scanning files...', async () => {
 *   return await scanner.scan();
 * });
 * ```
 *
 * @param message - Message to display during the operation.
 * @param fn - Async function to execute.
 * @param options - Progress options.
 * @returns The result of the async function.
 */
export async function withProgress<T>(
  message: string,
  fn: () => Promise<T>,
  options: ProgressOptions = {}
): Promise<T> {
  const progress = new ProgressIndicator(message, options);
  progress.start();

  try {
    const result = await fn();
    progress.stop(true);
    return result;
  } catch (error) {
    progress.stop(false);
    throw error;
  }
}
