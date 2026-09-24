# services

One package per module, named `@nabvy/<module>`, each with the shape in `CLAUDE.md`: `README.md`,
`src/index.ts`, `src/handlers/`, `src/domain/`, `src/repo/`, `test/`. Modules are atomic
(`docs/decisions.md`, "Atomic modules").

Create one with `pnpm new:module <name>` (kebab case). It writes only files that module owns:

- `services/<name>/`: the package, a README with the required sections, and a sample fixture test;
- `packages/contracts/src/modules/<name>.ts`: its contracts and event registry
  (`packages/contracts/README.md`);
- `packages/db/src/schema/<name>.ts`: its tables in the Postgres schema `<name>` in snake case;
- `packages/db/migrations/<name>/`: `module.json` and `drizzle.config.ts`, its migrations home
  (`packages/db/README.md`).

Then run `pnpm install`, define tables, and run `pnpm db:generate <name>`. A module session edits
only those four places, plus its contract samples in `fixtures/contracts/<name>/` and the
shared `pnpm-lock.yaml`, where `pnpm install` adds the new package. `docs/progress.md` belongs to
the coordinator.

The lockfile is the one shared file, so parallel module pull requests conflict there. To
resolve it, merge `main`, take `main`'s `pnpm-lock.yaml` (`git checkout origin/main --
pnpm-lock.yaml`), and run `pnpm install` to add this module's entry again. Never edit the
lockfile by hand.
