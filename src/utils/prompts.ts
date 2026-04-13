/**
 * PromptBuilder — Designs and structures prompts for AI analysis.
 *
 * This module is the "communication bridge" between the extracted project
 * data and the AI engine. It builds persona-based, highly structured prompts
 * that guide the LLM to generate accurate and professional README content.
 *
 * @module utils/prompts
 */

import { ProjectMetadata } from '../core/metadata-extractor.js';
import { TechReport } from '../core/tech-mapper.js';
import { DependencySummary, DependencyMapper } from '../core/dependency-mapper.js';
import { ContextBuildResult } from '../core/context-builder.js';
import { CommandContextResult, DetectedCommand } from '../core/command-context-builder.js';
import { ValidatedCommand, InferenceResult } from '../core/command-inference.js';
import { FeatureExtractionResult } from '../core/feature-extractor.js';
import { APIExtractionResult } from '../core/api-extractor.js';
import { ChatMessage } from '../core/ai-types.js';

// ─────────────────────────── Types ───────────────────────────

/**
 * Input data required to build a comprehensive prompt.
 */
export interface PromptData {
  /** Aggregated project metadata (name, version, etc.) */
  metadata: ProjectMetadata;
  /** Detected project types and languages */
  techReport: TechReport;
  /** Categorised dependency list */
  dependencies: DependencySummary[];
  /** ASCII directory tree string */
  tree: string;
  /** Relevant source code context from ContextBuilder */
  context: ContextBuildResult;
  /** Command inference results (validated commands, stats) */
  inferenceResult?: InferenceResult;
  /** Feature extraction results (validated features from codebase) */
  featureResult?: FeatureExtractionResult;
  /** API extraction results (validated endpoints from codebase) */
  apiResult?: APIExtractionResult;
}

/**
 * README sections that can be generated.
 */
export type ReadmeSection =
  | 'overview'
  | 'features'
  | 'features_extraction'
  | 'installation'
  | 'usage'
  | 'api'
  | 'api_endpoint_discovery'
  | 'commands'
  | 'contributing'
  | 'full';

// ─────────────────────────── Persona ───────────────────────────

const SYSTEM_PERSONA = `
You are a Senior Documentation Engineer and Expert Technical Writer. 
Your goal is to analyze a project's codebase and generate a professional-grade, 
visually appealing, and highly accurate README.md.

Guidelines:
- Be concise, technical, and objective.
- Use professional terminology appropriate for the detected tech stack.
- Avoid fluff, marketing speak, or excessive adjectives.
- Ensure all instructions (installation, usage) are derived directly from the provided context.
- Prioritize accuracy over creativity; never hallucinate features or libraries not found in the source.
- Use proper Markdown formatting, including tables, lists, and code blocks.
`.trim();

// ─────────────────────────── Service ───────────────────────────

/**
 * `PromptBuilder` constructs structured prompts for different AI providers.
 */
export class PromptBuilder {
  /**
   * Builds a system message defining the AI's persona.
   */
  public static buildSystemMessage(): ChatMessage {
    return {
      role: 'system',
      content: SYSTEM_PERSONA,
    };
  }

  /**
   * Builds the core context block containing all project data.
   * This block is shared across most prompts.
   */
  public static buildContextBlock(data: PromptData): string {
    const { metadata, techReport, dependencies, tree, context, inferenceResult, featureResult, apiResult } = data;

    const sections: string[] = [
      '# PROJECT CONTEXT',
      '',
      '## Metadata',
      `- Name: ${metadata.name || 'Unknown'}`,
      `- Version: ${metadata.version || '0.0.0'}`,
      `- Description: ${metadata.description || 'No description provided.'}`,
      `- Authors: ${metadata.authors.map(a => a.name).filter(Boolean).join(', ') || 'Unknown'}`,
      `- License: ${metadata.license?.spdx || metadata.license?.name || 'Unknown'}`,
      `- Repository: ${metadata.repository?.url || 'Unknown'}`,
      '',
      '## Tech Stack',
      `- Project Types: ${techReport.projectTypes.map(pt => pt.label).join(', ')}`,
      `- Core Languages: ${Array.from(techReport.languages.values()).map(l => l.name).join(', ')}`,
      '',
      DependencyMapper.toPromptBlock(dependencies),
      '',
      '## Directory Structure',
      '```text',
      tree,
      '```',
      '',
    ];

    // ── Detected Commands (from inference) ──
    if (inferenceResult && inferenceResult.commands.length > 0) {
      sections.push('## Detected Commands');
      sections.push('The following commands have been inferred from the codebase:');
      sections.push('');
      for (const cmd of inferenceResult.commands) {
        const sourceTag = cmd.source === 'heuristic' ? ' [heuristic]' : '';
        sections.push(`- \`${cmd.command}\` — ${cmd.description}${sourceTag}`);
      }
      sections.push('');
    }

    // ── Extracted Features ──
    if (featureResult && featureResult.validated.length > 0) {
      sections.push('## Extracted Features');
      sections.push('The following features have been validated from the codebase:');
      sections.push('');
      for (const f of featureResult.validated.slice(0, 15)) {
        sections.push(`- **${f.name}** — ${f.description} (${f.scope})`);
      }
      sections.push('');
    }

    // ── Extracted API Endpoints ──
    if (apiResult && apiResult.validated.length > 0) {
      sections.push('## Extracted API Endpoints');
      sections.push('The following API endpoints have been validated:');
      sections.push('');
      for (const ep of apiResult.validated.slice(0, 20)) {
        sections.push(`- \`${ep.method} ${ep.path}\` — ${ep.description || 'No description'}`);
      }
      sections.push('');
    }

    sections.push(
      '## Source Code Highlights',
      'Below is a selection of the most relevant source files from the project:',
      '',
    );

    for (const file of context.files) {
      sections.push(`### File: ${file.file.path}`);
      if (file.truncated) {
        sections.push(`> [!NOTE] This file has been truncated to fit the context window.`);
      }
      sections.push('```' + file.file.extension);
      sections.push(file.content);
      sections.push('```');
      sections.push('');
    }

    return sections.join('\n');
  }

  /**
   * Generates a complete prompt (user message) for a specific README section.
   */
  public static buildSectionPrompt(section: ReadmeSection, data: PromptData): ChatMessage {
    const contextBlock = this.buildContextBlock(data);
    let instructions = '';

    switch (section) {
      case 'overview':
        instructions = `
TASK: Generate the "Project Overview" and "Introduction" section.
- Write a compelling 2-3 paragraph summary of what the project does.
- Identify the primary problem it solves and its target audience.
- Include the project name and a tagline if appropriate.
- Mention the core technologies used at a high level.
`.trim();
        break;

      case 'features':
        instructions = `
TASK: Generate a "Key Features" section.
- Extract functional features directly from the provided source code.
- Present them as a clean bulleted list with bold headers.
- Each feature should have a 1-sentence description.
- Group features logically if there are many.
`.trim();
        break;

      case 'features_extraction':
        instructions = `
TASK: Extract and list all major user-facing features and internal functionalities.
- Identify key functionalities by analyzing the source code highlights and overall project context.
- For each feature:
  - Provide a concise name.
  - Write a 1-2 sentence description.
  - Indicate if it's a user-facing feature or an internal core functionality.
- Output a structured list (e.g., Markdown list).
`.trim();
        break;

      case 'installation':
        instructions = `
TASK: Generate "Installation" and "Setup" instructions.
- Provide step-by-step commands for setting up the project locally.
- Include prerequisites (e.g., Node.js version, Python version) based on the tech stack.
- Include commands for installing dependencies (e.g., npm install, pip install).
- If there are configuration steps (like .env files), mention them.
`.trim();
        break;

      case 'usage':
        instructions = `
TASK: Generate "Usage Examples" and "Getting Started".
- Provide clear, executable code snippets demonstrating core functionality.
- If it's a CLI tool, show common command-line examples.
- If it's a library, show a "Quick Start" code example.
- Include brief explanations for each example.
`.trim();
        break;

      case 'api':
        instructions = `
TASK: Generate an "API Reference" or "Module Documentation" section.
- Summarize the main classes, functions, or endpoints found in the source.
- For each item, include its name, a brief description, and key parameters.
- Be concise; this is a summary for a README, not full technical docs.
`.trim();
        break;

      case 'api_endpoint_discovery':
        instructions = `
TASK: Discover and list all public API endpoints and their key details.
- Focus on HTTP/S endpoints (e.g., REST, GraphQL) or major public functions/methods for libraries.
- For each endpoint or major API component:
  - Provide the route/name (e.g., GET /users, createUser(name)).
  - Briefly describe its purpose.
  - List relevant parameters or request body details (if applicable).
  - Indicate the expected response or return value.
- Output a structured list (e.g., Markdown table or list).
- If no public API is detected, state that clearly.
`.trim();
        break;

      case 'commands':
        instructions = `
TASK: Infer the primary project commands (Install, Build, Test, Run).
- Analyze the project structure and manifest files (e.g., package.json, Cargo.toml, Makefile).
- Identify the correct commands for:
  1. Installation (e.g., npm install, cargo build)
  2. Building the project (e.g., npm run build)
  3. Running tests (e.g., npm test, pytest)
  4. Running the application (e.g., npm start, python main.py)
- For each command, provide:
  - The exact command string.
  - A very short (1-sentence) explanation of what it does.
- Format the output as a JSON-like structure (but still within Markdown) if possible, or a clear bulleted list.
- If a command is not applicable or not found, omit it.
`.trim();
        break;

      case 'full':
        instructions = `
TASK: Generate a complete, professional README.md.
Include the following sections in order:
1. Title & Badges (Leave a placeholder for badges)
2. Project Overview / Description
3. Features
4. API Reference
5. Technology Stack (Overview)
6. Project Structure (The directory tree is already provided below)
7. Getting Started / Installation
8. Usage Examples
9. Contributing & License

Make it visually appealing with proper use of Markdown.
`.trim();
        break;

      default:
        instructions = `Analyze the provided context and generate a helpful section for the README.md.`;
    }

    return {
      role: 'user',
      content: `${contextBlock}\n\n---\n\n${instructions}`,
    };
  }

  /**
   * Builds an "Analysis Prompt" to ask the AI to summarize its understanding
   * before generating content. Useful for complex projects.
   */
  public static buildAnalysisPrompt(data: PromptData): ChatMessage {
    const contextBlock = this.buildContextBlock(data);
    const instructions = `
TASK: Analyze the provided codebase and metadata. 
Provide a high-level summary of:
1. The project's primary purpose.
2. The core architecture and design patterns used.
3. The main entry points and how data flows through the system.

This summary will be used as a foundation for generating individual README sections.
`.trim();

    return {
      role: 'user',
      content: `${contextBlock}\n\n---\n\n${instructions}`,
    };
  }
}
