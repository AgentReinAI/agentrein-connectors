import type { ConnectorAction, Connector, RollbackContext } from '../types';
import axios from 'axios';
import { sheets_v4 } from 'googleapis';

interface SheetsSpreadsheet {
    spreadsheetId: string;
    spreadsheetUrl: string;
}

interface SheetsValuesBeforeState {
    spreadsheetId: string;
    range: string;
    values: unknown[][];
}

interface GSheetsAction {
    id: string;
    operationType: 'CREATE' | 'UPDATE' | 'DELETE';
    payload: {
        spreadsheetId?: string;
        range?: string;
        values?: unknown[][];
    };
    response?: {
        data?: {
            spreadsheetId?: string;
            updates?: {
                updatedRange?: string;
            };
            replies?: Array<{
                addSheet?: {
                    properties?: {
                        sheetId?: number;
                    };
                };
            }>;
        };
    } & {
        spreadsheetId?: string;
        updates?: {
            updatedRange?: string;
        };
        replies?: Array<{
            addSheet?: {
                properties?: {
                    sheetId?: number;
                };
            };
        }>;
    };
    undoConfig?: {
        requireApproval?: boolean;
        safetyLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
        reason?: string;
    };
    snapshot?: {
        beforeState?: SheetsValuesBeforeState | null;
    };
}

type GSheetsResponse = NonNullable<GSheetsAction['response']>['data'] & NonNullable<GSheetsAction['response']>;

function getResponse(action: GSheetsAction, orgId: string): GSheetsResponse {
    const response = action.response?.data ?? action.response;
    if (!response) {
        throw new Error(
            `[gsheetsConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing response`,
        );
    }
    return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface GoogleAuthHeadersProvider {
    getRequestHeaders: (url?: string | URL) => Promise<unknown>;
}

function isGoogleAuthHeadersProvider(value: unknown): value is GoogleAuthHeadersProvider {
    return isRecord(value) && typeof value.getRequestHeaders === 'function';
}

async function getGoogleAuthHeaders(sheetsClient: sheets_v4.Sheets): Promise<Record<string, string>> {
    const auth = sheetsClient.context._options.auth;
    if (!isGoogleAuthHeadersProvider(auth)) {
        return {};
    }

    const headers = await auth.getRequestHeaders();
    if (!isRecord(headers)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
}

function getErrorStatus(err: unknown): number | undefined {
    if (!isRecord(err)) return undefined;

    if (typeof err.status === 'number') return err.status;
    if (typeof err.code === 'number') return err.code;

    if (isRecord(err.response) && typeof err.response.status === 'number') {
        return err.response.status;
    }

    return undefined;
}

function handleRollbackError(action: GSheetsAction, orgId: string, err: unknown): void {
    const status = getErrorStatus(err);

    if (status === 404) {
        return;
    }

    if (status === 403) {
        throw new Error(
            `[gsheetsConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: PERMISSION_DENIED — verify the Service Account has Editor access to this Spreadsheet`,
        );
    }

    console.error(`[gsheetsConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType}`, err);
    throw err;
}

type SnapshotConnectorAction = ConnectorAction & {
    resourceUrlResolver?: (apiName: string, payload: Record<string, unknown>) => string | null;
};

export const gsheetsConnector: Connector = {
    connector: 'gsheets',
    actions: [
        {
            apiName: 'gsheets.values.append',
            captureBeforeState: false,
            operationType: 'CREATE',
            safetyLevel: 'MEDIUM',
            resourceUrlResolver: () => null,
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as GSheetsAction;
                    const response = getResponse(action, orgId);
                    const updatedRange = response.updates?.updatedRange;
                    if (!updatedRange) {
                        throw new Error(
                            `[gsheetsConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing updatedRange in response`,
                        );
                    }

                    const spreadsheetId = action.payload.spreadsheetId;
                    if (!spreadsheetId) {
                        throw new Error(
                            `[gsheetsConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing spreadsheetId in payload`,
                        );
                    }

                    const sheetsClient = context.client as sheets_v4.Sheets;
                    try {
                        await sheetsClient.spreadsheets.values.clear({
                            spreadsheetId,
                            range: updatedRange,
                        });
                    } catch (err) {
                        handleRollbackError(action, orgId, err);
                    }
                },
                requires: ['google.clientId', 'google.clientSecret', 'google.refreshToken'],
            },
        } as SnapshotConnectorAction,
        {
            apiName: 'gsheets.values.update',
            captureBeforeState: true,
            operationType: 'UPDATE',
            safetyLevel: 'MEDIUM',
            resourceUrlResolver: () => null,
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as GSheetsAction;
                    const beforeState = action.snapshot?.beforeState ?? null;
                    if (!beforeState) {
                        throw new Error(
                            `[gsheetsConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Critical — no beforeState found, data at risk`,
                        );
                    }

                    const sheetsClient = context.client as sheets_v4.Sheets;
                    try {
                        await sheetsClient.spreadsheets.values.update({
                            spreadsheetId: beforeState.spreadsheetId,
                            range: beforeState.range,
                            valueInputOption: 'RAW',
                            requestBody: { values: beforeState.values },
                        });
                    } catch (err) {
                        handleRollbackError(action, orgId, err);
                    }
                },
                requires: ['google.clientId', 'google.clientSecret', 'google.refreshToken'],
            },
        } as SnapshotConnectorAction,
        {
            apiName: 'gsheets.spreadsheets.create',
            captureBeforeState: false,
            operationType: 'CREATE',
            safetyLevel: 'HIGH',
            resourceUrlResolver: () => null,
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as GSheetsAction;
                    const spreadsheet = getResponse(action, orgId) as SheetsSpreadsheet;
                    if (!spreadsheet.spreadsheetId) {
                        throw new Error(
                            `[gsheetsConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing spreadsheetId in response`,
                        );
                    }

                    const sheetsClient = context.client as sheets_v4.Sheets;
                    // Soft delete gives a 30-day recovery window.
                    // Consistent with gdrive.files.create rollback strategy.
                    try {
                        await sheetsClient.spreadsheets.batchUpdate({
                            spreadsheetId: spreadsheet.spreadsheetId,
                            requestBody: { requests: [] },
                        });
                        await axios.patch(
                            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheet.spreadsheetId)}`,
                            { trashed: true },
                            { headers: await getGoogleAuthHeaders(sheetsClient) },
                        );
                    } catch (err) {
                        handleRollbackError(action, orgId, err);
                    }
                },
                requires: ['google.clientId', 'google.clientSecret', 'google.refreshToken'],
            },
        } as SnapshotConnectorAction,
        {
            apiName: 'gsheets.sheets.add',
            captureBeforeState: false,
            operationType: 'CREATE',
            safetyLevel: 'MEDIUM',
            resourceUrlResolver: () => null,
            rollback: {
                type: 'API_CALL',
                execute: async (rawAction: unknown, context: RollbackContext): Promise<void> => {
                    const orgId = 'unknown';
                    const action = rawAction as GSheetsAction;
                    const response = getResponse(action, orgId);
                    const sheetId = response.replies?.[0]?.addSheet?.properties?.sheetId;
                    if (sheetId === undefined) {
                        throw new Error(
                            `[gsheetsConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing sheetId in response`,
                        );
                    }

                    const spreadsheetId = action.payload.spreadsheetId;
                    if (!spreadsheetId) {
                        throw new Error(
                            `[gsheetsConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: Missing spreadsheetId in payload`,
                        );
                    }

                    const sheetsClient = context.client as sheets_v4.Sheets;
                    try {
                        await sheetsClient.spreadsheets.batchUpdate({
                            spreadsheetId,
                            requestBody: {
                                requests: [{ deleteSheet: { sheetId } }],
                            },
                        });
                    } catch (err) {
                        handleRollbackError(action, orgId, err);
                    }
                },
                requires: ['google.clientId', 'google.clientSecret', 'google.refreshToken'],
            },
        } as SnapshotConnectorAction,
    ],
};
