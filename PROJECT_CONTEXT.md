# PROJECT CONTEXT: README-AI-Gen

This document serves as the **Master Context** for all AI agents working on the README-AI-Gen project. Refer to this file to understand the project goals, technical standards, and your specific role.

## Project Vision
**README-AI-Gen** is a professional-grade CLI tool that uses AI to analyze your project's codebase and generate a comprehensive, visually appealing, and accurate README.md file.

## Technical Standards
- **Runtime**: Node.js (Latest LTS)
- **Language**: TypeScript (ESM)
- **Style**: Clean, modular, and documented code.
- **Core Dependencies**: `commander`, `fs-extra`, `ignore`, `glob`, `openai`, `@google/generative-ai`, `@anthropic-ai/sdk`, `dotenv`.
- **Supported Providers**: NVIDIA, OpenRouter, OpenAI, Anthropic, Gemini.

## 7-Day Roadmap
- Day 1: Scaffold & Scanner (Complete)
- Day 2: Tech Stack Detection (Complete)
- Day 3: AI Core Integration (Complete)
- Day 4: Command Inference & CLI Orchestration (Complete)
- Day 5: Feature & API Extraction (Complete)
- Day 6: Markdown Engine & Badges (Complete)
- Day 7: Interactive CLI & Polish (Current Focus)

---

## AI Agent Roles & Responsibilities

### Agent 1: The Architect (Markdown Engine Integration)
**Task**: Integrate the Markdown Engine into the CLI and manage the final output pipeline.
- Update `src/cli/index.ts` to call the `MarkdownEngine` for final README generation.
- Add CLI flags for controlling output format (e.g., `--output <file>`, `--stdout`).
- Implement robust file writing with collision handling and user prompts.
- Ensure all collected data (metadata, tech stack, commands, features, APIs) flows correctly to the engine.

### Agent 2: The Scanner (Data Pipeline Optimization)
**Task**: Ensure all previously generated data is clean, accessible, and optimized for the Markdown Engine.
- Review `FileInfo[]`, `TechReport`, `HarvestResult`, and `ContextData` structures.
- Optimize data serialization for Markdown consumption.
- Ensure consistent data types and remove any redundant or stale fields.
- Add helper methods to flatten or transform nested structures if needed.

### Agent 3: The Visualizer (Markdown Engine Core)
**Task**: Build the core Markdown generation engine that assembles the final README.
- Create `src/utils/markdown-engine.ts` as the main README assembler.
- Implement section builders: Overview, Features, API Reference, Tech Stack, Installation, Usage, Commands, Structure, Contributing, License.
- Integrate `BadgeGenerator` to embed dynamic tech badges in the header.
- Handle Markdown formatting: headings, lists, code blocks, tables, links, emojis.
- Ensure a visually appealing, comprehensive, and well-structured README.

### Agent 4: The Analyzer (Data Formatting & Sanitization)
**Task**: Refine and format all extracted data for clean Markdown rendering.
- Review output from `FeatureExtractor`, `ApiExtractor`, `CommandInference`, and `DependencyMapper`.
- Implement data sanitization (escape special characters, normalize names, format versions).
- Ensure consistent ordering and grouping of features, APIs, and commands.
- Build final data structures optimized for Markdown table/list rendering.

---

## Instructions for Agents
1. **Research First**: Always read and analyze the existing codebase before writing new code.
2. **Collaborative Correction**: You ARE permitted to modify or refactor code written by other agents if you identify errors, bugs, or if changes are required to ensure your new module integrates correctly.
3. **Surgical Updates**: When modifying existing code, be precise. Do not perform unrelated refactoring; only change what is necessary for functionality, type-safety, or architectural alignment.
4. **Standards**: Use ESM imports, provide TypeScript types, and ensure code is well-commented.
5. **Update Status**: When a task is complete, update the "Implementation Status" below.
6. **No Interruptions**: DO NOT interrupt or modify another agent's work unless absolutely necessary for integration or if a critical bug is found. Work independently on your assigned task.
7. **One Task at a Time**: Each agent works on their task independently. Do not start until the previous agent has completed (check Implementation Status below).

## Implementation Status
- [x] **Day 1-6**: All core modules implemented and tested
- [x] **CLI Pipeline**: Full 8-step pipeline working (scan → analyse → tree → commands → context → AI → sanitize → markdown)
- [x] **AI Generation**: Working with OpenRouter auto model (tested with gemini-2.5-flash-lite, openai/gpt-oss-120b)
- [x] **Markdown Engine**: Produces professional README with badges, tables, code blocks, tree, commands
- [ ] **Day 7**: Interactive CLI & Polish (Current Focus)

## Day 7: Interactive CLI & Polish — Agent Tasks

**⚠️ IMPORTANT**: Work on agents' tasks SEQUENTIALLY. Agent 1 first, then Agent 2, then Agent 3, then Agent 4. Do not start your task until the previous agent has completed and checked off their work below.

### Agent 1: The Architect (Interactive Mode & Caching)
**Task**: Add interactive mode with prompts and implement caching for faster re-runs.
- Add `--interactive` / `-i` flag for guided README generation with step-by-step prompts
- Implement analysis cache: store `TechReport`, commands, metadata in `.readme-ai-gen-cache.json`
- Add `--no-cache` flag to bypass cache, `--refresh-cache` to force rebuild
- Add progress indicators and spinner during long operations (AI generation, context building)
- Implement `--dry-run` mode: show what would be generated without writing files

**Status**: ✅ COMPLETE - All features implemented and tested

### Agent 2: The Scanner (Template System & Customization)
**Task**: Add template support for different README styles and project types.
- Create `src/utils/templates.ts` with predefined README templates (minimal, standard, comprehensive, api-docs)
- Add `--template <name>` CLI flag to select template
- Add `--custom-template <path>` to load user-defined template (JSON/YAML config)
- Implement section toggling: `--no-overview`, `--no-installation`, `--no-usage`, `--no-structure`, `--no-contributing`, `--no-license`
- Add `--badge-style <style>` flag (shields-for-the-badge, shields-flat, badges/flat, none)

**Status**: ✅ COMPLETE - All features implemented and tested

### Agent 3: The Visualizer (Enhanced Output & Validation)
**Task**: Add README validation, preview, and export options.
- Create `src/utils/validator.ts` to check generated README for common issues
- Add `--validate` flag: run checks (broken links, missing sections, formatting issues)
- Add `--preview` flag: open generated README in default markdown viewer/browser
- Implement `--format <format>` flag for output format (markdown, html, pdf)
- Add word count, reading time, and section statistics to output summary
- Ensure all generated READMEs pass markdown lint checks

**Status**: ✅ COMPLETE - All features implemented and tested

### Agent 4: The Analyzer (Polish & Documentation)
**Task**: Final polish, error handling improvements, and comprehensive documentation.
- [x] Add comprehensive error messages with actionable suggestions
- [x] Implement `--debug` flag for detailed troubleshooting output
- [x] Create example `.env.example` file with all supported environment variables
- [x] Add `readme-ai-gen examples` command to show usage examples
- [x] Update main README.md with complete feature list, examples, and troubleshooting
- [x] Add `--quiet` / `-q` flag for minimal output (CI/CD friendly)
- [x] Ensure all CLI flags have proper help text and examples in `--help`

**Status**: ✅ COMPLETE - All features implemented and tested

