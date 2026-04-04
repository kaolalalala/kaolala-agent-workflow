# Skill Script Contract

Skill scripts are the **execution layer** of Skill Assets. A Skill Asset is the
"description card" the LLM reads; its linked Script is what actually runs.

## Responsibilities

| Allowed | Forbidden |
|---------|-----------|
| Read input from `AGENT_INPUT` env | Make autonomous decisions ("should I download more?") |
| Write output files to `AGENT_OUTPUT_DIR` | Spawn child processes that perform network I/O |
| Call a single **tool script** via `spawnSync` (one level deep) | Call another skill script |
| Perform local file operations (read/write/stat) | Retry loops with business logic |
| Produce structured JSON on stdout | Conditional branching that changes the scope of work |
| Report `missingCount` / `failedCount` as data | Act on those counts by fetching more data |

## The key rule

> **A skill script executes exactly what it was asked to do and reports the
> result — including gaps. It never decides to do extra work.**

If a skill finds that inputs are incomplete (e.g. `mergedCount < requiredCount`),
it MUST surface that as output fields (`missingCount`, `allPassed: false`) and
return. The **Supervisor** decides whether to replan a follow-up todo.

## Allowed dependency graph

```
Skill Script
  └── (optional) one Tool Script via spawnSync   ← single hop, no network decisions
        └── network / filesystem                  ← tool owns all I/O
```

A skill script must NEVER call another skill script or spawn a second-level tool.

## Output contract

Every skill script must write to stdout a single JSON object with at least:

```json
{
  "ok": true | false,
  "skill": "<skill_id>",
  ... domain fields ...
}
```

On failure, throw an `Error` — do not write `{ "ok": false }` and exit 0.
