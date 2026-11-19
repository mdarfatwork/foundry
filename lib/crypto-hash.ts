/**
 * Deterministic content hashing and comparison utilities for Foundry.
 * Runs synchronously in browser, WebContainers, Node.js, and edge environments.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.2 and Prompt §4, §10.
 */

/**
 * 64-bit FNV-1a deterministic hash.
 * Produces a 16-character hexadecimal string.
 * Fast, synchronous, collision-resistant for file and dependency comparison.
 */
export function computeDeterministicHash(content: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;

  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  const part1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const part2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return `${part1}${part2}`;
}

export type FileRecordEntry = Readonly<{
  path: string;
  content: string;
}>;

/**
 * Computes a deterministic hash fingerprint representing an entire file tree.
 * Sorts file paths alphabetically to ensure order-independent reproducibility.
 */
export function computeFileTreeHash(files: readonly FileRecordEntry[]): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const treeManifest = sorted
    .map((f) => `${f.path}:${computeDeterministicHash(f.content)}`)
    .join("\n");
  return computeDeterministicHash(treeManifest);
}

/**
 * Diffs two file trees using deterministic content hashes.
 * Accurately detects:
 * - Added files
 * - Removed files (for cleanup from WebContainer virtual filesystem)
 * - Changed files (including same-length edits)
 * - Unchanged files (to skip unnecessary writes)
 */
export function diffFileTrees(
  oldFiles: readonly FileRecordEntry[],
  newFiles: readonly FileRecordEntry[],
): {
  readonly added: readonly FileRecordEntry[];
  readonly removed: readonly FileRecordEntry[];
  readonly changed: readonly FileRecordEntry[];
  readonly unchanged: readonly FileRecordEntry[];
} {
  const oldMap = new Map<string, string>();
  for (const f of oldFiles) {
    oldMap.set(f.path, computeDeterministicHash(f.content));
  }

  const newMap = new Map<string, string>();
  for (const f of newFiles) {
    newMap.set(f.path, computeDeterministicHash(f.content));
  }

  const added: FileRecordEntry[] = [];
  const changed: FileRecordEntry[] = [];
  const unchanged: FileRecordEntry[] = [];

  for (const f of newFiles) {
    const newHash = newMap.get(f.path)!;
    const oldHash = oldMap.get(f.path);

    if (oldHash === undefined) {
      added.push(f);
    } else if (oldHash !== newHash) {
      changed.push(f);
    } else {
      unchanged.push(f);
    }
  }

  const removed: FileRecordEntry[] = [];
  for (const f of oldFiles) {
    if (!newMap.has(f.path)) {
      removed.push(f);
    }
  }

  return { added, removed, changed, unchanged };
}

/**
 * Extracts a normalized, deterministic hash of ONLY the package dependencies.
 * Ignores scripts, metadata, devServer flags, name, or formatting changes
 * to prevent unnecessary dependency reinstallation loops.
 */
export function extractDependencyHash(packageJsonContent: string): string {
  try {
    const parsed = JSON.parse(packageJsonContent);
    const deps = parsed.dependencies || {};
    const devDeps = parsed.devDependencies || {};

    const sortedDeps = Object.keys(deps)
      .sort()
      .map((k) => `${k}@${deps[k]}`)
      .join(";");

    const sortedDevDeps = Object.keys(devDeps)
      .sort()
      .map((k) => `${k}@${devDeps[k]}`)
      .join(";");

    return computeDeterministicHash(
      `deps:${sortedDeps}|devDeps:${sortedDevDeps}`,
    );
  } catch {
    return computeDeterministicHash(packageJsonContent);
  }
}
