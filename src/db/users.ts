import { eq } from 'drizzle-orm';
import { db, isDatabaseConfigured } from './index.ts';
import { getMemoryDb } from './memoryStore.ts';
import { users } from './schema.ts';

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string | null,
  photoUrl?: string | null
) {
  if (!isDatabaseConfigured) {
    const mem = getMemoryDb();
    const existing = mem.users.find((u) => u.uid === uid);
    if (existing) {
      existing.email = email;
      if (displayName !== undefined) existing.displayName = displayName ?? null;
      if (photoUrl !== undefined) existing.photoUrl = photoUrl ?? null;
      return existing;
    }
    const created = {
      id: mem.nextUserId++,
      uid,
      email,
      displayName: displayName ?? null,
      photoUrl: photoUrl ?? null,
      defaultConfidenceThreshold: 65,
      includeLimitationsInExports: true,
      analystOrganization: 'Independent Forensic Unit',
      createdAt: new Date(),
    };
    mem.users.push(created);
    return created;
  }

  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName: displayName ?? null,
        photoUrl: photoUrl ?? null,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          ...(displayName !== undefined ? { displayName } : {}),
          ...(photoUrl !== undefined ? { photoUrl } : {}),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database error in getOrCreateUser:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

export async function getUserByUid(uid: string) {
  if (!isDatabaseConfigured) {
    const mem = getMemoryDb();
    return mem.users.find((u) => u.uid === uid) ?? null;
  }

  try {
    const result = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    return result[0] ?? null;
  } catch (error) {
    console.error('Database error in getUserByUid:', error);
    throw new Error('Failed to load user profile.', { cause: error });
  }
}

export async function updateUserSettings(
  userId: number,
  updates: {
    displayName?: string;
    analystOrganization?: string;
    defaultConfidenceThreshold?: number;
    includeLimitationsInExports?: boolean;
  }
) {
  if (!isDatabaseConfigured) {
    const mem = getMemoryDb();
    const user = mem.users.find((u) => u.id === userId);
    if (!user) return undefined;
    Object.assign(user, updates);
    return user;
  }

  try {
    const result = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, userId))
      .returning();
    return result[0];
  } catch (error) {
    console.error('Database error in updateUserSettings:', error);
    throw new Error('Failed to update user settings.', { cause: error });
  }
}
