export async function createNotifications(db, records) {
  if (!records.length || !db.notification) return { count: 0 };
  return db.notification.createMany({ data: records, skipDuplicates: true });
}

export async function notifyOrganizationMembers(db, organizationId, { eventKey, type, title, message, referenceType = 'ORGANIZATION', referenceId = organizationId }) {
  const memberships = await db.organizationMembership.findMany({
    where: { organizationId, status: 'ACTIVE' },
    select: { userId: true },
  });
  return createNotifications(db, memberships.map(({ userId }) => ({
    userId, eventKey: `${eventKey}:${userId}`, type, title, message, referenceType, referenceId,
  })));
}

export async function notifyRequestStatus(db, requestId, status, updatedAt) {
  if (!db.notification) return { count: 0 };
  const request = await db.bloodRequest.findUnique({ where: { id: requestId }, select: { id: true, requesterUserId: true } });
  if (!request) return { count: 0 };
  const matches = await db.requestMatch.findMany({
    where: { requestId },
    select: { id: true, donorProfile: { select: { userId: true } } },
  });
  const labels = { PAUSED: 'paused', OPEN: 'reopened', CANCELLED: 'cancelled', CLOSED: 'closed', FULFILLED: 'fulfilled', EXPIRED: 'expired' };
  const label = labels[status];
  if (!label) return { count: 0 };
  const key = `request:${requestId}:status:${status}:${new Date(updatedAt).getTime()}`;
  const recipients = new Map([[request.requesterUserId, { referenceType: 'REQUEST', referenceId: requestId }]]);
  for (const match of matches) if (!recipients.has(match.donorProfile.userId)) {
    recipients.set(match.donorProfile.userId, { referenceType: 'OPPORTUNITY', referenceId: match.id });
  }
  return createNotifications(db, [...recipients].map(([userId, reference]) => ({
    userId, eventKey: `${key}:${userId}`, type: 'REQUEST_STATUS', title: `A blood request was ${label}`,
    message: `A request opportunity you received was ${label}.`, ...reference,
  })));
}
