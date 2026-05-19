import type { Connector } from '../types';

// Replace this with your official SDK client type, for example:
// import { TodoistApi as TYourSDKClient } from '@doist/todoist-api-typescript';
interface TYourSDKClient {
  deleteTask: (id: string) => Promise<void>;
  updateTask: (id: string, payload: { content?: string; projectId?: string }) => Promise<void>;
}

// ─── Types ───────────────────────────────────────────
interface TodoistTask {
  id: string;
  content: string;
  projectId: string;
}

interface TodoistAction {
  id: string;
  operationType: 'CREATE' | 'UPDATE' | 'DELETE';
  payload: { content?: string; projectId?: string };
  response?: { data?: TodoistTask } & TodoistTask;
  undoConfig?: { reason?: string };
  snapshot?: { beforeState?: TodoistTask | null };
}

function getRollbackError(action: TodoistAction, orgId: string, reason: string): Error {
  return new Error(
    `[todoistConnector] rollback failed | action: ${action.id} | org: ${orgId} | op: ${action.operationType} | reason: ${reason}`,
  );
}

function getCreatedTask(action: TodoistAction, orgId: string): TodoistTask {
  const task = action.response?.data ?? action.response;
  if (!task?.id) {
    throw getRollbackError(action, orgId, 'Missing created task id');
  }
  return task;
}

function getBeforeState(action: TodoistAction, orgId: string): TodoistTask {
  const beforeState = action.snapshot?.beforeState;
  if (!beforeState) {
    // Never silently return when a rollback needs beforeState. Missing state
    // means rollback cannot prove what it should restore.
    throw getRollbackError(action, orgId, 'Missing beforeState');
  }
  return beforeState;
}

function isNotFoundError(err: unknown): boolean {
  return typeof err === 'object' &&
    err !== null &&
    ('status' in err || 'code' in err) &&
    ((err as { status?: unknown }).status === 404 || (err as { code?: unknown }).code === 404);
}

// ─── Connector ───────────────────────────────────────
export const todoistConnector: Connector = {
  connector: 'todoist',
  actions: [
    {
      apiName: 'todoist.tasks.create',
      operationType: 'CREATE',
      // captureBeforeState=false because a newly-created task did not exist
      // before the action. Rollback only needs the created task id.
      captureBeforeState: false,
      // safetyLevel communicates rollback risk to AgentRein. LOW is normally
      // reversible, MEDIUM may affect visible user work, HIGH needs extra care
      // or human approval.
      safetyLevel: 'MEDIUM',
      rollback: {
        type: 'API_CALL',
        execute: async (rawAction, context) => {
          const action = rawAction as TodoistAction;
          const orgId = 'unknown';
          const task = getCreatedTask(action, orgId);

          // context.client is provided by AgentRein after credentials are
          // resolved. Connectors should cast it to the official SDK type and
          // never build API tokens or OAuth clients themselves.
          const client = context.client as TYourSDKClient;

          try {
            // DELETE the created task.
            await client.deleteTask(task.id);
          } catch (err) {
            // 404 means the task is already gone. Treat this as a successful,
            // idempotent rollback instead of failing a retry.
            if (isNotFoundError(err)) return;
            throw getRollbackError(action, orgId, err instanceof Error ? err.message : 'Unknown error');
          }
        },
        requires: ['todoist.apiToken'],
      },
    },
    {
      apiName: 'todoist.tasks.update',
      operationType: 'UPDATE',
      captureBeforeState: true, // ← saves beforeState automatically
      // captureBeforeState=true tells AgentRein to snapshot the task before
      // the action runs and attach it at action.snapshot.beforeState.
      safetyLevel: 'LOW',
      rollback: {
        type: 'API_CALL',
        execute: async (rawAction, context) => {
          const action = rawAction as TodoistAction;
          const orgId = 'unknown';
          const beforeState = getBeforeState(action, orgId);

          if (!beforeState.id) {
            // Always guard ids before API calls so failures are clear and do
            // not become ambiguous SDK errors.
            throw getRollbackError(action, orgId, 'Missing task id');
          }

          const client = context.client as TYourSDKClient;

          try {
            // Restore from action.snapshot.beforeState.
            await client.updateTask(beforeState.id, {
              content: beforeState.content,
              projectId: beforeState.projectId,
            });
          } catch (err) {
            if (isNotFoundError(err)) return;
            throw getRollbackError(action, orgId, err instanceof Error ? err.message : 'Unknown error');
          }
        },
        requires: ['todoist.apiToken'],
      },
    },
  ],
};
