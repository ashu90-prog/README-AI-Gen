/**
 * Templates — Predefined README templates and template management.
 *
 * Provides a collection of ready-to-use README templates for different
 * project types and documentation needs. Supports custom template loading
 * from JSON files.
 *
 * @module utils/templates
 */

import fs from 'fs-extra';
import { BadgeStyle } from './badge.js';

// ─────────────────────────── Types ───────────────────────────

/**
 * Represents a README template with section configuration.
 */
export interface Template {
  /** Template identifier */
  name: string;
  /** Human-readable description */
  description: string;
  /** Section IDs to include in README */
  sections: SectionId[];
  /** Default badge style for this template */
  badgeStyle: BadgeStyle;
  /** Whether to include footer */
  includeFooter: boolean;
}

/**
 * Valid section identifiers.
 */
export type SectionId =
  | 'header'
  | 'overview'
  | 'tech-stack'
  | 'commands'
  | 'features'
  | 'api-reference'
  | 'installation'
  | 'usage'
  | 'structure'
  | 'contributing'
  | 'license'
  | 'footer';

// ─────────────────────────── Templates ───────────────────────────

/**
 * Predefined README templates.
 */
export const TEMPLATES: Record<string, Template> = {
  /**
   * Minimal template: Just the essentials.
   * Best for: Small projects, scripts, simple tools.
   */
  minimal: {
    name: 'Minimal',
    description: 'Just the essentials - perfect for small projects and scripts.',
    sections: ['header', 'overview', 'installation', 'usage', 'license', 'footer'],
    badgeStyle: 'for-the-badge',
    includeFooter: true,
  },

  /**
   * Standard template: Balanced documentation for most projects.
   * Best for: Libraries, applications, most open-source projects.
   */
  standard: {
    name: 'Standard',
    description: 'Balanced documentation for most projects - the default choice.',
    sections: ['header', 'overview', 'tech-stack', 'commands', 'installation', 'usage', 'structure', 'license', 'footer'],
    badgeStyle: 'for-the-badge',
    includeFooter: true,
  },

  /**
   * Comprehensive template: All sections included.
   * Best for: Large projects, frameworks, enterprise applications.
   */
  comprehensive: {
    name: 'Comprehensive',
    description: 'All sections included - ideal for large projects and frameworks.',
    sections: ['header', 'overview', 'tech-stack', 'commands', 'features', 'api-reference', 'installation', 'usage', 'structure', 'contributing', 'license', 'footer'],
    badgeStyle: 'for-the-badge',
    includeFooter: true,
  },

  /**
   * API Docs template: Focus on API reference and usage.
   * Best for: REST APIs, SDKs, backend services.
   */
  'api-docs': {
    name: 'API Docs',
    description: 'API-focused documentation with emphasis on reference and usage.',
    sections: ['header', 'overview', 'tech-stack', 'installation', 'api-reference', 'usage', 'contributing', 'license', 'footer'],
    badgeStyle: 'for-the-badge',
    includeFooter: true,
  },
};

// ─────────────────────────── Helper Functions ───────────────────────────

/**
 * Get a template by name.
 *
 * @param name - Template name (e.g., 'minimal', 'standard', 'comprehensive', 'api-docs')
 * @returns The template object
 * @throws Error if template name is invalid
 */
export function getTemplate(name: string): Template {
  const template = TEMPLATES[name];
  if (!template) {
    const available = listTemplates().join(', ');
    throw new Error(
      `Invalid template name: "${name}". Available templates: ${available}`
    );
  }
  return template;
}

/**
 * List all available template names.
 *
 * @returns Array of template names
 */
export function listTemplates(): string[] {
  return Object.keys(TEMPLATES);
}

/**
 * Load a custom template from a JSON file.
 *
 * @param filePath - Path to JSON template file
 * @returns The loaded template object
 * @throws Error if file is invalid or missing required fields
 */
export function loadCustomTemplate(filePath: string): Template {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    validateTemplate(data);

    return data as Template;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Invalid template')) {
      throw err;
    }
    throw new Error(
      `Failed to load custom template from "${filePath}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Validate that a template object has all required fields.
 *
 * @param template - Partial template object to validate
 * @throws Error if template is missing required fields or has invalid values
 */
export function validateTemplate(template: Partial<Template>): void {
  if (!template.name || typeof template.name !== 'string') {
    throw new Error('Invalid template: missing or invalid "name" field (must be a string)');
  }

  if (!template.description || typeof template.description !== 'string') {
    throw new Error('Invalid template: missing or invalid "description" field (must be a string)');
  }

  if (!Array.isArray(template.sections)) {
    throw new Error('Invalid template: missing or invalid "sections" field (must be an array)');
  }

  const validSections: SectionId[] = [
    'header',
    'overview',
    'tech-stack',
    'commands',
    'features',
    'api-reference',
    'installation',
    'usage',
    'structure',
    'contributing',
    'license',
    'footer',
  ];

  for (const section of template.sections) {
    if (!validSections.includes(section as SectionId)) {
      throw new Error(
        `Invalid template: invalid section "${section}". Valid sections: ${validSections.join(', ')}`
      );
    }
  }

  if (!template.badgeStyle || typeof template.badgeStyle !== 'string') {
    throw new Error('Invalid template: missing or invalid "badgeStyle" field (must be a string)');
  }

  const validBadgeStyles: BadgeStyle[] = [
    'flat',
    'flat-square',
    'for-the-badge',
    'plastic',
    'social',
    'none',
  ];

  if (!validBadgeStyles.includes(template.badgeStyle as BadgeStyle)) {
    throw new Error(
      `Invalid template: invalid badgeStyle "${template.badgeStyle}". Valid styles: ${validBadgeStyles.join(', ')}`
    );
  }

  if (typeof template.includeFooter !== 'boolean') {
    throw new Error('Invalid template: missing or invalid "includeFooter" field (must be a boolean)');
  }
}
