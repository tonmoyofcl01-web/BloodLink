import { createHash } from 'node:crypto';
import { createNotifications, notifyRequestStatus } from '../notifications/service.js';

export function normalizeLocation(value) {
  return String(value).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function tieBreak(requestId, donorProfileId) {
  return createHash('sha256').update(`${requestId}:${donorProfileId}`).digest('hex');
}

function locationRank(request, donor) {
  if (normalizeLocation(request.division) !== normalizeLocation(donor.division)) return 0;
  if (normalizeLocation(request.district) !== normalizeLocation(donor.district)) return 1;
  if (normalizeLocation(request.area) === normalizeLocation(donor.area)) return 3;
  return 2;
}

export async function closePendingMatches(db, requestId, status = 'CLOSED') {
  return db.requestMatch.updateMany({
    where: { requestId, matchStatus: 'NOTIFIED' },
    data: { matchStatus: status, respondedAt: new Date() },
  });
}

export async function invalidatePendingDonorMatches(db, donorProfileId) {
  return db.requestMatch.updateMany({
    where: { donorProfileId, matchStatus: 'NOTIFIED' },
    data: { matchStatus: 'INVALIDATED', respondedAt: new Date() },
  });
}

export async function expireRequestIfNeeded(db, requestId, now = new Date()) {
  const request = await db.bloodRequest.findUnique({ where: { id: requestId }, select: { id: true, status: true, neededAt: true } });
  if (!request || !['OPEN', 'PAUSED'].includes(request.status) || request.neededAt > now) return false;
  const expired = await db.bloodRequest.updateMany({
    where: { id: requestId, status: request.status, neededAt: { lte: now } },
    data: { status: 'EXPIRED', closedAt: now },
  });
  if (expired.count) {
    await closePendingMatches(db, requestId, 'CLOSED');
    const updated = await db.bloodRequest.findUnique({ where: { id: requestId }, select: { updatedAt: true } });
    await notifyRequestStatus(db, requestId, 'EXPIRED', updated?.updatedAt || now);
  }
  return expired.count === 1;
}

export async function generatePotentialMatches(db, requestId, now = new Date()) {
  await expireRequestIfNeeded(db, requestId, now);
  const request = await db.bloodRequest.findUnique({
    where: { id: requestId },
    select: { id: true, bloodGroupId: true, division: true, district: true, area: true, status: true, neededAt: true },
  });
  if (!request) return { candidates: 0, created: 0 };
  if (['CANCELLED', 'CLOSED', 'EXPIRED'].includes(request.status)) {
    await closePendingMatches(db, requestId, 'CLOSED');
    return { candidates: 0, created: 0 };
  }
  if (request.status !== 'OPEN' || request.neededAt <= now) return { candidates: 0, created: 0 };

  const donors = await db.donorProfile.findMany({
    where: {
      bloodGroupId: request.bloodGroupId,
      availabilityStatus: 'AVAILABLE',
      discoveryConsentAt: { not: null },
      user: { is: { status: 'ACTIVE', deletedAt: null } },
    },
    select: {
      id: true,
      userId: true,
      bloodGroupId: true,
      division: true,
      district: true,
      area: true,
      availabilityStatus: true,
      discoveryConsentAt: true,
      user: { select: { status: true, deletedAt: true } },
    },
  });

  const ranked = donors
    .filter((donor) => donor.bloodGroupId === request.bloodGroupId
      && donor.availabilityStatus === 'AVAILABLE'
      && Boolean(donor.discoveryConsentAt)
      && donor.user?.status === 'ACTIVE'
      && donor.user.deletedAt === null)
    .map((donor) => ({ donor, locationRank: locationRank(request, donor) }))
    .filter((item) => item.locationRank > 0);
  if (ranked.length === 0) return { candidates: 0, created: 0 };

  const donorIds = ranked.map(({ donor }) => donor.id);
  const history = await db.requestMatch.findMany({
    where: { donorProfileId: { in: donorIds } },
    select: { donorProfileId: true, notifiedAt: true },
  });
  const historyByDonor = new Map();
  for (const entry of history) {
    const state = historyByDonor.get(entry.donorProfileId) || { count: 0, lastNotifiedAt: null };
    state.count += 1;
    if (!state.lastNotifiedAt || entry.notifiedAt > state.lastNotifiedAt) state.lastNotifiedAt = entry.notifiedAt;
    historyByDonor.set(entry.donorProfileId, state);
  }

  for (const item of ranked) {
    item.history = historyByDonor.get(item.donor.id) || { count: 0, lastNotifiedAt: null };
    item.rotationTie = tieBreak(requestId, item.donor.id);
  }
  ranked.sort((a, b) => b.locationRank - a.locationRank
    || a.history.count - b.history.count
    || (a.history.lastNotifiedAt?.getTime() ?? 0) - (b.history.lastNotifiedAt?.getTime() ?? 0)
    || a.rotationTie.localeCompare(b.rotationTie)
    || a.donor.id.localeCompare(b.donor.id));

  const notifiedAt = now;
  const created = await db.requestMatch.createMany({
    skipDuplicates: true,
    data: ranked.map((item, tieBreakOrder) => ({
      requestId,
      donorProfileId: item.donor.id,
      matchStatus: 'NOTIFIED',
      locationRank: item.locationRank,
      priorNotificationCount: item.history.count,
      lastPriorNotifiedAt: item.history.lastNotifiedAt,
      rankFactors: {
        location: item.locationRank === 3 ? 'EXACT_AREA' : item.locationRank === 2 ? 'DISTRICT' : 'DIVISION',
        fairness: 'LOWEST_PRIOR_CONTACTS_THEN_OLDEST_CONTACT_THEN_REQUEST_SEEDED_TIE_BREAK',
        priorNotificationCount: item.history.count,
        lastPriorNotifiedAt: item.history.lastNotifiedAt?.toISOString() || null,
        tieBreakOrder,
      },
      notifiedAt,
    })),
  });
  const savedMatches = await db.requestMatch.findMany({
    where: { requestId, donorProfileId: { in: donorIds } },
    select: { id: true, donorProfileId: true },
  });
  const donorUserByProfile = new Map(ranked.map(({ donor }) => [donor.id, donor.userId]));
  await createNotifications(db, savedMatches.map((match) => ({
    userId: donorUserByProfile.get(match.donorProfileId),
    eventKey: `donor-opportunity:${requestId}:${match.donorProfileId}`,
    type: 'DONOR_OPPORTUNITY', title: 'A blood request may need your help',
    message: 'A new request matches your donor profile. Review the opportunity to respond.',
    referenceType: 'OPPORTUNITY', referenceId: match.id,
  })).filter((item) => item.userId));
  return { candidates: ranked.length, created: created.count };
}

export function matchSummary(rows) {
  const count = (status) => rows.filter((row) => row.matchStatus === status).length;
  return {
    potentialMatches: rows.length,
    notified: rows.filter((row) => row.notifiedAt).length,
    accepted: count('ACCEPTED'),
    declined: count('DECLINED'),
    pending: count('NOTIFIED'),
    withdrawn: count('WITHDRAWN'),
    invalidated: count('INVALIDATED'),
    closed: count('CLOSED'),
  };
}
