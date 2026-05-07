import { StorageAdapter, FileResult, FileEntry, BatchOp, RateLimitInfo } from 'gbase';

export interface BitbucketAdapterConfig {
  workspace: string;
  repoSlug: string;
  token: string;
}

export class BitbucketAdapter implements StorageAdapter {
  constructor(config: BitbucketAdapterConfig) {}

  private notImplemented(): never {
    throw new Error('Bitbucket adapter not yet implemented — coming in v1');
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
