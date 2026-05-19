import type { ConnectorAction, Connector, RollbackContext } from '../types';
import { gmail_v1 } from 'googleapis';

interface GmailMessage {
    id: string;
    threadId: string;
    labelIds?: string[];
    snippet?: string;
}

interface GmailDraft {
    id: string;
    message: GmailMessage;
}

interface GmailAction {
    id: string;
    operationType: 'CREATE' | 'UPDATE' | 'DELETE';
    payload: {
        to?: string;
        subject?: string;
        threadId?: string;
        messageId?: string;
        addLabelIds?: string[];
        removeLabelIds?: string[];
    };
    response?: {
        data?: GmailMessage & GmailDraft;
    } & (GmailMessage & GmailDraft);
    undoConfig?: {
        requireApproval?: boolean;
        safetyLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
        reason?: string;
    };
    snapshot?: {
        beforeState?: {
            labelIds?: string[];
        };
    };
}

function getRollbackErrorMessage(action: GmailAction, orgId: string, reason: string): string {
    return `[gmailConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: ${reason}`;
}

function getErrorStatus(err: unknown): number | undefined {
    if (typeof err !== 'object' || err === null) {
        return undefined;
    }

    const candidate = err as {
        status?: unknown;
        code?: unknown;
        response?: {
            status?: unknown;
        };
    };

    if (typeof candidate.status === 'number') {
        return candidate.status;
    }

    if (typeof candidate.code === 'number') {
        return candidate.code;
    }

    if (typeof candidate.response?.status === 'number') {
        return candidate.response.status;
    }

    return undefined;
}

function getResponse(action: GmailAction, orgId: string): GmailMessage & GmailDraft {
    const response = action.response?.data ?? action.response;
    if (!response) {
        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing Gmail response'));
    }
    return response;
}

type SnapshotConnectorAction = ConnectorAction & {
    resourceUrlResolver?: (apiName: string, payload: Record<string, unknown>) => string | null;
};

export const gmailConnector: Connector = {
    connector: 'gmail',
    actions: [
        {
            apiName: 'gmail.messages.send',
            captureBeforeState: false,
            operationType: 'CREATE',
            safetyLevel: 'MEDIUM',
            resourceUrlResolver: () => null,
            rollback: {
                type: 'CORRECTION_MESSAGE',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as GmailAction;
                    const msg = getResponse(action, orgId) as GmailMessage;
                    const payload = action.payload;
                    const client = context.client as gmail_v1.Gmail;
                    const reason = action.undoConfig?.reason;
                    const body = reason
                        ? `Warning: The previous email was sent in error by an AI agent.\nReason: ${reason}\nPlease disregard the previous message.`
                        : 'Warning: The previous email was sent in error. Please disregard.';

                    const correctionRaw = Buffer.from(
                        [
                            `To: ${payload.to ?? ''}`,
                            `Subject: Re: ${payload.subject ?? 'Your Recent Email'}`,
                            'MIME-Version: 1.0',
                            'Content-Type: text/plain; charset=UTF-8',
                            '',
                            body,
                        ].join('\r\n'),
                    ).toString('base64url');

                    try {
                        await client.users.messages.send({
                            userId: 'me',
                            requestBody: { raw: correctionRaw, threadId: msg.threadId },
                        });
                    } catch (err) {
                        if (getErrorStatus(err) === 404) {
                            return;
                        }
                        console.error(`[gmailConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
                        throw err;
                    }
                },
                requires: ['gmail.clientId', 'gmail.clientSecret', 'gmail.refreshToken'],
            },
        } as SnapshotConnectorAction,
        {
            apiName: 'gmail.messages.trash',
            captureBeforeState: true,
            operationType: 'DELETE',
            safetyLevel: 'MEDIUM',
            resourceUrlResolver: () => null,
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as GmailAction;
                    const msg = getResponse(action, orgId) as GmailMessage;
                    if (!msg.id) {
                        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing message id'));
                    }

                    const client = context.client as gmail_v1.Gmail;
                    let labelIds: string[] | undefined;
                    try {
                        const currentMessage = await client.users.messages.get({ userId: 'me', id: msg.id });
                        labelIds = currentMessage.data.labelIds ?? undefined;
                    } catch (err) {
                        if (getErrorStatus(err) === 404) {
                            throw new Error(getRollbackErrorMessage(action, orgId, `Message ${msg.id} is no longer in trash — manual intervention required`));
                        }
                        throw err;
                    }

                    if (!labelIds?.includes('TRASH')) {
                        throw new Error(getRollbackErrorMessage(action, orgId, `Message ${msg.id} is no longer in trash — manual intervention required`));
                    }

                    try {
                        await client.users.messages.untrash({
                            userId: 'me',
                            id: msg.id,
                        });
                    } catch (err) {
                        if (getErrorStatus(err) === 404) {
                            return;
                        }
                        console.error(`[gmailConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
                        throw err;
                    }
                },
                requires: ['gmail.clientId', 'gmail.clientSecret', 'gmail.refreshToken'],
            },
        } as SnapshotConnectorAction,
        {
            apiName: 'gmail.drafts.create',
            captureBeforeState: false,
            operationType: 'CREATE',
            safetyLevel: 'LOW',
            resourceUrlResolver: () => null,
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as GmailAction;
                    const draft = getResponse(action, orgId) as GmailDraft;
                    if (!draft.id) {
                        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing draft id'));
                    }

                    const client = context.client as gmail_v1.Gmail;
                    try {
                        await client.users.drafts.delete({
                            userId: 'me',
                            id: draft.id,
                        });
                    } catch (err) {
                        if (getErrorStatus(err) === 404) {
                            return;
                        }
                        console.error(`[gmailConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
                        throw err;
                    }
                },
                requires: ['gmail.clientId', 'gmail.clientSecret', 'gmail.refreshToken'],
            },
        } as SnapshotConnectorAction,
        {
            apiName: 'gmail.labels.modify',
            captureBeforeState: true,
            operationType: 'UPDATE',
            safetyLevel: 'MEDIUM',
            resourceUrlResolver: () => null,
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as GmailAction;
                    const beforeState = action.snapshot?.beforeState;
                    if (!beforeState?.labelIds?.length) {
                        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing beforeState.labelIds'));
                    }

                    const messageId = action.payload.messageId;
                    if (!messageId) {
                        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing messageId'));
                    }

                    const client = context.client as gmail_v1.Gmail;
                    try {
                        await client.users.messages.modify({
                            userId: 'me',
                            id: messageId,
                            requestBody: {
                                // addLabelIds restores the original labels.
                                // removeLabelIds removes exactly what the Agent added —
                                // guaranteeing a clean atomic restore with no leftover labels.
                                addLabelIds: beforeState.labelIds,
                                removeLabelIds: action.payload.addLabelIds ?? [],
                            },
                        });
                    } catch (err) {
                        if (getErrorStatus(err) === 404) {
                            return;
                        }
                        console.error(`[gmailConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
                        throw err;
                    }
                },
                requires: ['gmail.clientId', 'gmail.clientSecret', 'gmail.refreshToken'],
            },
        } as SnapshotConnectorAction,
    ],
};
