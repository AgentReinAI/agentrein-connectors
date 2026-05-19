import type { ConnectorAction, Connector, RollbackContext } from '../types';
import Stripe from 'stripe';

interface StripeAction {
    id: string;
    operationType: 'CREATE' | 'UPDATE' | 'DELETE';
    payload: Record<string, unknown>;
    response?: {
        data?: {
            id?: string;
            status?: string;
            [key: string]: unknown;
        };
        id?: string;
        status?: string;
        [key: string]: unknown;
    };
    undoConfig?: {
        requireApproval?: boolean;
        safetyLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
        reason?: string;
    };
    snapshot?: {
        beforeState?: Record<string, unknown> | null;
    };
}

type StripeConnectorAction = ConnectorAction & {
    undoConfig?: StripeAction['undoConfig'];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getResponseRecord(action: StripeAction): Record<string, unknown> {
    const response = action.response;
    if (isRecord(response) && isRecord(response.data)) return response.data;
    if (isRecord(response)) return response;
    return {};
}

function getRollbackError(action: StripeAction, orgId: string, reason: string): Error {
    return new Error(
        `[stripeConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: ${reason}`,
    );
}

function requireStringId(record: Record<string, unknown>, action: StripeAction, orgId: string, resource: string): string {
    if (typeof record.id !== 'string') {
        const err = getRollbackError(action, orgId, `Missing ${resource} id in response`);
        console.error(`[stripeConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
        throw err;
    }
    return record.id;
}

function isNonDraftInvoiceError(err: unknown): boolean {
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
        return err.code === 'invoice_not_editable' ||
            err.code === 'invoice_already_finalized';
    }
    return false;
}

function isNotFoundError(err: unknown): boolean {
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
        return err.statusCode === 404;
    }
    return false;
}

const stripeActions = [
        {
            apiName: 'stripe.invoices.create',
            captureBeforeState: false,
            operationType: 'CREATE',
            safetyLevel: 'HIGH',
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as StripeAction;
                    const res = getResponseRecord(action);
                    const client = context.client as Stripe;
                    const invoiceId = requireStringId(res, action, orgId, 'invoice');

                    try {
                        await client.invoices.del(invoiceId);
                    } catch (err) {
                        if (isNonDraftInvoiceError(err)) {
                            const rollbackErr = getRollbackError(
                                action,
                                orgId,
                                'Invoice is no longer a Draft — manual intervention required (Void or Credit Note)',
                            );
                            console.error(
                                `[stripeConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`,
                                err,
                            );
                            throw rollbackErr;
                        }

                        console.error(
                            `[stripeConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`,
                            err,
                        );
                        throw err;
                    }
                },
                requires: ['stripe.apiKey'],
            },
        },
        {
            apiName: 'stripe.customers.create',
            captureBeforeState: false,
            operationType: 'CREATE',
            safetyLevel: 'HIGH',
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as StripeAction;
                    const res = getResponseRecord(action);
                    const client = context.client as Stripe;
                    const customerId = requireStringId(res, action, orgId, 'customer');

                    try {
                        await client.customers.del(customerId);
                    } catch (err) {
                        if (isNotFoundError(err)) return;

                        console.error(
                            `[stripeConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`,
                            err,
                        );
                        throw err;
                    }
                },
                requires: ['stripe.apiKey'],
            },
        },
        {
            apiName: 'stripe.refunds.create',
            captureBeforeState: false,
            operationType: 'CREATE',
            safetyLevel: 'HIGH',
            undoConfig: {
                requireApproval: true,
                reason: 'Refunds are irreversible on Stripe — human approval required before execution',
            },
            rollback: {
                type: 'NONE',
                execute: async (_action: unknown, _context: RollbackContext): Promise<void> => {},
                requires: [],
            },
        },
    ] satisfies StripeConnectorAction[];

export const stripeConnector: Connector = {
    connector: 'stripe',
    actions: stripeActions,
};
