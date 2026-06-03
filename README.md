<div align="center">
      
# AgentRein Connectors

> Open-source rollback connectors for AI agent actions.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-3178c6.svg)](https://www.typescriptlang.org/)

</div>

## Install Types

```bash
npm install @agentrein/types
```

> Provides full TypeScript autocomplete when writing your own connector.

## What is AgentRein?

AgentRein is a rollback and safety layer for AI agents that take actions in production tools. It records agent actions, captures before-state where needed, and executes service-specific rollback logic when an action must be undone. Learn more at [agentrein.com](https://agentrein.com).

## Supported Connectors

| Connector     | Actions | Client SDK              | Rollback Strategy                     |
| ------------- | ------- | ----------------------- | ------------------------------------- |
| Slack         | 3       | @slack/web-api          | Tombstone + Restore + Re-post         |
| Gmail         | 4       | googleapis              | Correction email + Untrash + Restore  |
| GitHub        | 2       | @octokit/rest           | Close issue + Restore beforeState     |
| Google Drive  | 4       | googleapis              | Soft delete + Restore + Reverse move  |
| Google Sheets | 4       | googleapis              | Clear range + Restore + Delete sheet  |
| HubSpot       | 4       | @hubspot/api-client     | Archive + Restore (incremental)       |
| Salesforce    | 4       | jsforce                 | Delete + Restore (incremental)        |
| Notion        | 4       | @notionhq/client        | Trash + Restore + Delete blocks       |
| Stripe        | 3       | stripe                  | Delete + Human Gate                   |

## How It Works

```text
AI agent action
      |
      v
AgentRein records action metadata
      |
      v
Connector action matched by apiName
      |
      +--> captureBeforeState=true? snapshot current resource
      |
      v
Rollback requested
      |
      v
Registry executes connector rollback with context.client
      |
      v
Service restored, compensated, or safely gated
```

## Write Your Own Connector

Start with [CONTRIBUTING.md](CONTRIBUTING.md), then copy [examples/custom-connector.example.ts](examples/custom-connector.example.ts) as a template.

## Links

- [Website](https://agentrein.com)
- [Docs](https://agentrein.com/docs)
- [Dashboard](https://agentrein.com/dashboard)
