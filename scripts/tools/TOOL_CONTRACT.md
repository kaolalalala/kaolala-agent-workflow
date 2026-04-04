# Tool Script Contract

Tool scripts are **atomic I/O primitives**. They are called by skill scripts
(or directly by the platform) to perform a single, bounded operation.

## Responsibilities

| Allowed | Forbidden |
|---------|-----------|
| Network requests (fetch, HTTP) | Spawning child processes |
| Local filesystem read/write | Calling skill scripts |
| Parsing and transforming data | Making business decisions |
| Retrying transient errors (e.g. HTTP 429) | Deciding to fetch "more" based on count |
| Returning structured JSON on stdout | Conditionally expanding scope |

## The key rule

> **A tool script does exactly one thing. Its inputs fully determine its
> outputs. It has no awareness of the broader plan.**

Examples of correct scope:
- "Download N papers starting at index I for query Q" — inputs fully specify work
- "Search arxiv for query Q, return up to N results" — bounded by caller

Examples of forbidden scope:
- "Download papers until we have enough" — unbounded, caller decides "enough"
- "If download fails, try a different query" — business decision belongs to supervisor

## Output contract

Write a single JSON object to stdout:

```json
{
  "ok": true,
  ... result fields ...
}
```

On failure, throw an `Error` or exit with non-zero status. Never swallow errors
and return `{ "ok": false }` silently — the caller needs a thrown error to
trigger recovery.
