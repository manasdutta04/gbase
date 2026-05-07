# ROADMAP

## v0 (Complete)
- GitHub adapter fully working
- Core engine: Collections CRUD, KV, Storage, Encryption, Hooks, Batch ops

## v1 (Complete)
- GitLab and Bitbucket adapters fully working
- Command Line Interface (CLI)
- Multi-document transactions
- Studio UI for visual database management

## v2 (Complete)
- Studio: Dark mode
- Relations: `ref()` type for cross-collection references with lazy loading
- CLI: `gbase migrate` (cross-provider data movement)
- CLI: `gbase import` (CSV/JSON seeding)

## v3 (Current)
- Published to npm — all packages at 1.0.0
- Changeset integration for automated versioning
- GitHub Actions CI/CD for publishing

## v4 (Planned)
- Vitest unit tests for core collection logic
- Vitest integration tests using mock adapters  
- JSDoc comments on all public methods
- gbase.dev landing page / docs site
- GitHub Discussions for community support
- Pub/sub: GitHub Actions webhook trigger on writes
- OpenAPI spec generation from collection schemas
- TypeScript codegen from existing repo data
