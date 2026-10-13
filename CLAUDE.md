# Notes for Claude

## Pull requests

- Merge your own PRs as soon as CI is green, without waiting to be asked
  (squash merge, matching the repo's history). The exception is a risky
  change, such as a database migration, a change to infra/ or deploy
  workflows, auth or permissions, or deleting data: open the PR, explain
  the risk, and wait for the owner to say merge.
