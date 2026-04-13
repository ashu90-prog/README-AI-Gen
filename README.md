# README-AI-Gen

![v1.0.0](https://img.shields.io/badge/v1.0.0-informational?style=for-the-badge)
![ISC](https://img.shields.io/badge/ISC-blue?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)

> AI-powered CLI tool that analyses your project and generates a beautiful README.md.

## ✨ Features

### Analysis
- Recursive file scanning with `.gitignore` support
- Project type detection (Node.js, Python, React, etc.)
- Language breakdown and file counting
- Command inference from `package.json`, scripts, and config files
- ASCII directory tree generation

### AI Generation
- Multi-provider support (OpenAI, Anthropic, Gemini, OpenRouter, NVIDIA)
- OpenRouter auto model support (best model selection)
- Interactive mode with guided prompts
- Analysis caching for faster re-runs
- Dry-run mode to preview output

### Templates & Customization
- 4 predefined templates (minimal, standard, comprehensive, api-docs)
- Custom template support (JSON/YAML)
- Badge style control (6 styles + none)
- Section toggling (include/exclude any section)

### Validation & Quality
- README validation with error/warning/suggestion system
- Detailed statistics (word count, reading time, etc.)
- Preview in browser/markdown viewer
- Markdown linting compliance

### Developer Experience
- Progress indicators during long operations
- Quiet mode for CI/CD pipelines
- Debug mode for troubleshooting
- Comprehensive error messages with suggestions
- Examples command for quick reference

## 📦 Installation

### Option 1: Install from npm (Recommended for Users)

```bash
# Install globally - available immediately
npm install -g readme-ai-gen
```

### Option 2: Install from Source (For Developers)

```bash
# Clone the repository
git clone https://github.com/ashu90-prog/README-AI-Gen.git
cd README-AI-Gen

# Install dependencies
npm install

# Build the project
npm run build

# Link globally (makes readme-ai-gen command available everywhere)
npm link
```

### Verify Installation

```bash
# Check version
readme-ai-gen --version

# Check AI provider configuration
readme-ai-gen keys
```

## 🔑 Setup

1. Get an API key from a supported provider:
   - OpenRouter (recommended): https://openrouter.ai/keys
   - OpenAI: https://platform.openai.com/api-keys
   - Anthropic: https://console.anthropic.com/settings/keys
   - Gemini: https://aistudio.google.com/app/apikey
   - NVIDIA: https://build.nvidia.com/explore/discover

2. Set the environment variable:
   ```bash
   # Windows CMD
   set OPENROUTER_API_KEY=sk-or-...

   # PowerShell
   $env:OPENROUTER_API_KEY="sk-or-..."

   # Or create .env file (copy from .env.example)
   ```

3. Verify configuration:
   ```bash
   readme-ai-gen keys
   ```

## 🚀 Quick Start

```bash
# Generate README (uses cache if available)
readme-ai-gen generate

# Interactive mode (recommended for first time)
readme-ai-gen generate --interactive

# Analyse without AI (fast)
readme-ai-gen generate --no-ai

# Full AI generation with validation
readme-ai-gen generate --validate --stats
```

## 📖 Usage Examples

See all examples:
```bash
readme-ai-gen examples
```

Common patterns:
```bash
# Quick generation
readme-ai-gen generate --provider openrouter --model openrouter/auto

# Custom output and template
readme-ai-gen generate --output docs/README.md --template comprehensive

# Dry run with validation
readme-ai-gen generate --dry-run --validate

# CI/CD pipeline
readme-ai-gen generate --quiet --stdout > README.md
```

## ⚙️ Command Reference

### generate

Analyse a project directory and generate a README.md.

```bash
readme-ai-gen generate [path] [options]
```

**Arguments**:
- `path` - Path to project root (default: `.`)

**Options**:
- `-o, --output <file>` - Output file path (default: `README.md`)
- `--stdout` - Print to stdout instead of writing file
- `-f, --force` - Overwrite existing file without prompting
- `--max-depth <n>` - Maximum scan depth (0 = unlimited)
- `--ignore <patterns...>` - Additional glob patterns to ignore
- `--no-tree` - Skip directory tree in output

**AI Options**:
- `--provider <name>` - AI provider (openai | anthropic | gemini | openrouter | nvidia)
- `--model <name>` - Override default model
- `--api-key <key>` - API key (overrides env variables)
- `--interactive-key` - Prompt for API key interactively
- `--max-tokens <n>` - Maximum tokens (default: 4096)
- `--temperature <n>` - AI temperature 0-2 (default: 0.7)
- `--no-ai` - Skip AI generation (analysis-only mode)

**Interactive & Cache**:
- `-i, --interactive` - Interactive mode with guided prompts
- `--no-cache` - Disable cache loading
- `--refresh-cache` - Clear and rebuild cache
- `--cache-ttl <hours>` - Cache TTL in hours (default: 24)
- `--dry-run` - Run without writing output file

**Templates & Customization**:
- `--template <name>` - README template (minimal | standard | comprehensive | api-docs)
- `--custom-template <path>` - Custom template JSON file
- `--badge-style <style>` - Badge style (for-the-badge | flat | flat-square | plastic | social | none)
- `--no-overview` - Exclude overview section
- `--no-tech-stack` - Exclude tech stack section
- `--no-commands` - Exclude commands section
- `--no-features` - Exclude features section
- `--no-api-reference` - Exclude API reference section
- `--no-installation` - Exclude installation section
- `--no-usage` - Exclude usage section
- `--no-structure` - Exclude structure section
- `--no-contributing` - Exclude contributing section
- `--no-license` - Exclude license section

**Validation & Preview**:
- `--validate` - Validate generated README
- `--stats` - Show detailed statistics
- `--preview` - Open in default viewer/browser

**Output Modes**:
- `--verbose` - Enable detailed logging
- `--debug` - Debug mode (stack traces, context, environment)
- `-q, --quiet` - Quiet mode (minimal output, CI/CD friendly)

### keys

Show which AI providers have API keys configured.

```bash
readme-ai-gen keys [--verbose]
```

### validate

Validate an existing README file for common issues.

```bash
readme-ai-gen validate [file]
```

### examples

Show common usage examples.

```bash
readme-ai-gen examples
```

## 🏗️ Architecture

```
readme-ai-gen generate
│
├── Step 1: FileScanner (scan project)
├── Step 2: TechMapper (detect languages/types)
├── Step 3: TreeGenerator (ASCII tree)
├── Step 4: CommandInference (find commands)
├── Step 5: ContextBuilder (build AI context)
├── Step 6: AIEngine (generate content)
├── Step 7: DataSanitizer (clean data)
└── Step 8: MarkdownEngine (assemble README)
```

## 🧪 Development

```bash
# Build
npm run build

# Run from source
npm start -- generate --no-ai

# Lint
npm run lint
```

## ❓ Troubleshooting

### No API key found
```bash
readme-ai-gen keys
# Set key via .env or --api-key flag
```

### Rate limit exceeded
```bash
# Wait and retry, or use OpenRouter
readme-ai-gen generate --provider openrouter
```

### Model not available
```bash
# Use auto model
readme-ai-gen generate --model openrouter/auto
```

### Cache issues
```bash
# Clear cache
readme-ai-gen generate --refresh-cache
```

### Validation errors
```bash
# See what's wrong
readme-ai-gen generate --validate
```

### Debug mode
```bash
# Show detailed context, stack traces, and environment
readme-ai-gen generate --debug
```

## 📄 License

ISC

---

<div align="center">

**Generated with ❤️ by README-AI-Gen**

</div>
