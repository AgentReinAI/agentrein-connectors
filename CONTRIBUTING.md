# Contributing

## Overview

A connector describes how AgentRein rolls back actions performed against a third-party service. Each connector maps API actions to rollback strategies, declares whether AgentRein should capture before-state, and assigns a safety level for operational risk.

The rollback registry uses these connector definitions to find the correct rollback handler for a recorded AI agent action. When rollback runs, AgentRein provides the original action, any captured snapshot, and an authenticated SDK client through `context.client`.

## Quick Start

1. Copy `examples/custom-connector.example.ts`.
2. Rename the connector, action interfaces, and `apiName` values for your service.
3. Define action, response, payload, and snapshot types for the service APIs you support.
4. Implement rollback with the official SDK and the provided `context.client`.
5. Submit a PR with the connector, docs updates, and checklist completed.

## Connector Rules

- Use `context.client`. Never build credentials, tokens, OAuth clients, or API keys inside a connector.
- Always throw on missing `beforeState`. Never silently return when rollback depends on captured state.
- Always guard `id` values before API calls.
- Treat `404` as a silent return. Rollbacks should be idempotent when the target resource is already gone.
- Use this error format:

```ts
`[connectorName] rollback failed | action: ${id} | org: ${orgId} | op: ${op} | reason: ...`
```

- Use the official SDK for your service.

## Safety Levels

| Level  | Meaning | Typical Use |
| ------ | ------- | ----------- |
| LOW    | Rollback is predictable and restores a prior state without broad side effects. | Restoring labels, fields, ranges, or message content from `beforeState`. |
| MEDIUM | Rollback affects visible user work or may create compensating artifacts. | Closing an issue, re-posting a message, or sending a correction email. |
| HIGH   | Rollback is destructive, financially sensitive, incomplete, or should often require human review. | Payments, CRM object deletion, broad file operations, or irreversible operations. |

## PR Checklist

- [ ] Connector uses `context.client` and does not construct credentials.
- [ ] Connector validates required ids before every API call.
- [ ] Connector throws with the standard error format when required state is missing.
- [ ] Connector treats `404` as successful idempotency.
- [ ] Connector uses the official SDK for the service.
- [ ] `captureBeforeState` is set correctly for each action.
- [ ] `safetyLevel` matches the rollback risk.
- [ ] README supported connector table is updated when adding a new connector.
