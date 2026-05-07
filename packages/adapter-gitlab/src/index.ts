import { StorageAdapter, FileResult, FileEntry, BatchOp, RateLimitInfo } from 'gbase';

export interface GitLabAdapterConfig {
  token: string;
  projectId: string;
  branch?: string;     // default: 'main'
}

export class GitLabAdapter implements StorageAdapter {
  constructor(config: GitLabAdapterConfig) {}

  private notImplemented(): never {
    throw new Error('GitLab adapter not yet implemented — coming in v1');
  }

  async readFile(path: string, branch: string): Promise<FileResult | null> {
    this.notImplemented();
  }

  async writeFile(path: string, content: string, commitMessage: string, sha?: string): Promise<void> {
    this.notImplemented();
  }

  async deleteFile(path: string, sha: string, commitMessage: string): Promise<void> {
    this.notImplemented();
  }

  async listFiles(dir: string, branch: string): Promise<FileEntry[]> {
    this.notImplemented();
  }

  async batchWrite(ops: BatchOp[], commitMessage: string, branch: string): Promise<void> {
    this.notImplemented();
  }

  async ensureRepo(): Promise<void> {
    this.notImplemented();
  }

  async rateLimit(): Promise<RateLimitInfo> {
    this.notImplemented();
  }
}
