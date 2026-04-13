/**
 * Simple test file to verify MarkdownEngine functionality
 */

import { MarkdownEngine } from '../dist/utils/markdown-engine.js';

// Create minimal mock data for testing
const mockMetadata = {
  name: 'Test Project',
  version: '1.0.0',
  description: 'A test project for README generation',
  authors: [{ name: 'Test Author', email: 'test@example.com' }],
  license: { spdx: 'MIT', name: 'MIT License' },
  repository: { url: 'https://github.com/test/test-project' },
};

const mockTechReport = {
  projectTypes: [
    { label: 'TypeScript', color: 'blue', badgeSlug: 'typescript' }
  ],
  languages: new Map([
    ['TypeScript', { name: 'TypeScript', fileCount: 10, color: 'blue', badgeSlug: 'typescript' }]
  ]),
  totalFiles: 15,
};

const mockInferenceResult = {
  commands: [
    { command: 'npm install', description: 'Install dependencies', category: 'install', source: 'static-analysis', confidence: 1.0 },
    { command: 'npm run build', description: 'Build the project', category: 'build', source: 'static-analysis', confidence: 1.0 },
    { command: 'npm test', description: 'Run tests', category: 'test', source: 'static-analysis', confidence: 1.0 },
    { command: 'npm start', description: 'Start the application', category: 'run', source: 'static-analysis', confidence: 1.0 },
  ],
  stats: { totalCommands: 4, staticCommandsUsed: 4, heuristicCommandsUsed: 0, aiCommandsAccepted: 0 },
  usedFallback: false,
};

const mockTree = `
test-project/
├── src/
│   ├── index.ts
│   └── utils/
│       └── helper.ts
├── package.json
└── README.md
`;

// Test the MarkdownEngine
console.log('Testing MarkdownEngine...\n');

const engine = new MarkdownEngine({
  includeTree: true,
  includeCommands: true,
  includeFeatures: false,
  includeAPIs: false,
  includeBadges: true,
  includeFooter: true,
});

const readme = engine.build({
  metadata: mockMetadata,
  techReport: mockTechReport,
  inferenceResult: mockInferenceResult,
  featureResult: null,
  apiResult: null,
  aiContent: {
    overview: 'This is a comprehensive test project that demonstrates the capabilities of the README-AI-Gen tool.',
  },
  tree: mockTree,
});

console.log('Generated README:\n');
console.log(readme);
console.log('\n✅ MarkdownEngine test completed successfully!');
