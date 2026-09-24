// Root scripts listed in CLAUDE.md whose package does not exist yet point here, so running one
// says which backlog task adds it instead of silently doing nothing.
const [script, task] = process.argv.slice(2)
console.error(
  `pnpm ${script} is not available yet: backlog task ${task} adds it (docs/backlog.md).`,
)
process.exit(1)
