import type { FileSystemTree, DirectoryNode } from "@webcontainer/api";
import type { FileEntry } from "./types";

/**
 * Builds a WebContainer FileSystemTree from a flat array of project files.
 * Handles nested directories, POSIX path normalization, and leaf file nodes.
 * Adheres strictly to AGENTS.md §5.1, §5.2, and Prompt §3.
 */
export function buildFileSystemTree(
  files: readonly FileEntry[],
): FileSystemTree {
  const tree: FileSystemTree = {};

  for (const file of files) {
    if (!file.path || typeof file.path !== "string" || !file.path.trim())
      continue;

    // Normalize slashes and strip leading/trailing slashes
    const cleanPath = file.path
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "");
    if (!cleanPath) continue;

    const segments = cleanPath.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let currentDir: FileSystemTree = tree;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLeaf = i === segments.length - 1;

      if (isLeaf) {
        currentDir[segment] = {
          file: {
            contents: file.content,
          },
        };
      } else {
        if (!currentDir[segment]) {
          currentDir[segment] = {
            directory: {},
          };
        }

        const node = currentDir[segment];
        if ("directory" in node) {
          currentDir = node.directory;
        } else {
          // If a file already exists with this directory name, convert to directory
          const newDir: DirectoryNode = { directory: {} };
          currentDir[segment] = newDir;
          currentDir = newDir.directory;
        }
      }
    }
  }

  return tree;
}
