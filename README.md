# Authorization Assurance Lab

Developer security platform for Devin Hacks Kochi — Track 2: *Make the Invisible Visible*.

The long-term goal: generate authorization tests from declared permission rules, run them against applications through
backend adapters, inject controlled security mutations in isolated test environments, and measure whether the tests
catch authorization regressions.

**Milestone 1 (this code)** covers only the foundation: a permission specification format, validation, deterministic
expected-scenario generation, and a dashboard to view them. Nothing is executed against an application, and generated
scenarios are **not** security findings.

## Getting started

Requires Node.js 22+ and npm.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # Vitest unit tests
npm run typecheck  # tsc --noEmit (strict mode)
npm run lint       # ESLint, zero warnings
npm run build      # production build
npm run check      # all of the above
```

## Layout

| Path | Purpose |
| --- | --- |
| `src/core/rules/` | Specification schema (`schema.ts`), validation (`validation.ts`), rule matching (`evaluation.ts`), bundled example |
| `src/core/generation/` | Deterministic scenario generator |
| `src/core/models/` | Typed scenario model plus execution/mutation result contracts for future adapters |
| `app/` | Next.js App Router dashboard |
| `tests/` | Vitest unit tests |

`src/core` has no React, Next.js, or backend SDK imports. ESLint (`no-restricted-imports`) and a unit test enforce this.

## Permission specification (version 1)

```json
{
  "version": 1,
  "name": "Team notes workspace",
  "defaultOutcome": "deny",
  "roles": ["member", "admin"],
  "identities": [{ "id": "alice", "roles": ["member"] }],
  "resourceTypes": [{ "id": "note", "actions": ["read", "update", "delete"] }],
  "resources": [{ "id": "note-a", "type": "note", "ownerId": "alice" }],
  "rules": [
    {
      "id": "members-own-notes",
      "effect": "allow",
      "subject": { "kind": "role", "role": "member" },
      "resource": { "kind": "type", "type": "note" },
      "actions": ["read", "update", "delete"],
      "ownership": "owner"
    }
  ]
}
```

- `subject`: `{ "kind": "any" }`, `{ "kind": "identity", "identityId": "..." }`, or `{ "kind": "role", "role": "..." }`.
- `resource`: `{ "kind": "type", "type": "..." }` or `{ "kind": "instance", "resourceId": "..." }`.
- `ownership`: `any`, `owner` (the identity owns the resource), or `non-owner` (the resource has an owner who is someone else).

The generator produces one scenario per declared identity × resource × action of that resource's type, sorted by
identity, resource, then action. Each scenario records the expected outcome, whether it came from an explicit rule or the
default, and which rules matched. Scenario IDs look like `case:<identity>:<resource>:<action>`.

### Validation

Rejected specifications return structured issues (`syntax`, `schema`, `duplicate`, `reference`, `contradiction`, `limit`)
with a JSON path. Checks: strict schema (unknown keys rejected), unique identifiers, every role/identity/type/resource/action
reference declared, actions valid for the targeted resource type, and at most 10,000 generated scenarios.

### Semantics and documented ambiguities

The validator rejects ambiguous inputs instead of guessing:

- **Default deny only.** `defaultOutcome` must be `"deny"`. Anything not explicitly allowed is expected to be denied.
- **No precedence between allow and deny.** If allow and deny rules both match the same identity/resource/action, the
  specification is rejected as contradictory. There is no "deny overrides" or "most specific wins" rule. Overlapping
  rules with the *same* effect are fine, and all of them are listed in `matchedRuleIds`.
- **Unowned resources.** A resource without `ownerId` matches neither `owner` nor `non-owner` rules, only `any`.
- **Closed world.** Contradictions are checked only across *declared* identities and resources. A rule that matches no
  declared case is accepted with an `unmatched-rule` warning, because it may conflict with entities added later.
- **Multiple roles** are combined: an identity matches every rule that targets any of its roles.

## End-to-end mutation workflow (PostgreSQL RLS)

One command starts a disposable PostgreSQL 16 container, creates the demo schema, runs the generated authorization tests,
applies a controlled mutation, checks whether the tests catch it, verifies restoration, and removes the container:

```bash
. ~/.nvm/nvm.sh
npm run lab            # exit code 0 = all mutations caught, 2 = a mutation survived, 1 = error/inconclusive
```

Options: `--keep-db` (leave the container running), `--reuse-db` (use a container started with `npm run db:start`),
`--report <path>` (default `reports/assurance-report.json`), `--example <dir>` (default `examples/postgres-notes`).
Separate steps: `npm run db:start`, `npm run db:init`, `npm run db:stop`. Requires Docker. Set `AAL_PG_PORT` to change
the host port (default 55432).

**Inputs** (`examples/postgres-notes/`): `spec.json` (permission specification, including declared `expectations`, which
must agree with the rules), `mutations.json`, `target.json` (adapter mapping from resource types and actions to tables and
SQL operations), and `schema.sql` (the system under test: a `notes` table with ownership-based RLS policies).

**Isolation and safety**
- The container uses `postgres:16-alpine`, binds to `127.0.0.1` only, and keeps its data in `tmpfs`. The adapter refuses
  non-local hosts. Only containers labelled by the lab are ever removed.
- The table is owned by `aal_owner` with `FORCE ROW LEVEL SECURITY`. Tests run as `aal_app` (no superuser, no
  `BYPASSRLS`, not the owner) via `SET LOCAL ROLE`; each run checks this before executing.
- Every scenario runs inside a savepoint of a transaction that is always rolled back, so probe writes are never kept.
- The mutation (`ALTER POLICY … USING (true)`) and the mutated-policy tests run in a single transaction on one connection
  and are rolled back whether the tests pass, fail or throw. Server-side `statement_timeout`, `lock_timeout` and
  `idle_in_transaction_session_timeout` mean a crashed or hung client cannot keep the change open; PostgreSQL aborts
  uncommitted DDL when the connection drops. Afterwards a fresh connection compares tables, policies, grants and the
  identity helper with the pre-mutation snapshot, and the full baseline is re-run.

**Test identity (test adapter only).** The adapter sets the identity with `set_config('app.current_user_id', <id>, true)`
and policies read it through `app.current_user_id()`. This simulates an authenticated user for testing; it is not an
authentication integration and does not model how a real application establishes identity.

**How outcomes are observed**
- Read: the superuser first confirms the row exists, then the app role runs `SELECT`. Zero rows means denied (RLS filters
  rows silently rather than raising an error); one row means allowed.
- Update: the app role runs `UPDATE`; the adapter records rows affected, then checks as the superuser whether the data
  actually changed. A disagreement between the two, or any unexpected SQL error, is reported as an error, not a result.

**Mutation status**
- `caught`: the mutation applied cleanly and at least one relevant scenario observed an outcome different from the spec.
- `survived`: every relevant scenario still matched the spec. This is a blind spot in the generated suite, not
  automatically a production vulnerability.
- `inconclusive`: the mutation could not be applied, or any scenario errored. Errors are never counted as detection.
- Mutations only run if the baseline fully passes; the campaign stops with `error` if restoration cannot be verified.

The JSON report (`AssuranceReport` in `src/core/models/results.ts`) contains environment checks, generated scenarios,
baseline results with evidence (rows returned, rows affected, data changed), each mutation's exact SQL with the policy
before and after, expected versus observed outcomes, status and reason, restoration verification, and the re-run baseline.

**Tests:** `npm test` (unit, including a fake adapter for the engine) and `npm run test:integration` (Docker; covers the
caught mutation, an injected failure after the mutation is applied, an inapplicable mutation, a surviving mutation, and a
connection dropped before rollback).

**Architecture:** `src/core/` stays framework-independent (ESLint forbids importing `pg`, `node:*`, adapters, CLI, React,
Next.js or Supabase there). `src/core/mutation/engine.ts` defines the `AuthorizationAdapter` interface and the campaign
logic; `src/adapters/postgres/` is the only implementation; `src/cli/` wires them together.

## Evidence dashboard

```bash
. ~/.nvm/nvm.sh
npm run build && npm run start   # or: npm run dev
```

Open http://localhost:3000. The page reads the real engine report from `reports/assurance-report.json` (via `GET /api/report`,
which validates its structure and never fills in missing values). If no report exists it shows an empty state.

- **Run lab** calls `POST /api/lab`, which starts the fixed command `npm run lab` on the server: no shell, no arguments, and
  nothing from the request body is used, so the browser cannot choose a command or a database target. Only one run can be
  active at a time; a run is stopped after 5 minutes. The request needs the `x-aal-action: run-lab` header and is refused
  for cross-site requests. Set `AAL_DISABLE_LAB_RUNS=1` to turn the button off and use the CLI only. All CLI safeguards
  (local disposable container, rollback, restoration check) still apply because the dashboard only runs the CLI.
- If a run fails before writing a new report, the dashboard says so and keeps showing the earlier report as earlier.
- `declared` badge = `declaredExpectation: true`: the scenario's outcome is pinned in the spec's `expectations` list as well
  as derived from the rules (the validator rejects disagreements). Unmarked scenarios are derived from rules only.
- Statuses come straight from the report: `caught`, `survived` (test-suite blind spot), `inconclusive` (mutation not applied
  or a test errored), and overall `error` (setup, baseline or restoration failed).
- The previous specification editor is at `/spec`.

## Current limitations

- Exactly one backend adapter (PostgreSQL Row Level Security) and one mutation operator (`permissive-condition`).
  Arbitrary backends, frameworks, HTTP APIs and Supabase are not supported yet.
- The PostgreSQL adapter maps resource types to tables and actions to `SELECT`/`UPDATE` via `target.json`; `INSERT` and
  `DELETE` are not mapped yet.
- The dashboard runs on the same machine as Docker and is meant for local use; it has no authentication.
- No attribute- or condition-based rules (time, tenant, field-level), role hierarchies, or wildcard actions.
- The dashboard keeps everything in browser memory. Specifications are not saved, and there is no import or export.
