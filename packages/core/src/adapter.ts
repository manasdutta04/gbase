export interface FileResult {
  content: string;
  sha: string;
  encoding: 'base64' | 'utf-8';
}

export interface FileEntry {
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir';
}

export interface BatchOp {
  op: 'write' | 'delete';
  path: string;
  content?: string;
  sha?: string;
}

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  used: number;
  resetsAt: string;
}

export interface StorageAdapter {
  readFile(path: string, branch: string): Promise<FileResult | null>;
  writeFile(path: string, content: string, commitMessage: string, sha?: string): Promise<void>;
  deleteFile(path: string, sha: string, commitMessage: string): Promise<void>;
  listFiles(dir: string, branch: string): Promise<FileEntry[]>;
  batchWrite(ops: BatchOp[], commitMessage: string, branch: string): Promise<void>;
  ensureRepo(): Promise<void>;
  rateLimit(): Promise<RateLimitInfo>;
}
