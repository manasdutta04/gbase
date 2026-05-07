# OVERVIEW

`gbase` is a monorepo npm package that provides a zero-cost, version-controlled lightweight database. It uses a Git repository as the storage backend.

## Architecture

Users install the `gbase` core package along with a single adapter (e.g., `@gbase/github`).
The core engine is completely provider-agnostic. It communicates with the Git repository exclusively through the `StorageAdapter` interface.

Adapters implement the `StorageAdapter` interface for their specific Git provider, handling API calls, rate limits, and Git tree manipulations.

Data is stored as JSON files directly in the user's Git repository:
- Collections: `collections/{name}/_index.json` and `collections/{name}/{id}.json`
- Key-Value: `kv/store.json`
- File Storage: `storage/{path}`

## Dependency Graph

```
gbase (Core)
  ↑
  ├─ @gbase/github (Depends on Core)
  ├─ @gbase/gitlab (Depends on Core)
  └─ @gbase/bitbucket (Depends on Core)
```
