import fs from 'fs-extra';
import path from 'path';
import ignore, { Ignore } from 'ignore';

export interface FileInfo {
  path: string;
  name: string;
  extension: string;
}

export interface ScanOptions {
  ignorePatterns?: string[];
  includeHidden?: boolean;
  maxDepth?: number;
}

export class FileScanner {
  private ignoreInstance: Ignore;
  private rootPath: string;

  constructor(rootPath: string, options: ScanOptions = {}) {
    this.rootPath = path.resolve(rootPath);
    this.ignoreInstance = ignore();

    // Default ignores that are almost never useful for README generation
    this.ignoreInstance.add([
      'node_modules',
      'dist',
      'build',
      '.git',
      'coverage',
      '.nyc_output',
    ]);

    if (options.ignorePatterns) {
      this.ignoreInstance.add(options.ignorePatterns);
    }

    this.loadGitignore();
  }

  private loadGitignore(): void {
    const gitignorePath = path.join(this.rootPath, '.gitignore');
    
    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
      this.ignoreInstance.add(gitignoreContent);
    }
  }

  private getExtension(filePath: string): string {
    const ext = path.extname(filePath);
    return ext.startsWith('.') ? ext.slice(1) : ext;
  }

  private shouldIgnore(filePath: string, relativePath: string): boolean {
    const isHidden = path.basename(filePath).startsWith('.');
    const isIgnored = this.ignoreInstance.ignores(relativePath);
    
    return isIgnored;
  }

  private async scanDirectory(
    dirPath: string,
    currentDepth: number = 0,
    maxDepth: number = Infinity,
    results: FileInfo[] = []
  ): Promise<FileInfo[]> {
    if (currentDepth > maxDepth) {
      return results;
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(this.rootPath, fullPath);

      if (this.shouldIgnore(fullPath, relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath, currentDepth + 1, maxDepth, results);
      } else if (entry.isFile()) {
        results.push({
          path: fullPath,
          name: entry.name,
          extension: this.getExtension(entry.name)
        });
      }
    }

    return results;
  }

  public async scan(options: ScanOptions = {}): Promise<FileInfo[]> {
    const maxDepth = options.maxDepth ?? Infinity;
    
    if (!fs.existsSync(this.rootPath)) {
      throw new Error(`Directory does not exist: ${this.rootPath}`);
    }

    if (!fs.statSync(this.rootPath).isDirectory()) {
      throw new Error(`Path is not a directory: ${this.rootPath}`);
    }

    return this.scanDirectory(this.rootPath, 0, maxDepth);
  }

  public async scanByExtension(extensions: string[]): Promise<FileInfo[]> {
    const allFiles = await this.scan();
    const normalizedExtensions = extensions.map(ext => ext.toLowerCase().replace('.', ''));
    
    return allFiles.filter(file => 
      normalizedExtensions.includes(file.extension.toLowerCase())
    );
  }

  public async scanByPattern(pattern: RegExp): Promise<FileInfo[]> {
    const allFiles = await this.scan();
    
    return allFiles.filter(file => 
      pattern.test(file.name) || pattern.test(file.path)
    );
  }
}
