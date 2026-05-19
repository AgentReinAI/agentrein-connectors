import type { ConnectorAction, Connector, RollbackContext } from '../types';
import { Client as HubSpotClient } from '@hubspot/api-client';

interface HubSpotContact {
    id: string;
    properties: Record<string, string>;
}

interface HubSpotDeal {
    id: string;
    properties: Record<string, string>;
}

interface HubSpotAction {
    id: string;
    operationType: 'CREATE' | 'UPDATE' | 'DELETE';
    payload: Record<string, unknown>;
    response?: {
        data?: HubSpotContact & HubSpotDeal;
    } & (HubSpotContact & HubSpotDeal);
    undoConfig?: {
        requireApproval?: boolean;
        safetyLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
        reason?: string;
    };
    snapshot?: {
        beforeState?: (HubSpotContact | HubSpotDeal) | null;
    };
}

function getRollbackErrorMessage(action: HubSpotAction, orgId: string, reason: string): string {
    return `[hubspotConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: ${reason}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFoundError(err: unknown): boolean {
    if (isRecord(err) && typeof err.code === 'number') {
        return err.code === 404;
    }
    return false;
}

function getResponse(action: HubSpotAction, orgId: string): HubSpotContact & HubSpotDeal {
    const response = action.response?.data ?? action.response;
    if (!response) {
        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing response'));
    }
    return response;
}

type SnapshotConnectorAction = ConnectorAction & {
    resourceUrlResolver?: (apiName: string, payload: Record<string, unknown>) => string | null;
};

function getHubSpotObjectUrl(objectType: 'contacts' | 'deals', payload: Record<string, unknown>): string | null {
    return typeof payload.id === 'string'
        ? `https://api.hubapi.com/crm/v3/objects/${objectType}/${payload.id}`
        : null;
}

export const hubspotConnector: Connector = {
    connector: 'hubspot',
    actions: [
        {
            apiName: 'hubspot.contacts.create',
            captureBeforeState: false,
            operationType: 'CREATE',
            safetyLevel: 'HIGH',
            resourceUrlResolver: () => null,
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as HubSpotAction;
                    const contact = getResponse(action, orgId) as HubSpotContact;
                    if (!contact.id) {
                        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing contact id'));
                    }

                    const client = context.client as HubSpotClient;
                    // NOTE: HubSpot DELETE v3 performs an archive (soft delete), not a
                    // permanent delete. Permanent deletion requires a separate API with
                    // elevated permissions. This is intentional and safe.
                    try {
                        await client.crm.contacts.basicApi.archive(contact.id);
                    } catch (err) {
                        if (isNotFoundError(err)) {
                            return;
                        }
                        console.error(`[hubspotConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
                        throw err;
                    }
                },
                requires: ['hubspot.accessToken'],
            },
        } as SnapshotConnectorAction,
        {
            apiName: 'hubspot.contacts.update',
            captureBeforeState: true,
            operationType: 'UPDATE',
            safetyLevel: 'MEDIUM',
            resourceUrlResolver: (_apiName: string, payload: Record<string, unknown>) => getHubSpotObjectUrl('contacts', payload),
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as HubSpotAction;
                    const beforeState = action.snapshot?.beforeState as HubSpotContact | null | undefined;
                    if (!beforeState) {
                        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing beforeState'));
                    }

                    if (!beforeState.id) {
                        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing contact id'));
                    }

                    const client = context.client as HubSpotClient;
                    // PATCH restores only the changed properties — leaves all other fields
                    // untouched. This is a surgical rollback, not a full overwrite.
                    try {
                        await client.crm.contacts.basicApi.update(
                            beforeState.id,
                            { properties: beforeState.properties },
                        );
                    } catch (err) {
                        if (isNotFoundError(err)) {
                            return;
                        }
                        console.error(`[hubspotConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
                        throw err;
                    }
                },
                requires: ['hubspot.accessToken'],
            },
        } as SnapshotConnectorAction,
        {
            apiName: 'hubspot.deals.create',
            captureBeforeState: false,
            operationType: 'CREATE',
            safetyLevel: 'HIGH',
            resourceUrlResolver: () => null,
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as HubSpotAction;
                    const deal = getResponse(action, orgId) as HubSpotDeal;
                    if (!deal.id) {
                        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing deal id'));
                    }

                    const client = context.client as HubSpotClient;
                    // NOTE: HubSpot DELETE v3 performs an archive (soft delete), not a
                    // permanent delete. This is intentional and safe.
                    try {
                        await client.crm.deals.basicApi.archive(deal.id);
                    } catch (err) {
                        if (isNotFoundError(err)) {
                            return;
                        }
                        console.error(`[hubspotConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
                        throw err;
                    }
                },
                requires: ['hubspot.accessToken'],
            },
        } as SnapshotConnectorAction,
        {
            apiName: 'hubspot.deals.update',
            captureBeforeState: true,
            operationType: 'UPDATE',
            safetyLevel: 'MEDIUM',
            resourceUrlResolver: (_apiName: string, payload: Record<string, unknown>) => getHubSpotObjectUrl('deals', payload),
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as HubSpotAction;
                    const beforeState = action.snapshot?.beforeState as HubSpotDeal | null | undefined;
                    if (!beforeState) {
                        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing beforeState'));
                    }

                    if (!beforeState.id) {
                        throw new Error(getRollbackErrorMessage(action, orgId, 'Missing deal id'));
                    }

                    const client = context.client as HubSpotClient;
                    // PATCH restores only the changed properties — surgical rollback.
                    try {
                        await client.crm.deals.basicApi.update(
                            beforeState.id,
                            { properties: beforeState.properties },
                        );
                    } catch (err) {
                        if (isNotFoundError(err)) {
                            return;
                        }
                        console.error(`[hubspotConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
                        throw err;
                    }
                },
                requires: ['hubspot.accessToken'],
            },
        } as SnapshotConnectorAction,
    ],
};
