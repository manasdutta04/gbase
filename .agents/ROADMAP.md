# ROADMAP

## v0 (Complete)
- GitHub adapter fully working
- GitLab adapter stub
- Bitbucket adapter stub
- Core engine:
  - Collections CRUD
  - Key-Value store
  - File storage
  - Index-based querying (`_index.json`)
  - Zod schema validation
  - Data encryption at rest
  - Lifecycle hooks
  - Batch operations

## v1 (Complete)
- GitLab adapter fully working
- Bitbucket adapter fully working
- Command Line Interface (CLI)
- Multi-document transactions
- Studio UI for visual database management

## v2 (Planned)
- Studio: authentication / password protection
- Studio: dark mode
- Relations: ref() type for cross-collection references with lazy loading
- CLI: gbase migrate --from github --to gitlab
- CLI: gbase import <file> <collection>
- Pub/sub: GitHub Actions webhook trigger on writes
- OpenAPI spec generation from collection schemas
- TypeScript codegen from existing repo data
