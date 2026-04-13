/**
 * Test suite for DataSanitizer — validates escaping, normalization,
 * deduplication, ordering, and edge-case handling.
 */

import { DataSanitizer, SanitizedData } from '../dist/core/data-sanitizer.js';

// ─────────────────────────── Helpers ───────────────────────────

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✔ ${message}`);
  }
}

// ─────────────────────────── Static Method Tests ───────────────────────────

console.log('\n🧪 DataSanitizer Static Methods\n');

// escapeMarkdownInline
assert(
  DataSanitizer.escapeMarkdownInline('hello | world') === 'hello \\| world',
  'escapeMarkdownInline: escapes pipe characters',
);

assert(
  DataSanitizer.escapeMarkdownInline('a < b > c') === 'a &lt; b &gt; c',
  'escapeMarkdownInline: escapes angle brackets to HTML entities',
);

assert(
  DataSanitizer.escapeMarkdownInline('') === '',
  'escapeMarkdownInline: returns empty string for empty input',
);

assert(
  DataSanitizer.escapeMarkdownInline('plain text') === 'plain text',
  'escapeMarkdownInline: passes through safe text unchanged',
);

// escapeTableCell
assert(
  DataSanitizer.escapeTableCell('col1 | col2') === 'col1 \\| col2',
  'escapeTableCell: escapes pipe characters',
);

assert(
  DataSanitizer.escapeTableCell('line1\nline2') === 'line1<br>line2',
  'escapeTableCell: converts newlines to <br>',
);

assert(
  DataSanitizer.escapeTableCell('  padded  ') === 'padded',
  'escapeTableCell: trims whitespace',
);

// escapeInlineCode
assert(
  DataSanitizer.escapeInlineCode('npm run `build`') === 'npm run build',
  'escapeInlineCode: removes backticks from content',
);

assert(
  DataSanitizer.escapeInlineCode('npm install') === 'npm install',
  'escapeInlineCode: passes clean commands through',
);

// normalizeName
assert(
  DataSanitizer.normalizeName('**Bold Feature**') === 'Bold Feature',
  'normalizeName: strips bold markers',
);

assert(
  DataSanitizer.normalizeName('  extra   spaces  ') === 'extra spaces',
  'normalizeName: collapses whitespace',
);

assert(
  DataSanitizer.normalizeName('---leading-punctuation!!') === 'leading-punctuation',
  'normalizeName: removes leading/trailing punctuation',
);

assert(
  DataSanitizer.normalizeName('`code`') === 'code',
  'normalizeName: strips backticks',
);

assert(
  DataSanitizer.normalizeName('') === '',
  'normalizeName: returns empty for empty input',
);

// normalizeDescription
assert(
  DataSanitizer.normalizeDescription('  Has  **bold** and `code`  ') === 'Has bold and code',
  'normalizeDescription: strips inline formatting',
);

assert(
  DataSanitizer.normalizeDescription('A'.repeat(250)).length <= 200,
  'normalizeDescription: caps length at 200 characters',
);

assert(
  DataSanitizer.normalizeDescription('') === '',
  'normalizeDescription: returns empty for empty input',
);

// formatVersion
assert(
  DataSanitizer.formatVersion('^1.2.3') === '1.2.3',
  'formatVersion: strips caret prefix',
);

assert(
  DataSanitizer.formatVersion('~2.0.0') === '2.0.0',
  'formatVersion: strips tilde prefix',
);

assert(
  DataSanitizer.formatVersion('>=3.0.0') === '3.0.0',
  'formatVersion: strips >= prefix',
);

assert(
  DataSanitizer.formatVersion('*') === 'latest',
  'formatVersion: normalizes wildcard to "latest"',
);

assert(
  DataSanitizer.formatVersion(undefined) === 'latest',
  'formatVersion: returns "latest" for undefined',
);

// sanitizePath
assert(
  DataSanitizer.sanitizePath('/api//v1//users/') === '/api/v1/users',
  'sanitizePath: collapses double slashes and removes trailing slash',
);

assert(
  DataSanitizer.sanitizePath('`/api/users`') === '/api/users',
  'sanitizePath: strips backticks',
);

assert(
  DataSanitizer.sanitizePath('/') === '/',
  'sanitizePath: preserves root path',
);

// normalizeHTTPMethod
assert(
  DataSanitizer.normalizeHTTPMethod('get') === 'GET',
  'normalizeHTTPMethod: uppercases methods',
);

assert(
  DataSanitizer.normalizeHTTPMethod('PATCH') === 'PATCH',
  'normalizeHTTPMethod: preserves valid methods',
);

assert(
  DataSanitizer.normalizeHTTPMethod('BANANA') === 'UNKNOWN',
  'normalizeHTTPMethod: returns UNKNOWN for invalid methods',
);

// needsEscaping
assert(
  DataSanitizer.needsEscaping('hello | world') === true,
  'needsEscaping: detects pipe character',
);

assert(
  DataSanitizer.needsEscaping('clean text') === false,
  'needsEscaping: returns false for safe text',
);

// sanitizeForPrompt
assert(
  DataSanitizer.sanitizeForPrompt('{{template}} $var') === '{ {template} } \\$var',
  'sanitizeForPrompt: escapes template injection characters',
);

// ─────────────────────────── Integration Tests ───────────────────────────

console.log('\n🧪 DataSanitizer Integration (sanitize method)\n');

const sanitizer = new DataSanitizer();

// Test with all-null inputs (graceful degradation)
const emptyResult = sanitizer.sanitize({
  featureResult: null,
  apiResult: null,
  inferenceResult: null,
  dependencySummary: null,
});

assert(emptyResult.features.length === 0, 'Empty input: no features');
assert(emptyResult.endpoints.length === 0, 'Empty input: no endpoints');
assert(emptyResult.commands.length === 0, 'Empty input: no commands');
assert(emptyResult.dependencies.length === 0, 'Empty input: no dependencies');
assert(emptyResult.stats.itemsRemoved === 0, 'Empty input: 0 items removed');

// Test with command data
const cmdResult = sanitizer.sanitize({
  inferenceResult: {
    commands: [
      { command: 'npm install', description: 'Install deps | production', category: 'install', source: 'static-analysis', confidence: 1.0 },
      { command: 'npm run build', description: 'Build the <project>', category: 'build', source: 'static-analysis', confidence: 0.9 },
      { command: 'npm test', description: 'Run tests', category: 'test', source: 'heuristic', confidence: 0.7 },
      { command: 'npm start', description: 'Start app', category: 'run', source: 'ai', confidence: 0.8 },
      { command: 'npm install', description: 'Duplicate install', category: 'install', source: 'heuristic', confidence: 0.5 },
      { command: '', description: 'Empty command', category: 'other', source: 'ai', confidence: 0.1 },
    ],
    stats: { totalCommands: 6, staticCommandsUsed: 2, heuristicCommandsUsed: 1, aiCommandsAccepted: 2 },
    usedFallback: false,
  },
});

assert(cmdResult.stats.commandsIn === 6, 'Commands: input count = 6');
assert(cmdResult.stats.commandsOut === 4, 'Commands: output count = 4 (1 dup + 1 empty removed)');
assert(cmdResult.stats.itemsRemoved >= 2, 'Commands: at least 2 items removed');

// Verify pipe is escaped in description
const installCmd = cmdResult.commands.find(c => c.command === 'npm install');
assert(
  installCmd!.description.includes('\\|'),
  'Commands: pipe character escaped in table cell',
);

// Verify ordering: install < build < run < test
assert(cmdResult.commands[0].category === 'install', 'Commands: install comes first');
assert(cmdResult.commands[1].category === 'build', 'Commands: build comes second');

// Test with dependency data
const depResult = sanitizer.sanitize({
  dependencySummary: [
    { category: 'Web Framework', items: ['express', 'cors', 'express'] },  // has duplicate
    { category: 'Testing', items: ['jest', 'supertest'] },
    { category: 'Other', items: ['lodash'] },
    { category: 'Empty Group', items: [] },  // empty group
  ],
});

assert(depResult.stats.dependencyGroupsIn === 4, 'Dependencies: input count = 4');
assert(depResult.stats.dependencyGroupsOut === 3, 'Dependencies: output count = 3 (empty group removed)');

// Verify "Other" is sorted last
const lastGroup = depResult.dependencies[depResult.dependencies.length - 1];
assert(lastGroup.category === 'Other', 'Dependencies: "Other" group is last');

// Verify deduplication within groups
const webGroup = depResult.dependencies.find(g => g.category === 'Web Framework');
assert(webGroup!.count === 2, 'Dependencies: duplicate "express" removed from Web Framework group');

// Verify alphabetical ordering within groups
assert(webGroup!.items[0] === 'cors', 'Dependencies: items sorted alphabetically (cors before express)');

// ─────────────────────────── Summary ───────────────────────────

console.log('\n✅ All DataSanitizer tests completed!\n');
