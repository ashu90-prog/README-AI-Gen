import path from 'path';
import { FileInfo } from '../core/index.js';

/**
 * Node structure for the internal tree representation.
 */
interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
}

/**
 * Options for the TreeGenerator.
 */
export interface TreeOptions {
  /**
   * Maximum depth of the tree to display.
   */
  maxDepth?: number;
  /**
   * List of folder names or patterns to ignore during tree generation.
   */
  ignoreFolders?: string[];
}

/**
 * TreeGenerator utility to create ASCII directory trees.
 */
export class TreeGenerator {
  /**
   * Generates an ASCII directory tree string from a list of FileInfo objects.
   * 
   * @param files List of files from the FileScanner.
   * @param rootPath The root directory path used for relative path calculations.
   * @param options Optional configuration for tree generation.
   * @returns A string representing the ASCII tree.
   */
  public static generate(
    files: FileInfo[],
    rootPath: string,
    options: TreeOptions = {}
  ): string {
    const root: TreeNode = {
      name: path.basename(path.resolve(rootPath)) || '.',
      children: new Map(),
      isFile: false,
    };

    // Build the tree structure from the flat list of files
    for (const file of files) {
      const relativePath = path.relative(rootPath, file.path);
      const parts = relativePath.split(path.sep);
      let current = root;

      // Skip files that are not within the rootPath if any
      if (relativePath.startsWith('..')) continue;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part || part === '.') continue;

        // Check if we should ignore this folder
        if (options.ignoreFolders?.includes(part)) {
          break;
        }

        // Check if we've reached the max depth
        if (options.maxDepth !== undefined && i >= options.maxDepth) {
          break;
        }

        if (!current.children.has(part)) {
          current.children.set(part, {
            name: part,
            children: new Map(),
            isFile: i === parts.length - 1,
          });
        }
        current = current.children.get(part)!;
      }
    }

    return this.render(root);
  }

  /**
   * Recursively renders the tree node into an ASCII string.
   */
  private static render(
    node: TreeNode,
    prefix: string = '',
    isLast: boolean = true,
    isRoot: boolean = true
  ): string {
    let result = '';

    if (isRoot) {
      result += `${node.name}\n`;
    } else {
      result += `${prefix}${isLast ? '└── ' : '├── '}${node.name}${!node.isFile ? '/' : ''}\n`;
    }

    const children = Array.from(node.children.values()).sort((a, b) => {
      // Directories first, then files, then alphabetically
      if (a.isFile !== b.isFile) {
        return a.isFile ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });

    const newPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const isLastChild = i === children.length - 1;
      result += this.render(child, newPrefix, isLastChild, false);
    }

    return result;
  }
}
