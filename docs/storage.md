# Cache and data retention

**English** | [简体中文](storage.zh-CN.md)

Where the app keeps its data, and how long it keeps it.

---

## The cache

First start scans every transcript under `~/.claude/projects/`, builds
`data/cache.db`, then watches those files. New activity appears within a couple
of seconds, no restart. A large history takes a few seconds; the page is usable
after the first pass.

With no data at all the app still loads, and tells you where it expected to find it.

## Rebuilding

The database is a cache — the JSONL transcripts are the only source of truth.
Delete `data/cache.db` and restart to force a clean re-parse. The app does this
itself whenever an update changes the schema version.

## Data retention

The cache keeps a rolling window — **30 days by default**, 1–365 in **Settings →
Data retention** (`data/retention.json`). Older records are deleted at startup
and hourly.

The window bounds everything: chart ranges, recorded counts, MCP tool ranges.
Narrowing deletes the excess at once; widening re-scans transcripts to restore
what they still hold.

Tables, schema versioning and the exact sweep order:
[data-model.md](data-model.md#database).
