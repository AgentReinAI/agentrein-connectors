import type { ConnectorAction, Connector, RollbackContext } from '../types';
import { Connection as SalesforceConnection } from 'jsforce';

interface SalesforceContact {
    id: string;
    fields: Record<string, unknown>;
}

interface SalesforceOpportunity {
    id: string;
    fields: Record<string, unknown>;
}

interface SalesforceAction {
    id: string;
    operationType: 'CREATE' | 'UPDATE' | 'DELETE';
    payload: Record<string, unknown>;
    response?: {
        data?: SalesforceContact & SalesforceOpportunity;
    } & (SalesforceContact & SalesforceOpportunity);
    undoConfig?: {
        requireApproval?: boolean;
        safetyLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
        reason?: string;
    };
    snapshot?: {
        beforeState?: (SalesforceContact | SalesforceOpportunity) | null;
    };
}

type SalesforceResponse = SalesforceContact & SalesforceOpportunity;

function getResponse(action: SalesforceAction, orgId: string): SalesforceResponse {
    const response = action.response?.data ?? action.response;
    if (!response) {
        throw new Error(
            `[salesforceConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing response`,
        );
    }
    return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorStatus(err: unknown): number | undefined {
    if (isRecord(err) && typeof err.errorCode === 'string') {
        if (err.errorCode === 'NOT_FOUND') return 404;
    }
    if (isRecord(err) && typeof err.statusCode === 'number') {
        return err.statusCode;
    }
    return undefined;
}

function handleSalesforceRollbackError(action: SalesforceAction, orgId: string, err: unknown): void {
    if (getErrorStatus(err) === 404) {
        return;
    }

    console.error(`[salesforceConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
    throw err;
}

type SnapshotConnectorAction = ConnectorAction & {
    resourceUrlResolver?: (apiName: string, payload: Record<string, unknown>) => string | null;
};

function getSalesforceResourceUrl(resource: 'Contact' | 'Opportunity', payload: Record<string, unknown>): string | null {
    const id = typeof payload.id === 'string' ? payload.id : null;
    const instanceUrl = process.env.SALESFORCE_INSTANCE_URL;
    if (!id || !instanceUrl) {
        return null;
    }
    return `${instanceUrl}/services/data/v58.0/sobjects/${resource}/${id}`;
}

export const salesforceConnector: Connector = {
    connector: 'salesforce',
    actions: [
        {
            apiName: 'salesforce.contacts.create',
            captureBeforeState: false,
            operationType: 'CREATE',
            // Salesforce DELETE is permanent (hard delete), not soft.
            // Engine will open Human Gate automatically for HIGH safety actions.
            safetyLevel: 'HIGH',
            resourceUrlResolver: () => null,
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as SalesforceAction;
                    const contact = getResponse(action, orgId) as SalesforceContact;
                    if (!contact.id) {
                        throw new Error(
                            `[salesforceConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing contact id in response`,
                        );
                    }

                    const client = context.client as SalesforceConnection;
                    try {
                        await client.sobject('Contact').delete(contact.id);
                    } catch (err) {
                        handleSalesforceRollbackError(action, orgId, err);
                    }
                },
                requires: ['salesforce.accessToken'],
            },
        } as SnapshotConnectorAction,
        {
            apiName: 'salesforce.contacts.update',
            captureBeforeState: true,
            operationType: 'UPDATE',
            safetyLevel: 'MEDIUM',
            resourceUrlResolver: (_apiName: string, payload: Record<string, unknown>) => getSalesforceResourceUrl('Contact', payload),
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as SalesforceAction;
                    const beforeState = action.snapshot?.beforeState as SalesforceContact | null | undefined;
                    if (!beforeState) {
                        throw new Error(
                            `[salesforceConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing beforeState`,
                        );
                    }

                    if (!beforeState.id) {
                        throw new Error(
                            `[salesforceConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing contact id in beforeState`,
                        );
                    }

                    const client = context.client as SalesforceConnection;
                    // PATCH restores only the changed fields — surgical rollback,
                    // not a full overwrite. Leaves all other fields untouched.
                    try {
                        await client.sobject('Contact').update({
                            Id: beforeState.id,
                            ...beforeState.fields,
                        });
                    } catch (err) {
                        handleSalesforceRollbackError(action, orgId, err);
                    }
                },
                requires: ['salesforce.accessToken'],
            },
        } as SnapshotConnectorAction,
        {
            apiName: 'salesforce.opportunities.create',
            captureBeforeState: false,
            operationType: 'CREATE',
            // Salesforce DELETE is permanent (hard delete), not soft.
            // Engine will open Human Gate automatically for HIGH safety actions.
            safetyLevel: 'HIGH',
            resourceUrlResolver: () => null,
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as SalesforceAction;
                    const opportunity = getResponse(action, orgId) as SalesforceOpportunity;
                    if (!opportunity.id) {
                        throw new Error(
                            `[salesforceConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing opportunity id in response`,
                        );
                    }

                    const client = context.client as SalesforceConnection;
                    try {
                        await client.sobject('Opportunity').delete(opportunity.id);
                    } catch (err) {
                        handleSalesforceRollbackError(action, orgId, err);
                    }
                },
                requires: ['salesforce.accessToken'],
            },
        } as SnapshotConnectorAction,
        {
            apiName: 'salesforce.opportunities.update',
            captureBeforeState: true,
            operationType: 'UPDATE',
            safetyLevel: 'MEDIUM',
            resourceUrlResolver: (_apiName: string, payload: Record<string, unknown>) => getSalesforceResourceUrl('Opportunity', payload),
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as SalesforceAction;
                    const beforeState = action.snapshot?.beforeState as SalesforceOpportunity | null | undefined;
                    if (!beforeState) {
                        throw new Error(
                            `[salesforceConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing beforeState`,
                        );
                    }

                    if (!beforeState.id) {
                        throw new Error(
                            `[salesforceConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing opportunity id in beforeState`,
                        );
                    }

                    const client = context.client as SalesforceConnection;
                    // PATCH restores only the changed fields — surgical rollback.
                    try {
                        await client.sobject('Opportunity').update({
                            Id: beforeState.id,
                            ...beforeState.fields,
                        });
                    } catch (err) {
                        handleSalesforceRollbackError(action, orgId, err);
                    }
                },
                requires: ['salesforce.accessToken'],
            },
        } as SnapshotConnectorAction,
    ],
};
