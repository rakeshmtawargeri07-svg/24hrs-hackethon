# Security Specification & Payload TDD (`firestore.rules`)

## 1. Data Invariants
1. **Identity Ownership**: A `/users/{userId}` document may only be read, created, or updated by the authenticated user whose `request.auth.uid == userId` and whose `request.auth.token.email_verified == true`.
2. **Immutable Identity & Creation Time**: `uid` and `createdAt` must never change after document creation (`incoming().uid == existing().uid` and `incoming().createdAt == existing().createdAt`).
3. **Server Timestamp Integrity**: `createdAt` on create and `updatedAt` on create/update must equal `request.time`.
4. **Strict Field Allowlisting**: Only `uid`, `email`, `displayName`, `photoUrl`, `provider`, `createdAt`, `updatedAt` are allowed; no shadow RBAC fields (`role`, `isAdmin`, `isVerified`) are permitted.
5. **No Blanket List / Cross-User Reads**: Listing `/users` is denied (`allow list: if false;`), preventing user PII enumeration.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return `PERMISSION_DENIED`)
1. Unauthenticated read of `/users/userA`.
2. Authenticated read of `/users/userB` by `userA` (cross-user PII read).
3. Unverified email (`email_verified: false`) attempt to create `/users/userA`.
4. Spoofed `uid` in payload (`uid: "userB"`) while writing `/users/userA`.
5. Oversized `userId` document ID (>128 chars or containing invalid characters like `$` or spaces).
6. Shadow field injection (`isAdmin: true` or `role: "admin"`) during profile creation.
7. Shadow field injection (`isVerified: true`) during profile update.
8. Client-spoofed `createdAt` timestamp (`new Date("2020-01-01")`) instead of `request.time`.
9. Attempt to mutate immutable `uid` or `createdAt` on update.
10. Oversized `displayName` (>120 chars) or `photoUrl` (>1024 chars) value poisoning.
11. Invalid `provider` value (`provider: "password"`) instead of `"google.com"`.
12. Query/list attempt on `/users` collection by an authenticated user.
