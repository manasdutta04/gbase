# ADAPTERS

To implement a new adapter for `gbase`, follow these rules:

1. Implement the `StorageAdapter` interface from `gbase`.
2. Handle rate limit errors from the provider's API by throwing `RateLimitError`.
3. Handle SHA conflicts (e.g., concurrent updates) by throwing `ConflictError`.
4. `batchWrite` must execute all write/delete operations in a single API call (one commit), typically using Git Trees API or similar mechanisms.

## Stub Template

```typescript
import { StorageAdapter, FileResult, FileEntry, BatchOp, RateLimitInfo } from 'gbase';

export class MyGitAdapter implements StorageAdapter {
  async readFile(path: string, branch: string): Promise<FileResult | null> {
    throw new Error('Not implemented');
  }
  async writeFile(path: string, content: string, commitMessage: string, sha?: string): Promise<void> {
    throw new Error('Not implemented');
  }
  async deleteFile(path: string, sha: string, commitMessage: string): Promise<void> {
    throw new Error('Not implemented');
  }
  async listFiles(dir: string, branch: string): Promise<FileEntry[]> {
    throw new Error('Not implemented');
  }
  async batchWrite(ops: BatchOp[], commitMessage: string, branch: string): Promise<void> {
    throw new Error('Not implemented');
  }
  async ensureRepo(): Promise<void> {
    throw new Error('Not implemented');
  }
  async rateLimit(): Promise<RateLimitInfo> {
    throw new Error('Not implemented');
  }
}
```
