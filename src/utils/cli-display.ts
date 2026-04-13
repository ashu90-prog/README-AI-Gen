import chalk from 'chalk';

/**
 * Represents an inferred project command.
 */
export interface InferredCommand {
  /** The type of command (Install, Build, Test, Run). */
  type: string;
  /** The actual command string to be executed. */
  command: string;
  /** A short description of what the command does. */
  description: string;
}

/**
 * CLI display utilities for presenting AI-generated content.
 */
export class CliDisplay {
  /**
   * Displays a preview of AI-suggested commands in the CLI.
   * 
   * @param commands - An array of inferred commands.
   */
  public static displayInferredCommands(commands: InferredCommand[]): void {
    if (commands.length === 0) {
      console.log(chalk.yellow('\n[!] No commands were inferred for this project.'));
      return;
    }

    console.log(chalk.cyan.bold('\n🚀 AI-Suggested Project Commands:'));
    console.log(chalk.dim('─────────────────────────────────────────────────'));

    for (const cmd of commands) {
      const typeLabel = chalk.bold(cmd.type.padEnd(12));
      const commandText = chalk.green(cmd.command);
      const descText = chalk.italic.dim(`(${cmd.description})`);

      console.log(`${typeLabel} : ${commandText}`);
      console.log(`${''.padEnd(15)} ${descText}\n`);
    }

    console.log(chalk.dim('─────────────────────────────────────────────────'));
    console.log(chalk.blue('Note: These commands are inferred and should be verified before use.\n'));
  }
}
