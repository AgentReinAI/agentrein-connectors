import type { ConnectorAction, Connector, RollbackContext } from '../types';
import { Octokit } from '@octokit/rest';

interface GitHubIssueBeforeState {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    labels?: Array<string | { name?: string }>;
    assignees?: Array<string | { login?: string }>;
}

interface GitHubAction {
    id: string;
    operationType: 'CREATE' | 'UPDATE' | 'DELETE';
    payload: {
        owner?: string;
        repo?: string;
        issue_number?: number;
        [key: string]: unknown;
    };
    response?: {
        data?: {
            number?: number;
            [key: string]: unknown;
        };
        number?: number;
        [key: string]: unknown;
    };
    undoConfig?: {
        requireApproval?: boolean;
        safetyLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
        reason?: string;
    };
    snapshot?: {
        beforeState?: GitHubIssueBeforeState | null;
    };
}

function getIssueResponse(action: GitHubAction): NonNullable<GitHubAction['response']> {
    const response = action.response?.data ?? action.response;
    if (!response) {
        return {};
    }
    return response;
}

function getErrorStatus(err: unknown): number | undefined {
    if (typeof err !== 'object' || err === null) return undefined;
    const e = err as Record<string, unknown>;
    if (typeof e.status === 'number') return e.status;
    return undefined;
}

type SnapshotConnectorAction = ConnectorAction & {
    resourceUrlResolver?: (apiName: string, payload: Record<string, unknown>) => string | null;
};

const GITHUB_API = 'https://api.github.com';

function issueUrlResolver(_apiName: string, payload: Record<string, unknown>): string | null {
    const owner = typeof payload.owner === 'string' ? payload.owner : null;
    const repo = typeof payload.repo === 'string' ? payload.repo : null;
    const issueNumber = typeof payload.issue_number === 'number' ? payload.issue_number : null;
    if (!owner || !repo || issueNumber === null) {
        return null;
    }
    return `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}`;
}

export const githubConnector: Connector = {
    connector: 'github',
    actions: [
        {
            apiName: 'github.issues.create',
            captureBeforeState: false,
            operationType: 'CREATE',
            // Closing an issue may interrupt active team discussions or ongoing Sprints.
            // MEDIUM ensures the Engine surfaces this action in the Dashboard.
            safetyLevel: 'MEDIUM',
            resourceUrlResolver: issueUrlResolver,
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as GitHubAction;
                    const issue = getIssueResponse(action);
                    const owner = action.payload.owner;
                    const repo = action.payload.repo;
                    const issueNumber = issue.number;

                    if (!owner || !repo || !issueNumber) {
                        throw new Error(
                            `[githubConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing owner/repo/number in payload or response`,
                        );
                    }

                    const client = context.client as Octokit;
                    // GitHub does not support deleting issues — closing is the correct rollback.
                    try {
                        await client.issues.update({
                            owner,
                            repo,
                            issue_number: issueNumber,
                            state: 'closed',
                        });
                    } catch (err) {
                        if (getErrorStatus(err) === 404) {
                            return;
                        }
                        console.error(`[githubConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
                        throw err;
                    }
                },
                requires: ['github.token'],
            },
        } as SnapshotConnectorAction,
        {
            apiName: 'github.issues.update',
            captureBeforeState: true,
            operationType: 'UPDATE',
            safetyLevel: 'MEDIUM',
            resourceUrlResolver: issueUrlResolver,
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as GitHubAction;
                    const beforeState = action.snapshot?.beforeState ?? null;
                    if (!beforeState) {
                        throw new Error(
                            `[githubConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing beforeState`,
                        );
                    }

                    const owner = action.payload.owner;
                    const repo = action.payload.repo;
                    const issueNumber = action.payload.issue_number;
                    if (!owner || !repo || !issueNumber) {
                        throw new Error(
                            `[githubConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing owner/repo/issue_number in payload`,
                        );
                    }

                    const labels = beforeState.labels
                        ?.map((label) => (typeof label === 'string' ? label : label?.name))
                        .filter((label): label is string => Boolean(label));

                    const assignees = beforeState.assignees
                        ?.map((assignee) => (typeof assignee === 'string' ? assignee : assignee?.login))
                        .filter((assignee): assignee is string => Boolean(assignee));

                    const client = context.client as Octokit;
                    try {
                        await client.issues.update({
                            owner,
                            repo,
                            issue_number: issueNumber,
                            title: beforeState.title,
                            body: beforeState.body,
                            state: beforeState.state,
                            labels,
                            assignees,
                        });
                    } catch (err) {
                        if (getErrorStatus(err) === 404) {
                            return;
                        }
                        console.error(`[githubConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
                        throw err;
                    }
                },
                requires: ['github.token'],
            },
        } as SnapshotConnectorAction,
    ],
};
