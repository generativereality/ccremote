/**
 * AssetManager: File operations for md-queue
 *
 * Handles reading, writing, and atomic updates to markdown files
 * with YAML frontmatter. Works with both Node.js and Bun.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';
import type { QueueItem, Frontmatter } from './types';

/**
 * Manages markdown file operations with atomic writes for sync safety
 */
export class AssetManager {
  /**
   * Read a queue item from disk
   *
   * @param filePath - Absolute path to markdown file
   * @returns Parsed queue item or null if file doesn't exist
   */
  async read(filePath: string): Promise<QueueItem | null> {
    try {
      // Check if file exists and read content
      const content = await fs.readFile(filePath, 'utf-8');

      // Parse frontmatter and content
      const { frontmatter, content: markdownContent } = this.parseFrontmatter(content);

      return {
        path: filePath,
        frontmatter,
        content: markdownContent,
      };
    } catch (error: any) {
      // File doesn't exist
      if (error.code === 'ENOENT') {
        return null;
      }
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Create a new queue item
   *
   * @param filePath - Absolute path where file should be created
   * @param frontmatter - YAML frontmatter object
   * @param content - Markdown content (optional, defaults to empty string)
   */
  async create(
    filePath: string,
    frontmatter: Frontmatter,
    content: string = ''
  ): Promise<void> {
    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write file atomically
    await this.atomicWrite(filePath, frontmatter, content);
  }

  /**
   * Update frontmatter fields (partial update)
   *
   * @param filePath - Absolute path to markdown file
   * @param updates - Partial frontmatter updates (deep merge)
   */
  async updateFrontmatter(
    filePath: string,
    updates: Partial<Frontmatter>
  ): Promise<void> {
    // Read existing item
    const item = await this.read(filePath);
    if (!item) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Deep merge updates into frontmatter
    const updatedFrontmatter = this.deepMerge(item.frontmatter, updates);

    // Write updated item atomically
    await this.atomicWrite(filePath, updatedFrontmatter, item.content);
  }

  /**
   * Atomic write using .tmp file and rename
   *
   * Ensures sync safety: the file is either old or new, never corrupt.
   *
   * @param filePath - Target file path
   * @param frontmatter - YAML frontmatter object
   * @param content - Markdown content
   */
  async atomicWrite(
    filePath: string,
    frontmatter: Frontmatter,
    content: string
  ): Promise<void> {
    // Serialize frontmatter to YAML
    const yamlContent = this.serializeFrontmatter(frontmatter);

    // Construct full file content
    const fullContent = `---\n${yamlContent}---\n\n${content}`;

    // Write to temporary file
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, fullContent, 'utf-8');

    // Atomic rename (replaces target file atomically)
    await fs.rename(tmpPath, filePath);
  }

  /**
   * Delete a queue item
   *
   * @param filePath - Absolute path to markdown file
   */
  async delete(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error: any) {
      // Ignore if file doesn't exist
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Move/rename a queue item
   *
   * @param sourcePath - Current file path
   * @param targetPath - New file path
   */
  async move(sourcePath: string, targetPath: string): Promise<void> {
    // Ensure target parent directory exists
    const targetDir = path.dirname(targetPath);
    await fs.mkdir(targetDir, { recursive: true });

    // Rename/move file (atomic operation)
    await fs.rename(sourcePath, targetPath);
  }

  /**
   * Check if a file exists
   *
   * @param filePath - File path to check
   * @returns True if file exists
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Parse frontmatter from raw markdown content
   *
   * @param content - Raw markdown file content
   * @returns Parsed frontmatter and content
   */
  protected parseFrontmatter(content: string): {
    frontmatter: Frontmatter;
    content: string;
  } {
    // Check for frontmatter delimiter at start
    if (!content.startsWith('---\n')) {
      throw new Error('Invalid markdown: missing frontmatter delimiter');
    }

    // Find the end of frontmatter (second ---)
    const endDelimiterIndex = content.indexOf('\n---\n', 4);
    if (endDelimiterIndex === -1) {
      throw new Error('Invalid markdown: missing frontmatter end delimiter');
    }

    // Extract YAML content
    const yamlContent = content.substring(4, endDelimiterIndex);

    // Parse YAML
    const frontmatter = parseYAML(yamlContent) as Frontmatter;

    // Extract remaining content (skip the --- and following newlines)
    const markdownContent = content.substring(endDelimiterIndex + 5).trimStart();

    return {
      frontmatter,
      content: markdownContent,
    };
  }

  /**
   * Serialize frontmatter to YAML
   *
   * @param frontmatter - Frontmatter object
   * @returns YAML string
   */
  protected serializeFrontmatter(frontmatter: Frontmatter): string {
    // Serialize to YAML
    const yamlString = stringifyYAML(frontmatter, {
      lineWidth: 0, // Disable line wrapping
      defaultStringType: 'QUOTE_DOUBLE', // Use double quotes for strings
      defaultKeyType: 'PLAIN', // Plain keys (no quotes)
    });

    return yamlString;
  }

  /**
   * Deep merge objects (for partial frontmatter updates)
   *
   * @param target - Target object
   * @param source - Source object with updates
   * @returns Merged object
   */
  protected deepMerge<T>(target: T, source: Partial<T>): T {
    // Create a copy of target
    const result: any = Array.isArray(target) ? [...target] : { ...target };

    // Merge source into result
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = source[key];
        const targetValue = (target as any)[key];

        if (sourceValue === undefined) {
          continue;
        }

        // If both are objects (and not arrays), merge recursively
        if (
          typeof sourceValue === 'object' &&
          sourceValue !== null &&
          !Array.isArray(sourceValue) &&
          typeof targetValue === 'object' &&
          targetValue !== null &&
          !Array.isArray(targetValue)
        ) {
          result[key] = this.deepMerge(targetValue, sourceValue);
        } else {
          // Otherwise, replace value (arrays are replaced, not merged)
          result[key] = sourceValue;
        }
      }
    }

    return result;
  }
}
