# CONVENTIONS

- TypeScript strict mode must be enabled everywhere.
- All files must use named exports. No default exports are allowed except in `index.ts` barrel files.
- All error classes must extend `GBaseError`.
- All async functions must return typed Promises.
- File paths inside the repository must always use forward slashes (`/`), even on Windows.
- Commit messages must follow the conventional commits format.
