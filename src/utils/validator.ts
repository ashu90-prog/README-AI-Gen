/**
 * Validator — README validation and statistics.
 *
 * Provides comprehensive validation for generated README files including
 * structure checks, content validation, formatting issues, and badge validation.
 * Also calculates statistics like word count, reading time, and section counts.
 *
 * @module utils/validator
 */

// ─────────────────────────── Types ───────────────────────────

/**
 * Severity level for validation issues.
 */
export type ValidationSeverity = 'error' | 'warning' | 'info';

/**
 * A single validation issue found in the README.
 */
export interface ValidationIssue {
  /** Rule that was violated */
  rule: string;
  /** Human-readable description of the issue */
  message: string;
  /** How serious is this issue? */
  severity: ValidationSeverity;
  /** Line number where issue was found (if applicable) */
  line?: number;
}

/**
 * Statistics about the README content.
 */
export interface ValidationStats {
  /** Total word count */
  wordCount: number;
  /** Total line count */
  lineCount: number;
  /** Number of sections (H2 headings) */
  sectionCount: number;
  /** Number of code blocks */
  codeBlockCount: number;
  /** Number of links */
  linkCount: number;
  /** Number of badges (images from shields.io) */
  badgeCount: number;
  /** Estimated reading time in minutes */
  readingTimeMinutes: number;
}

/**
 * Result of README validation.
 */
export interface ValidationResult {
  /** Whether the README passes all error checks */
  isValid: boolean;
  /** Errors that must be fixed */
  errors: ValidationIssue[];
  /** Warnings that should be considered */
  warnings: ValidationIssue[];
  /** Informational suggestions */
  suggestions: ValidationIssue[];
  /** Content statistics */
  stats: ValidationStats;
}

// ─────────────────────────── Validator ───────────────────────────

/**
 * `Validator` checks README content for common issues and calculates statistics.
 */
export class Validator {
  /**
   * Validate README content and return results.
   *
   * @param readmeContent - The README markdown string
   * @returns ValidationResult with issues and stats
   */
  validate(readmeContent: string): ValidationResult {
    const lines = readmeContent.split('\n');
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const suggestions: ValidationIssue[] = [];

    // Run all validation checks
    this.checkStructure(lines, errors);
    this.checkContent(lines, warnings);
    this.checkFormatting(lines, warnings);
    this.checkBadges(lines, suggestions);

    // Calculate statistics
    const stats = this.calculateStats(readmeContent, lines);

    // README is valid if there are no errors
    const isValid = errors.length === 0;

    return {
      isValid,
      errors,
      warnings,
      suggestions,
      stats,
    };
  }

  /**
   * Check for structural issues (errors).
   */
  private checkStructure(lines: string[], errors: ValidationIssue[]): void {
    // Check for H1 heading
    const hasH1 = lines.some(line => line.trim().startsWith('# '));
    if (!hasH1) {
      errors.push({
        rule: 'structure',
        message: 'No H1 heading found (e.g., "# Project Name")',
        severity: 'error',
      });
    }

    // Check for overview/description section
    const hasOverview = lines.some(line => 
      line.trim().toLowerCase().startsWith('## overview') ||
      line.trim().toLowerCase().startsWith('## description')
    );
    if (!hasOverview) {
      errors.push({
        rule: 'structure',
        message: 'No overview or description section found',
        severity: 'error',
      });
    }

    // Check for installation/getting-started section
    const hasInstallation = lines.some(line =>
      line.trim().toLowerCase().startsWith('## installation') ||
      line.trim().toLowerCase().startsWith('## getting started') ||
      line.trim().toLowerCase().startsWith('## setup')
    );
    if (!hasInstallation) {
      errors.push({
        rule: 'structure',
        message: 'No installation or getting started section found',
        severity: 'error',
      });
    }

    // Check for logical section order
    const sectionOrder = this.getSectionOrder(lines);
    if (!this.isLogicalOrder(sectionOrder)) {
      errors.push({
        rule: 'structure',
        message: 'Sections are not in logical order. Recommended order: Header → Overview → Tech Stack → Commands → Features → API Reference → Installation → Usage → Structure → Contributing → License → Footer',
        severity: 'error',
      });
    }

    // Check for duplicate section headings
    const headings = lines
      .filter(line => line.trim().startsWith('## '))
      .map(line => line.trim().substring(3).trim().toLowerCase());
    
    const seenHeadings = new Set<string>();
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      if (seenHeadings.has(heading)) {
        const lineIndex = lines.findIndex(l => l.trim().toLowerCase().startsWith('## ' + heading));
        errors.push({
          rule: 'structure',
          message: `Duplicate heading: "${heading}"`,
          severity: 'error',
          line: lineIndex + 1,
        });
      }
      seenHeadings.add(heading);
    }
  }

  /**
   * Check for content issues (warnings).
   */
  private checkContent(lines: string[], warnings: ValidationIssue[]): void {
    // Check for empty sections
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('## ')) {
        // Check if next non-empty line is another heading
        let nextContentIndex = i + 1;
        while (nextContentIndex < lines.length && lines[nextContentIndex].trim() === '') {
          nextContentIndex++;
        }
        
        if (nextContentIndex < lines.length && lines[nextContentIndex].trim().startsWith('## ')) {
          warnings.push({
            rule: 'content',
            message: `Empty section: "${line.trim().substring(3)}"`,
            severity: 'warning',
            line: i + 1,
          });
        }
      }
    }

    // Check for placeholder text
    const placeholders = [
      'TODO',
      'FIXME',
      '[description]',
      '[project name]',
      '[your name]',
      '[your email]',
      '[license]',
      '[version]',
    ];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const placeholder of placeholders) {
        if (line.includes(placeholder)) {
          warnings.push({
            rule: 'content',
            message: `Placeholder text detected: "${placeholder}"`,
            severity: 'warning',
            line: i + 1,
          });
          break;
        }
      }
    }

    // Check for code blocks without language specifier
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '```') {
        // Check if this is the start of a code block
        if (i === 0 || !lines[i - 1].trim().startsWith('```')) {
          // This is the opening fence, check if it has a language
          if (line.trim() === '```') {
            warnings.push({
              rule: 'content',
              message: 'Code block without language specifier (e.g., ```bash, ```javascript)',
              severity: 'warning',
              line: i + 1,
            });
          }
        }
      }
    }

    // Check for improperly formatted links
    const linkPattern = /\[([^\]]+)\]\(\s*\)/g;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = line.matchAll(linkPattern);
      for (const match of matches) {
        warnings.push({
          rule: 'content',
          message: `Link with empty URL: "[${match[1]}]()"`,
          severity: 'warning',
          line: i + 1,
        });
      }
    }

    // Check for links without URLs
    const linkWithoutUrlPattern = /\[([^\]]+)\](?!\()/g;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = line.matchAll(linkWithoutUrlPattern);
      for (const match of matches) {
        // Make sure it's not part of a valid link
        if (!line.substring(match.index).includes('](')) {
          warnings.push({
            rule: 'content',
            message: `Link without URL: "[${match[1]}]"`,
            severity: 'warning',
            line: i + 1,
          });
        }
      }
    }
  }

  /**
   * Check for formatting issues (warnings).
   */
  private checkFormatting(lines: string[], warnings: ValidationIssue[]): void {
    // Check for trailing whitespace
    const trailingWhitespaceLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] !== lines[i].trimEnd()) {
        trailingWhitespaceLines.push(i + 1);
      }
    }
    
    if (trailingWhitespaceLines.length > 0) {
      warnings.push({
        rule: 'formatting',
        message: `Trailing whitespace on ${trailingWhitespaceLines.length} line(s) (lines: ${trailingWhitespaceLines.slice(0, 5).join(', ')}${trailingWhitespaceLines.length > 5 ? '...' : ''})`,
        severity: 'warning',
      });
    }

    // Check for consistent heading levels
    const headingLevels: number[] = [];
    for (const line of lines) {
      const match = line.match(/^(#{1,6})\s/);
      if (match) {
        headingLevels.push(match[1].length);
      }
    }
    
    for (let i = 1; i < headingLevels.length; i++) {
      const current = headingLevels[i];
      const previous = headingLevels[i - 1];
      
      // Check for skipped levels (e.g., H1 → H3)
      if (current > previous + 1) {
        warnings.push({
          rule: 'formatting',
          message: `Inconsistent heading levels: H${previous} → H${current} (skipped level)`,
          severity: 'warning',
        });
        break;
      }
    }

    // Check if file ends with newline
    if (lines.length > 0 && lines[lines.length - 1] !== '') {
      warnings.push({
        rule: 'formatting',
        message: 'File should end with a newline',
        severity: 'warning',
      });
    }
  }

  /**
   * Check for badge issues (info/suggestions).
   */
  private checkBadges(lines: string[], suggestions: ValidationIssue[]): void {
    // Count badges
    const badgePattern = /!\[.*?\]\(https:\/\/img\.shields\.io\/[^\)]+\)/g;
    let badgeCount = 0;
    for (const line of lines) {
      const matches = line.match(badgePattern);
      if (matches) {
        badgeCount += matches.length;
      }
    }

    // Warn if too many badges
    if (badgeCount > 50) {
      suggestions.push({
        rule: 'badge',
        message: `${badgeCount} badges may be excessive, consider reducing`,
        severity: 'info',
      });
    }

    // Check badge URL format
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = line.matchAll(/!\[.*?\]\((https:\/\/img\.shields\.io\/[^\)]+)\)/g);
      for (const match of matches) {
        const url = match[1];
        
        // Check for required parameters
        if (!url.includes('label=') && !url.includes('style=')) {
          suggestions.push({
            rule: 'badge',
            message: `Badge URL may be missing required parameters: ${url}`,
            severity: 'info',
            line: i + 1,
          });
        }
      }
    }
  }

  /**
   * Calculate statistics about the README content.
   */
  private calculateStats(content: string, lines: string[]): ValidationStats {
    // Word count
    const words = content.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;

    // Line count
    const lineCount = lines.length;

    // Section count (H2 headings)
    const sectionCount = lines.filter(line => line.trim().startsWith('## ')).length;

    // Code block count
    const codeBlockMatches = content.match(/```/g);
    const codeBlockCount = codeBlockMatches ? codeBlockMatches.length / 2 : 0;

    // Link count (excluding badges)
    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    const linkMatches = content.match(linkPattern);
    const linkCount = linkMatches ? linkMatches.length : 0;

    // Badge count
    const badgePattern = /!\[.*?\]\(https:\/\/img\.shields\.io\/[^\)]+\)/g;
    const badgeMatches = content.match(badgePattern);
    const badgeCount = badgeMatches ? badgeMatches.length : 0;

    // Reading time (200 words per minute, minimum 1 minute)
    const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

    return {
      wordCount,
      lineCount,
      sectionCount,
      codeBlockCount,
      linkCount,
      badgeCount,
      readingTimeMinutes,
    };
  }

  /**
   * Get the order of sections in the README.
   */
  private getSectionOrder(lines: string[]): string[] {
    const sections: string[] = [];
    for (const line of lines) {
      const match = line.match(/^##\s+(.+)$/);
      if (match) {
        sections.push(match[1].trim().toLowerCase());
      }
    }
    return sections;
  }

  /**
   * Check if sections are in logical order.
   */
  private isLogicalOrder(sections: string[]): boolean {
    const logicalOrder = [
      'overview',
      'description',
      'tech',
      'technology',
      'stack',
      'commands',
      'features',
      'api',
      'installation',
      'getting started',
      'setup',
      'usage',
      'structure',
      'project',
      'contributing',
      'license',
    ];

    let lastIndex = -1;
    for (const section of sections) {
      const normalizedSection = section.toLowerCase();
      let foundIndex = -1;
      
      for (let i = 0; i < logicalOrder.length; i++) {
        if (normalizedSection.includes(logicalOrder[i])) {
          foundIndex = i;
          break;
        }
      }

      if (foundIndex !== -1 && foundIndex < lastIndex) {
        return false;
      }
      
      if (foundIndex !== -1) {
        lastIndex = foundIndex;
      }
    }

    return true;
  }
}
