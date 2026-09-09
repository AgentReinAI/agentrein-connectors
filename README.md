# AgentRein Connectors

> Wrap your AI agents. Undo anything.

[![Build Status](https://img.shields.io/github/actions/workflow/status/agentrein/agentrein-connectors/sync-connectors.yml?branch=main)](https://github.com/agentrein/agentrein-connectors/actions)
[![License](https://img.shields.io/github/license/agentrein/agentrein-connectors)](LICENSE)

## What is this?

AgentRein is an AI Agent Reliability Platform that wraps existing AI frameworks (LangChain, LangGraph, n8n, custom runtimes) with a safety and reversibility layer—enforcing human approval gates, one-click rollback/undo execution, intent drift detection, and unified audit logs across external tools.

This repository (`agentrein-connectors`) is the single **source of truth** for all AgentRein connector implementations. Each connector defines standard action contracts, resource URL resolvers, pre-execution snapshot rules, and inverse compensation handlers across third-party APIs.

All changes merged into this repository are automatically propagated to the main platform backend path (`backend/src/core/registry/connectors/`) via `.github/workflows/sync-connectors.yml`.

## Supported Connectors

| Connector | Actions | Notes |
|---|---|---|
| github | 20 | Pilot connector; established the base template |
| slack | 23 | Largest initial connector prior to Salesforce |
| gmail | 16 | Covers message, draft, thread, and label operations |
| gdrive | 10 | Manages file lifecycle, permissions, and folder mappings |
| gsheets | 8 | Smallest connector—row/column positions lack stable identifiers |
| hubspot | 13 | Covers primary CRM primitives (Contacts, Deals, Companies, Tickets) |
| notion | 9 | Manages pages, database items, and block structures |
| salesforce | 28 | Largest connector to date; supports dynamic SObjects |
| stripe | 10 | Final connector of the initial platform expansion |

For custom integrations not listed above, refer to `examples/custom-connector.example.ts`.

## Known Limitations

The following items are known, flagged technical debt scheduled for dedicated platform updates:

- **Hardcoded Context**: The `notion`, `salesforce`, and `stripe` connectors currently hardcode `const orgId = 'unknown';` instead of dynamically deriving organization context from the execution session.
- **Bypass on Unregistered Actions**: Actions executed with an unregistered or unknown `apiName` currently bypass rollback indexing and approval gating without throwing an error.

Contributors must not patch these underlying framework behaviors as side effects within unrelated connector pull requests.

## Contributing

We welcome contributions for new actions and platform connectors. To maintain reliability guarantees, all contributions must strictly follow our 4-Group action classification system, naming specifications, and verification workflows.

Read [CONTRIBUTING.md](./CONTRIBUTING.md) for full development, typing, and submission guidelines.

## License

See the [LICENSE](./LICENSE) file for licensing details.
