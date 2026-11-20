# Security Specification & Payload TDD (`firestore.rules`)

## 1. Data Invariants
1. **Identity & Subcollection Ownership**: All user profiles (`/users/{userId}`) and user-owned forensic subcollections (`investigations`, `evidenceItems`, `correlations`, `activityLogs`) may only be read, created, updated, or deleted by the authenticated user whose `request.auth.uid == userId`, `request.auth.token.email_verified == true`, and `data.ownerUid == request.auth.uid`.
2. **Immutable Identity & Creation Time**: `uid`/`ownerUid`, `numericId`, `caseCode`, and `createdAt` must never change after document creation.
3. **Server Timestamp Integrity**: `createdAt` on create and `updatedAt` on create/update must equal `request.time`.
4. **Strict Field Allowlisting**: Every collection validates required keys with `data.keys().hasAll(...)` and allowed keys with `data.keys().hasOnly(...)`, blocking shadow RBAC fields (`role`, `isAdmin`, `isVerified`).
5. **Relational Atomicity**: `evidenceItems` and `correlations` must reference a valid `investigationDocId` that exists (or is atomically created in the same batch via `existsAfter`) under `/users/{userId}/investigations/{investigationDocId}`.
6. **Bounded Strings & Lists**: All strings and arrays enforce strict upper bounds (`.size() <= MAX`), preventing 1MB document poisoning.
7. **Scoped List Queries**: Blanket `/users` listing is denied (`allow list: if false;`), and subcollection `allow list` rules explicitly enforce `isOwner(userId) && resource.data.ownerUid == request.auth.uid`.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return `PERMISSION_DENIED`)
1. Unauthenticated read of `/users/userA` or `/users/userA/investigations/inv-1`.
2. Authenticated read/list of `/users/userB/investigations` by `userA` (cross-user access).
3. Unverified email (`email_verified: false`) attempt to create `/users/userA` or `/users/userA/investigations/inv-1`.
4. Spoofed `ownerUid` in payload (`ownerUid: "userB"`) while writing `/users/userA/investigations/inv-1`.
5. Oversized or malformed document ID (`>128` chars or containing `$` / spaces).
6. Shadow field injection (`isAdmin: true` or `role: "admin"`) during profile or investigation creation.
7. Shadow field injection (`isVerified: true`) during profile or investigation update.
8. Client-spoofed `createdAt` timestamp (`new Date("2020-01-01")`) instead of `request.time`.
9. Attempt to mutate immutable `ownerUid`, `caseCode`, `numericId`, or `createdAt` on update.
10. Oversized `title` (>200 chars), `extractedText` (>20000 chars), or unbounded `findings` (>25 items) poisoning.
11. Invalid enum value (`overallAssessment: "AdminOverride"` or `modality: "executable"`).
12. Orphaned `evidenceItems` or `correlations` create pointing to a non-existent `investigationDocId`.
