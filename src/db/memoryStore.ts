import type {
  activityLogs,
  crossModalCorrelations,
  evidenceItems,
  forensicFindings,
  investigations,
  users,
} from './schema.ts';

export type UserRow = typeof users.$inferSelect;
export type InvestigationRow = typeof investigations.$inferSelect;
export type EvidenceItemRow = typeof evidenceItems.$inferSelect;
export type ForensicFindingRow = typeof forensicFindings.$inferSelect;
export type CrossModalCorrelationRow = typeof crossModalCorrelations.$inferSelect;
export type ActivityLogRow = typeof activityLogs.$inferSelect;

interface MemoryDbState {
  nextUserId: number;
  nextInvestigationId: number;
  nextEvidenceId: number;
  nextFindingId: number;
  nextCorrelationId: number;
  nextActivityId: number;
  users: UserRow[];
  investigations: InvestigationRow[];
  evidenceItems: EvidenceItemRow[];
  forensicFindings: ForensicFindingRow[];
  crossModalCorrelations: CrossModalCorrelationRow[];
  activityLogs: ActivityLogRow[];
}

declare global {
  var _truthLensMemoryDb: MemoryDbState | undefined;
}

export function getMemoryDb(): MemoryDbState {
  if (!global._truthLensMemoryDb) {
    global._truthLensMemoryDb = {
      nextUserId: 1,
      nextInvestigationId: 1,
      nextEvidenceId: 1,
      nextFindingId: 1,
      nextCorrelationId: 1,
      nextActivityId: 1,
      users: [],
      investigations: [],
      evidenceItems: [],
      forensicFindings: [],
      crossModalCorrelations: [],
      activityLogs: [],
    };
  }
  return global._truthLensMemoryDb;
}
