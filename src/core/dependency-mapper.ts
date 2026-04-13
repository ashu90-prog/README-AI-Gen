/**
 * DependencyMapper — Groups raw dependencies into high-level categories.
 *
 * Consumes the `HarvestResult` produced by `DataHarvester` and classifies
 * every dependency into a human-readable category (e.g. "Web Framework",
 * "Testing", "Database", "Build Tool").
 *
 * The output is designed to feed directly into an AI prompt so the LLM
 * can write an accurate "Tech Stack" or "Dependencies" section.
 *
 * @module core/dependency-mapper
 */

import {
  Dependency,
  DependencyType,
  HarvestResult,
} from './data-harvester.js';

// ─────────────────────────── Types ───────────────────────────

/**
 * High-level category a dependency can belong to.
 */
export type DependencyCategory =
  | 'Web Framework'
  | 'Frontend Framework'
  | 'CSS / Styling'
  | 'State Management'
  | 'Routing'
  | 'API / HTTP'
  | 'Database'
  | 'ORM / ODM'
  | 'Authentication'
  | 'Validation'
  | 'Testing'
  | 'Linting / Formatting'
  | 'Build Tool'
  | 'Bundler'
  | 'Type System'
  | 'Logging'
  | 'CLI'
  | 'Documentation'
  | 'DevOps / CI'
  | 'Cloud / Infra'
  | 'AI / ML'
  | 'Data Processing'
  | 'Security'
  | 'Monitoring'
  | 'Utility'
  | 'Other';

/**
 * A dependency enriched with its detected category.
 */
export interface CategorisedDependency {
  /** Original dependency data from `DataHarvester`. */
  dependency: Dependency;
  /** Human-readable category. */
  category: DependencyCategory;
}

/**
 * Complete mapping result with dependencies grouped by category.
 */
export interface DependencyMapResult {
  /** Dependencies grouped by category (category → list). */
  byCategory: Map<DependencyCategory, CategorisedDependency[]>;
  /** Dependencies grouped by type (runtime / dev / peer / …). */
  byType: Map<DependencyType, CategorisedDependency[]>;
  /** Total number of unique dependencies mapped. */
  totalMapped: number;
  /** Number of dependencies that fell into the "Other" bucket. */
  unmappedCount: number;
}

/**
 * Summary format optimised for inclusion in an AI prompt.
 */
export interface DependencySummary {
  /** Category label. */
  category: DependencyCategory;
  /** Dependency names in this category. */
  items: string[];
}

// ─────────────── Pattern → Category Registry ────────────────

/**
 * Each entry is a tuple of `[pattern, category]`.
 * Patterns are matched **case-insensitively** against the dependency name.
 *
 * The list is ordered: more-specific patterns come first so they match
 * before a broad catch-all rule.
 */
const CATEGORY_PATTERNS: ReadonlyArray<readonly [RegExp, DependencyCategory]> = [
  // ── Web Frameworks ──
  [/^(express|fastify|hapi|koa|nest|next|nuxt|remix|sveltekit|hono|elysia|astro|gatsby|django|flask|fastapi|uvicorn|gunicorn|rails|sinatra|laravel|symfony|gin|echo|fiber|actix-web|rocket|axum|warp|tide|phoenix|plug)$/i,  'Web Framework'],

  // ── Frontend Frameworks ──
  [/^(react|react-dom|preact|vue|svelte|angular|@angular\/core|solid-js|lit|htmx|alpine|stimulus|stencil|qwik)$/i,         'Frontend Framework'],

  // ── CSS / Styling ──
  [/^(tailwindcss|postcss|autoprefixer|sass|node-sass|less|styled-components|@emotion|@mui|@chakra-ui|bootstrap|bulma|foundation-sites|windicss|unocss|stylelint|css-loader|style-loader|mini-css-extract-plugin)$/i, 'CSS / Styling'],
  [/tailwind|postcss|sass|scss|less|styled|emotion|css-module/i, 'CSS / Styling'],

  // ── State Management ──
  [/^(redux|@reduxjs\/toolkit|mobx|zustand|jotai|recoil|pinia|vuex|xstate|effector|nanostores|valtio|ngrx)$/i,    'State Management'],

  // ── Routing ──
  [/^(react-router|react-router-dom|vue-router|@angular\/router|wouter|reach-router|page\.js)$/i,                  'Routing'],

  // ── API / HTTP ──
  [/^(axios|node-fetch|undici|got|superagent|ky|ofetch|@apollo\/client|graphql|graphql-request|urql|trpc|@trpc|grpc|protobufjs|openapi|swagger|fetch-mock)$/i, 'API / HTTP'],
  [/graphql|grpc|rest-client|openapi/i, 'API / HTTP'],

  // ── Database ──
  [/^(pg|mysql2?|better-sqlite3|sqlite3|mongodb|mongoose|redis|ioredis|@planetscale|@neondatabase|typeorm|prisma|drizzle-orm|knex|sequelize|objection|mikro-orm|diesel|sqlx|sea-orm|gorm|ent|activerecord|sqlalchemy|peewee|tortoise-orm|psycopg2|asyncpg|aiopg|pymongo|motor)$/i, 'Database'],
  [/^@prisma|^prisma/i, 'Database'],

  // ── ORM / ODM (catch remaining) ──
  [/orm|odm|migration|activerecord/i, 'ORM / ODM'],

  // ── Authentication ──
  [/^(passport|jsonwebtoken|jwt|bcrypt|bcryptjs|argon2|next-auth|@auth|lucia|clerk|supertokens|keycloak|oauth|openid|firebase-admin|@firebase\/auth)$/i, 'Authentication'],
  [/passport-|auth0|oauth2/i, 'Authentication'],

  // ── Validation ──
  [/^(zod|yup|joi|ajv|class-validator|io-ts|superstruct|valibot|runtypes|vest|validator|express-validator)$/i, 'Validation'],

  // ── Testing ──
  [/^(jest|mocha|chai|sinon|vitest|@testing-library|cypress|playwright|@playwright|puppeteer|selenium|webdriver|supertest|nock|faker|@faker-js|factory-bot|pytest|unittest|nose|tox|coverage|rspec|minitest|phpunit|go-test|testify|mockery|gomock)$/i,    'Testing'],
  [/^@types\/jest|^@types\/mocha|^@jest|jest-|mocha-|chai-|testing-library|cypress-|playwright-/i, 'Testing'],
  [/test|spec|mock|fixture|snapshot/i, 'Testing'],

  // ── Linting / Formatting ──
  [/^(eslint|prettier|biome|@biomejs|stylelint|tslint|pylint|flake8|black|isort|ruff|mypy|pyright|rubocop|php-cs-fixer|golangci-lint|clippy|rustfmt)$/i, 'Linting / Formatting'],
  [/^eslint-|^@typescript-eslint|^prettier-|^stylelint-|lint/i, 'Linting / Formatting'],

  // ── Build Tools ──
  [/^(typescript|ts-node|tsx|esbuild|swc|@swc|babel|@babel|cmake|make|meson|ninja|bazel|gradle|maven|cargo|setuptools|flit|hatch|maturin)$/i, 'Build Tool'],

  // ── Bundlers ──
  [/^(webpack|rollup|vite|parcel|turbopack|rspack|snowpack|rome|bun)$/i,                            'Bundler'],
  [/webpack-|rollup-|vite-/i, 'Bundler'],

  // ── Type System ──
  [/^(@types\/|type-fest|ts-morph|ts-essentials|utility-types|typesafe|zod|io-ts)/i,                'Type System'],

  // ── Logging ──
  [/^(winston|pino|bunyan|morgan|log4js|chalk|consola|signale|debug|loglevel|logging|loguru|structlog|spdlog|serilog|log4j)$/i, 'Logging'],

  // ── CLI ──
  [/^(commander|yargs|inquirer|prompts|cac|citty|clack|ora|listr2|meow|minimist|caporal|argparse|click|typer|cobra|clap|structopt|thor)$/i, 'CLI'],

  // ── Documentation ──
  [/^(typedoc|jsdoc|docusaurus|@docusaurus|storybook|@storybook|compodoc|swagger-ui|redoc|mkdocs|sphinx|rustdoc|godoc|yard|phpdoc)$/i, 'Documentation'],
  [/storybook|docusaurus/i, 'Documentation'],

  // ── DevOps / CI ──
  [/^(husky|lint-staged|commitlint|semantic-release|release-it|changesets|@changesets|standard-version|conventional-changelog|docker|@docker|concurrently|cross-env|dotenv|env-cmd|npm-run-all)$/i, 'DevOps / CI'],

  // ── Cloud / Infra ──
  [/^(aws-sdk|@aws-sdk|@azure|@google-cloud|@firebase|firebase|vercel|netlify|serverless|@serverless|cloudflare|@cloudflare|terraform|pulumi|cdk|@aws-cdk)$/i, 'Cloud / Infra'],

  // ── AI / ML ──
  [/^(openai|@google\/generative-ai|@anthropic-ai|langchain|@langchain|llama|ollama|transformers|torch|tensorflow|keras|scikit-learn|numpy|scipy|pandas|xgboost|lightgbm|huggingface|@huggingface)$/i, 'AI / ML'],
  [/openai|langchain|llm|gpt|gemini|anthropic/i, 'AI / ML'],

  // ── Data Processing ──
  [/^(lodash|underscore|ramda|rxjs|immer|date-fns|dayjs|luxon|moment|uuid|nanoid|sharp|jimp|csv-parser|papaparse|cheerio|jsdom|unified|rehype|remark|markdown-it|xml2js|fast-xml-parser)$/i, 'Data Processing'],

  // ── Security ──
  [/^(helmet|cors|csurf|express-rate-limit|rate-limiter-flexible|hpp|xss|sanitize|dompurify|crypto|@noble|node-forge|snyk|@snyk|audit|socket\.io)$/i, 'Security'],

  // ── Monitoring ──
  [/^(@sentry|sentry|@datadog|newrelic|@opentelemetry|prom-client|prometheus|grafana|elastic-apm|bugsnag|rollbar|honeybadger)$/i, 'Monitoring'],

  // ── Utility (broad catches) ──
  [/^(fs-extra|glob|globby|fast-glob|ignore|minimatch|micromatch|chokidar|rimraf|del|mkdirp|semver|which|execa|cross-spawn|shelljs|p-limit|p-queue|p-retry|async|bluebird|deepmerge|klona|defu)$/i, 'Utility'],
];

// ─────────────────────────── Service ───────────────────────────

/**
 * `DependencyMapper` takes raw dependencies from `DataHarvester` and
 * classifies them into human-readable categories.
 *
 * @example
 * ```ts
 * import { FileScanner }      from './scanner.js';
 * import { DataHarvester }    from './data-harvester.js';
 * import { DependencyMapper } from './dependency-mapper.js';
 *
 * const files   = await new FileScanner('./proj').scan();
 * const harvest = await new DataHarvester().harvest(files);
 * const mapper  = new DependencyMapper();
 * const result  = mapper.map(harvest);
 *
 * for (const [cat, deps] of result.byCategory) {
 *   console.log(cat, deps.map(d => d.dependency.name));
 * }
 * ```
 */
export class DependencyMapper {
  /** Expose the pattern registry for extensions or tests. */
  public static readonly patterns = CATEGORY_PATTERNS;

  // ── Core mapping ──

  /**
   * Classify every dependency in a `HarvestResult`.
   *
   * @param harvest - The result of `DataHarvester.harvest()`.
   * @returns A `DependencyMapResult` with dependencies grouped by
   *          category and by type.
   */
  public map(harvest: HarvestResult): DependencyMapResult {
    const byCategory = new Map<DependencyCategory, CategorisedDependency[]>();
    const byType     = new Map<DependencyType, CategorisedDependency[]>();
    let unmappedCount = 0;

    // De-duplicate: only classify each dependency name once.
    const seen = new Set<string>();

    for (const [, deps] of harvest.dependencies) {
      for (const dep of deps) {
        const key = `${dep.name}::${dep.type}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const category = this.classify(dep.name);
        if (category === 'Other') unmappedCount++;

        const entry: CategorisedDependency = { dependency: dep, category };

        // By category
        const catList = byCategory.get(category);
        if (catList) {
          catList.push(entry);
        } else {
          byCategory.set(category, [entry]);
        }

        // By type
        const typeList = byType.get(dep.type);
        if (typeList) {
          typeList.push(entry);
        } else {
          byType.set(dep.type, [entry]);
        }
      }
    }

    return {
      byCategory,
      byType,
      totalMapped: seen.size,
      unmappedCount,
    };
  }

  // ── Classification ──

  /**
   * Classify a single dependency name into a `DependencyCategory`.
   *
   * @param name - The raw package / crate / gem name.
   * @returns The matched category, or `'Other'` if no pattern matches.
   */
  public classify(name: string): DependencyCategory {
    for (const [pattern, category] of CATEGORY_PATTERNS) {
      if (pattern.test(name)) return category;
    }
    return 'Other';
  }

  // ── Helpers ──

  /**
   * Produce a flat summary list suitable for injecting into an AI prompt.
   *
   * Returns one entry per category, sorted alphabetically, with the
   * dependency names deduplicated and sorted.
   *
   * @param result - Output of `map()`.
   */
  public summarise(result: DependencyMapResult): DependencySummary[] {
    const summaries: DependencySummary[] = [];

    for (const [category, deps] of result.byCategory) {
      if (category === 'Other' && deps.length > 20) {
        // If there are too many uncategorised items, truncate
        summaries.push({
          category,
          items: [
            ...deps.slice(0, 15).map(d => d.dependency.name),
            `… and ${deps.length - 15} more`,
          ],
        });
      } else {
        const unique = [...new Set(deps.map(d => d.dependency.name))].sort();
        summaries.push({ category, items: unique });
      }
    }

    // Sort by category name, but put "Other" last
    return summaries.sort((a, b) => {
      if (a.category === 'Other') return 1;
      if (b.category === 'Other') return -1;
      return a.category.localeCompare(b.category);
    });
  }

  /**
   * Render the summary as a human-readable Markdown snippet for prompts.
   *
   * @param summaries - Output of `summarise()`.
   */
  public static toMarkdown(summaries: DependencySummary[]): string {
    const lines: string[] = [];

    for (const s of summaries) {
      lines.push(`**${s.category}**: ${s.items.join(', ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Render the summary as a structured plain-text block for AI prompts.
   *
   * @param summaries - Output of `summarise()`.
   */
  public static toPromptBlock(summaries: DependencySummary[]): string {
    const lines: string[] = ['## Dependency Categories'];

    for (const s of summaries) {
      lines.push(`- ${s.category}: ${s.items.join(', ')}`);
    }

    return lines.join('\n');
  }
}
