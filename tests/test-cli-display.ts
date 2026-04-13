import { CliDisplay, InferredCommand } from '../src/utils/cli-display.ts';

const mockCommands: InferredCommand[] = [
  {
    type: 'Install',
    command: 'npm install',
    description: 'Installs all project dependencies.'
  },
  {
    type: 'Build',
    command: 'npm run build',
    description: 'Compiles TypeScript source files into JavaScript.'
  },
  {
    type: 'Test',
    command: 'npm test',
    description: 'Runs the project test suite using Jest.'
  },
  {
    type: 'Run',
    command: 'node dist/cli/index.js',
    description: 'Starts the CLI application.'
  }
];

console.log('Testing CliDisplay.displayInferredCommands...\n');
CliDisplay.displayInferredCommands(mockCommands);

console.log('Testing CliDisplay.displayInferredCommands with empty array...\n');
CliDisplay.displayInferredCommands([]);
