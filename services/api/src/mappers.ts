// Row (snake_case) → contract shape (camelCase, @faze/shared).
import type { Card, CardSet, PublicUser, Submission, Trade, User } from "@faze/shared";

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

export function toUser(r: any): User {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    displayNameStatus: r.display_name_status,
    role: r.role,
    demo: r.demo,
    createdAt: iso(r.created_at)!,
  };
}

/** What other fans may see: unapproved display names are hidden. */
export function toPublicUser(r: { id: string; display_name: string; display_name_status: string }): PublicUser {
  return { id: r.id, displayName: r.display_name_status === "approved" ? r.display_name : "New collector" };
}

export function toCard(r: any): Card {
  return {
    id: r.id,
    setId: r.set_id,
    name: r.name,
    fazeMember: r.faze_member,
    rarity: r.rarity,
    artUrl: r.art_url,
    basePower: r.base_power,
    maxSupply: r.max_supply,
    demo: r.demo,
  };
}

export function toSet(r: any): CardSet {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    status: r.status,
    demo: r.demo,
    publishedAt: iso(r.published_at),
  };
}

export function toSubmission(r: any): Submission {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    refId: r.ref_id,
    payload: r.payload,
    status: r.status,
    autoFlags: r.auto_flags,
    reviewedBy: r.reviewed_by,
    reviewedAt: iso(r.reviewed_at),
    createdAt: iso(r.created_at)!,
  };
}

/** viewerId: messages that are not approved are visible only to the sender. */
export function toTrade(r: any, from: PublicUser, to: PublicUser, viewerId: string): Trade {
  const showMsg = r.message_status === "approved" || viewerId === r.from_user_id;
  return {
    id: r.id,
    fromUser: from,
    toUser: to,
    offeredInstanceIds: r.offered_instance_ids,
    requestedInstanceIds: r.requested_instance_ids,
    message: showMsg ? r.message : null,
    messageStatus: r.message_status,
    status: r.status,
    createdAt: iso(r.created_at)!,
    resolvedAt: iso(r.resolved_at),
  };
}
