export { FileScanner, FileInfo, ScanOptions } from './scanner.js';
export { TechMapper, ProjectType, LanguageInfo, TechReport } from './tech-mapper.js';
export { DataHarvester, Dependency, DependencyType, ConfigFileType, ConfigFileData, HarvestResult } from './data-harvester.js';
export { MetadataExtractor, ProjectMetadata, AuthorInfo, LicenseInfo, RepositoryInfo } from './metadata-extractor.js';
export { DependencyMapper, DependencyCategory, CategorisedDependency, DependencyMapResult, DependencySummary } from './dependency-mapper.js';
export { ContextBuilder, FileScore, TruncationStrategy, ContextBuilderOptions, ScoringWeights, FileWithContext, ContextBuildResult } from './context-builder.js';
export { CommandContextBuilder, CommandType, DetectedCommand, EntryPoint, ScriptFile, BuildConfig, CommandContextResult, CommandContextOptions } from './command-context-builder.js';
export { CodebaseMapper, CodeElementType, CodeElement, CodeSnippet, FileRelationship, RelationshipType, APIEndpoint, Feature, CodebaseMap, CodebaseMapResult, CodebaseMapOptions, Visibility } from './codebase-mapper.js';
export { CommandInference, ValidatedCommand, CommandSource, CommandValidationResult, InferenceResult } from './command-inference.js';
export { DataPipelineOptimizer, SerializableLanguage, SerializableDependency, SerializableCommand, OptimizedProjectData, OptimizationOptions } from './data-pipeline-optimizer.js';

// ── AI Engine (Day 3) ──
export { AIEngine } from './ai-engine.js';
export { AIProvider, AIEngineConfig, ProviderConfig, AIRequest, AIResponse, ChatMessage, RetryConfig, DEFAULT_RETRY, AIError } from './ai-types.js';
export { resolveApiKey, resolveAllApiKeys, getProviderEnvVar } from './api-keys.js';

// ── Response Parser (Day 3 — Agent 4) ──
export { ResponseParser, ExtractedCommand, CommandCategory, ParsedSection, ValidationIssue, ParseResult, ParseStats } from './response-parser.js';

// ── Feature & API Extraction (Day 5 — Agent 4) ──
export { FeatureExtractor, FeatureValidator, ExtractedFeature, FeatureScope, FeatureCategory, FeatureEvidence, EvidenceType, FeatureStatus, ValidatedFeature, FeatureExtractionResult, FeatureExtractionStats } from './feature-extractor.js';
export { APIExtractor, APIValidator, ExtractedAPIEndpoint, HTTPMethod, APIEndpointStatus, APIEvidence, APIEvidenceType, APIStructuralIssue, ValidatedAPIEndpoint, APIExtractionResult, APIStyleSummary, APIExtractionStats } from './api-extractor.js';

// ── Data Sanitization (Day 6 — Agent 4) ──
export { DataSanitizer, SanitizedFeature, SanitizedEndpoint, SanitizedCommand, SanitizedDependencyGroup, SanitizedData, SanitizedStats } from './data-sanitizer.js';
