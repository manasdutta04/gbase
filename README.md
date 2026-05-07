# gbase

A TypeScript monorepo npm package that turns any Git repository (GitHub, GitLab, or Bitbucket) into a zero-cost, version-controlled lightweight database.

## Quick Start (GitHub)

```typescript
import { GBase } from 'gbase';
import { GitHubAdapter } from '@gbase/github';

const adapter = new GitHubAdapter({
  token: process.env.GITHUB_TOKEN!,
  owner: 'my-org',
  repo: 'my-db-repo',
});

const db = new GBase({ adapter });

async function run() {
  const users = db.collection('users');
  await users.create({ name: 'Alice', role: 'admin' });
  const allUsers = await users.findAll();
  console.log(allUsers);
}
```

## Quick Start (GitLab)

```typescript
// Coming in v1
import { GBase } from 'gbase';
import { GitLabAdapter } from '@gbase/gitlab';

const adapter = new GitLabAdapter({
  token: process.env.GITLAB_TOKEN!,
  projectId: '123456',
});
```

## API Reference

### Collections

`db.collection<T>(name)`

Provides a MongoDB-like API:
- `create(data)`
- `findById(id)`
- `findAll()`
- `find(query)`
- `update(id, changes)`
- `delete(id)`

### Key-Value Store

`db.kv()`

- `get(key)`
- `set(key, value)`
- `delete(key)`

### File Storage

`db.storage()`

- `upload(remotePath, content)`
- `download(remotePath)`
- `delete(remotePath)`

## Configuration

| Option | Type | Description |
| --- | --- | --- |
| `adapter` | `StorageAdapter` | The Git provider adapter |
| `branch` | `string` | The branch to use (default: 'main') |
| `debug` | `boolean` | Enable debug logging |
| `encryption.enabled` | `boolean` | Encrypt data at rest |
| `encryption.key` | `string` | Encryption key |

## Folder Structure in Repo

- `collections/{name}/_index.json`
- `collections/{name}/{id}.json`
- `kv/store.json`
- `storage/{path}`

## Contributing a new adapter

Implement the `StorageAdapter` interface. See `.agents/ADAPTERS.md` for details.
