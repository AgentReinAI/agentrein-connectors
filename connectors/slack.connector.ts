import type { ConnectorAction, Connector, RollbackContext } from '../types';
import { WebClient } from '@slack/web-api';

interface SlackAction {
    id: string;
    operationType: 'CREATE' | 'UPDATE' | 'DELETE';
    payload: {
        channel?: string;
        text?: string;
        ts?: string;
        blocks?: unknown[];
        attachments?: unknown[];
        file_ids?: string[];
    };
    response?: {
        data?: {
            ts?: string;
            channel?: string;
        };
        ts?: string;
        channel?: string;
    };
    undoConfig?: {
        requireApproval?: boolean;
        safetyLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
        reason?: string;
    };
    snapshot?: {
        beforeState?: {
            text?: string;
            blocks?: unknown[];
            attachments?: unknown[];
            file_ids?: string[];
            channel?: string;
            ts?: string;
        };
    };
}

function getResponseIds(action: SlackAction): { channel?: string; ts?: string } {
    return {
        channel: action.response?.data?.channel ?? action.response?.channel,
        ts: action.response?.data?.ts ?? action.response?.ts,
    };
}

function getRollbackErrorMessage(action: SlackAction, orgId: string, reason: string): string {
    return `[slackConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: ${reason}`;
}

function getBeforeState(action: SlackAction, orgId: string): NonNullable<NonNullable<SlackAction['snapshot']>['beforeState']> {
    const beforeState = action.snapshot?.beforeState;
    if (!beforeState) {
        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing beforeState'));
    }
    return beforeState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getSlackErrorCode(err: unknown): string | undefined {
    if (!isRecord(err)) return undefined;

    if (isRecord(err.data) && typeof err.data.error === 'string') {
        return err.data.error;
    }

    if (typeof err.code === 'string') return err.code;
    if (typeof err.message === 'string') return err.message;

    return undefined;
}

type SnapshotConnectorAction = ConnectorAction & {
    resourceUrlResolver?: (apiName: string, payload: Record<string, unknown>) => string | null;
};

const SLACK_API = 'https://slack.com/api';

function messageUrlResolver(_apiName: string, payload: Record<string, unknown>): string | null {
    const channel = typeof payload.channel === 'string' ? payload.channel : null;
    const ts = typeof payload.ts === 'string' ? payload.ts : null;
    if (!channel || !ts) {
        return null;
    }
    return `${SLACK_API}/conversations.history?channel=${channel}&latest=${ts}&inclusive=true&limit=1`;
}

export const slackConnector: Connector = {
    connector: 'slack',
    actions: [
        {
            apiName: 'slack.chat.postMessage',
            captureBeforeState: false,
            operationType: 'CREATE',
            safetyLevel: 'MEDIUM',
            resourceUrlResolver: messageUrlResolver,
            rollback: {
                type: 'CORRECTION_MESSAGE',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as SlackAction;
                    const { channel, ts } = getResponseIds(action);
                    if (!channel || !ts) {
                        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing channel/ts'));
                    }

                    const reason = action.undoConfig?.reason;
                    const client = context.client as WebClient;

                    try {
                        await client.chat.update({
                            channel,
                            ts,
                            blocks: [],
                            text: reason ? `⚠️ Reverted by AgentRein: ${reason}` : '⚠️ Reverted by AgentRein',
                        });
                    } catch (err) {
                        if (getSlackErrorCode(err) === 'message_not_found') {
                            return;
                        }

                        console.error(`[slackConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
                        throw err;
                    }
                },
                requires: ['slack.token'],
            },
        } as SnapshotConnectorAction,
        {
            apiName: 'slack.chat.update',
            captureBeforeState: true,
            operationType: 'UPDATE',
            safetyLevel: 'LOW',
            resourceUrlResolver: messageUrlResolver,
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as SlackAction;
                    const beforeState = getBeforeState(action, orgId);
                    if (!beforeState.channel || !beforeState.ts) {
                        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing channel/ts'));
                    }

                    const client = context.client as WebClient;
                    const updateArgs = {
                        channel: beforeState.channel,
                        ts: beforeState.ts,
                        text: beforeState.text,
                        ...(beforeState.blocks ? { blocks: beforeState.blocks } : {}),
                        ...(beforeState.attachments ? { attachments: beforeState.attachments } : {}),
                        ...(beforeState.file_ids ? { file_ids: beforeState.file_ids } : {}),
                    } as unknown as Parameters<typeof client.chat.update>[0];

                    try {
                        await client.chat.update(updateArgs);
                    } catch (err) {
                        if (getSlackErrorCode(err) === 'message_not_found') {
                            return;
                        }

                        console.error(`[slackConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
                        throw err;
                    }
                },
                requires: ['slack.token'],
            },
        } as SnapshotConnectorAction,
        {
            apiName: 'slack.chat.delete',
            captureBeforeState: true,
            operationType: 'DELETE',
            safetyLevel: 'MEDIUM',
            resourceUrlResolver: messageUrlResolver,
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as SlackAction;
                    const beforeState = getBeforeState(action, orgId);
                    if (!beforeState.channel) {
                        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing channel'));
                    }

                    const reason = action.undoConfig?.reason;
                    const client = context.client as WebClient;

                    // NOTE: restored message gets a new ts; any external references to the
                    // original ts will be broken. This is a Slack API limitation.
                    const postMessageArgs = {
                        channel: beforeState.channel,
                        text: `(Restored by AgentRein${reason ? `: ${reason}` : ''})\n\n${beforeState.text ?? ''}`,
                        ...(beforeState.blocks ? { blocks: beforeState.blocks } : {}),
                        ...(beforeState.attachments ? { attachments: beforeState.attachments } : {}),
                    } as unknown as Parameters<typeof client.chat.postMessage>[0];

                    try {
                        await client.chat.postMessage(postMessageArgs);
                    } catch (err) {
                        if (getSlackErrorCode(err) === 'channel_not_found') {
                            return;
                        }

                        console.error(`[slackConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
                        throw err;
                    }
                },
                requires: ['slack.token'],
            },
        } as SnapshotConnectorAction,
    ],
};/ /   s y n c   t e s t  
 / /   s y n c   t e s t   2  
 / /   s y n c   t e s t   3  
 