# Contributing

## Overview

A connector describes how AgentRein rolls back actions performed against a third-party service. Each connector maps API actions to rollback strategies, declares whether AgentRein should capture before-state, and assigns a safety level for operational risk.

The rollback registry uses these connector definitions to find the correct rollback handler for a recorded AI agent action. When rollback runs, AgentRein provides the original action, any captured snapshot, and an authenticated SDK client through `context.client`.

---

## Quick Start

1. Install required types:
   ```bash
   npm install @agentrein/types
   ```
2. Copy `examples/custom-connector.example.ts`.
3. Rename the connector, action interfaces, and `apiName` values for your service.
4. Define action, response, payload, and snapshot types for the service APIs you support.
5. Implement rollback using the official SDK and the provided `context.client`.
6. Submit a PR with the connector code, updated docs, and completed PR checklist.

---

## Connector Rules

- **Use `context.client` Only:** Never construct credentials, tokens, OAuth clients, or API keys inside a connector.
- **Throw on Missing `beforeState`:** Never silently return when rollback depends on captured prior state.
- **Guard Entity IDs:** Always validate `id` parameters before calling external APIs.
- **Idempotency via Silent Return on 404:** Treat `404 Not Found` as a successful rollback if the target resource is already deleted or missing.
- **Use Standard Error Format:** Format all thrown errors as follows (where `op` is the `operationType`):
  ```ts
  `[connectorName] rollback failed | action: ${id} | org: ${orgId} \vert{} op:${op} | reason: ...`
  ```
- **Use Official SDKs:** Always rely on the official NPM SDK package for the service.

---

## Safety Levels

| Level | Meaning | Typical Use |
| :--- | :--- | :--- |
| **LOW** | Rollback is predictable and restores a prior state without broad side effects. | Restoring labels, fields, ranges, or message content from `beforeState`. |
| **MEDIUM** | Rollback affects visible user work or may create compensating artifacts. | Closing an issue, re-posting a message, or sending a correction email. |
| **HIGH** | Rollback is destructive, financially sensitive, incomplete, or requires human review. | Payments, CRM object deletion, broad file operations, or irreversible operations. |

---

## PR Checklist

- [ ] Connector uses `context.client` and does not construct credentials.
- [ ] Connector validates required `id` values before every API call.
- [ ] Connector throws with the standard error format when required state is missing.
- [ ] Connector treats `404` as successful idempotency.
- [ ] Connector uses the official SDK for the service.
- [ ] `captureBeforeState` is set correctly for each action.
- [ ] `safetyLevel` matches the rollback risk.
- [ ] README supported connector table is updated when adding a new connector.
