import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { medicalNotice } from '../requests/routes.js';
import { expireRequestIfNeeded, invalidatePendingDonorMatches } from '../matching/service.js';
import { createNotifications } from '../notifications/service.js';

const bloodGroupCodes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const bloodGroupSchema = z.enum(bloodGroupCodes);
const profileFields = {
  displayName: z.string().trim().min(1).max(120),
  bloodGroup: bloodGroupSchema,
  division: z.string().trim().min(1).max(80),
  district: z.string().trim().min(1).max(80),
  area: z.string().trim().min(1).max(100),
};
const profileSchema = z.object(profileFields).strict();
const availabilitySchema = z.object({ status: z.enum(['AVAILABLE', 'PAUSED']) }).strict();
const consentSchema = z.object({ consented: z.boolean() }).strict();
const opportunityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
const responseSchema = z.object({ action: z.enum(['ACCEPT', 'DECLINE', 'WITHDRAW']) }).strict();
const discoverySchema = z.object({
  bloodGroup: bloodGroupSchema,
  division: z.string().trim().min(1).max(80),
  district: z.string().trim().min(1).max(80).optional(),
  area: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict().superRefine((input, ctx) => {
  if (input.area && !input.district) ctx.addIssue({ code: 'custom', path: ['district'], message: 'Select a district before filtering by area.' });
});
const CONSENT_VERSION = 'donor-discovery-v1';

function serializeProfile(profile) {
  return {
    id: profile.id,
    displayName: profile.displayName,
    bloodGroup: profile.bloodGroup.code,
    division: profile.division,
    district: profile.district,
    area: profile.area,
    availabilityStatus: profile.availabilityStatus,
    discoveryConsent: Boolean(profile.discoveryConsentAt),
    consentUpdatedAt: profile.consentUpdatedAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

const profileSelect = {
  id: true,
  displayName: true,
  division: true,
  district: true,
  area: true,
  availabilityStatus: true,
  discoveryConsentAt: true,
  consentUpdatedAt: true,
  createdAt: true,
  updatedAt: true,
  bloodGroup: { select: { code: true } },
};

export function createDonorRouter({ prisma, requireAuth }) {
  const router = Router();
  router.use(requireAuth);
  const discoveryLimit = rateLimit({
    windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many donor discovery searches. Try again later.' } }),
  });

  router.get('/discover', discoveryLimit, async (req, res, next) => {
    try {
      const { bloodGroup: groupCode, division, district, area, page, limit } = discoverySchema.parse(req.query);
      const group = await prisma.bloodGroup.findUnique({ where: { code: groupCode }, select: { id: true } });
      if (!group) return res.status(503).json({ error: { code: 'REFERENCE_DATA_MISSING', message: 'Blood group data is unavailable.' } });
      const where = {
        bloodGroupId: group.id,
        division,
        ...(district ? { district } : {}),
        ...(area ? { area } : {}),
        availabilityStatus: 'AVAILABLE',
        discoveryConsentAt: { not: null },
        user: { is: { status: 'ACTIVE', deletedAt: null } },
      };
      const [items, total] = await Promise.all([
        prisma.donorProfile.findMany({
          where,
          select: { bloodGroup: { select: { code: true } } },
          orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.donorProfile.count({ where }),
      ]);
      const locationMatch = area ? 'AREA' : district ? 'DISTRICT' : 'DIVISION';
      res.json({
        donors: items.map((item) => ({ bloodGroup: item.bloodGroup.code, locationMatch })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        medicalNotice,
      });
    } catch (error) { next(error); }
  });

  router.get('/me/opportunities', async (req, res, next) => {
    try {
      const { page, limit } = opportunityQuerySchema.parse(req.query);
      const donor = await prisma.donorProfile.findUnique({ where: { userId: req.auth.userId }, select: { id: true } });
      if (!donor) return res.json({ opportunities: [], pagination: { page, limit, total: 0, totalPages: 0 }, medicalNotice });
      const where = { donorProfileId: donor.id };
      const [rows, total] = await Promise.all([
        prisma.requestMatch.findMany({
          where,
          include: { request: { include: { bloodGroup: { select: { code: true } } } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.requestMatch.count({ where }),
      ]);
      const now = new Date();
      for (const row of rows) {
        if (row.matchStatus !== 'NOTIFIED') continue;
        if (row.request.neededAt <= now) await expireRequestIfNeeded(prisma, row.requestId, now);
        if (row.request.status !== 'OPEN' && row.request.status !== 'PAUSED') {
          await prisma.requestMatch.updateMany({ where: { id: row.id, matchStatus: 'NOTIFIED' }, data: { matchStatus: 'CLOSED', respondedAt: now } });
        }
      }
      res.json({
        opportunities: rows.map((row) => {
          const requestClosed = row.request.status !== 'OPEN' && row.request.status !== 'PAUSED'
            || row.request.neededAt <= now;
          return {
          id: row.id,
          status: requestClosed && row.matchStatus === 'NOTIFIED' ? 'CLOSED' : row.matchStatus,
          requestStatus: row.request.status === 'OPEN' && row.request.neededAt <= now ? 'EXPIRED' : row.request.status,
          bloodGroup: row.request.bloodGroup.code,
          unitsRequested: row.request.unitsRequested,
          urgency: row.request.urgency,
          location: { division: row.request.division, district: row.request.district },
          neededAt: row.request.neededAt,
          notifiedAt: row.notifiedAt,
          respondedAt: row.respondedAt,
        }; }),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        medicalNotice,
      });
    } catch (error) { next(error); }
  });

  router.post('/me/opportunities/:matchId/respond', async (req, res, next) => {
    try {
      const matchId = z.string().uuid().parse(req.params.matchId);
      const { action } = responseSchema.parse(req.body);
      const result = await prisma.$transaction(async (tx) => {
        const donor = await tx.donorProfile.findUnique({
          where: { userId: req.auth.userId },
          select: { id: true, availabilityStatus: true, discoveryConsentAt: true, user: { select: { status: true, deletedAt: true } } },
        });
        if (!donor) return { error: 'PROFILE_NOT_FOUND', status: 404 };
        const match = await tx.requestMatch.findFirst({
          where: { id: matchId, donorProfileId: donor.id },
          include: { request: { select: { id: true, status: true, neededAt: true, requesterUserId: true } } },
        });
        if (!match) return { error: 'OPPORTUNITY_NOT_FOUND', status: 404 };
        const now = new Date();
        if (match.request.neededAt <= now && ['OPEN', 'PAUSED'].includes(match.request.status)) {
          await expireRequestIfNeeded(tx, match.requestId, now);
          return { error: 'REQUEST_EXPIRED', status: 409 };
        }
        if (match.request.status !== 'OPEN') return { error: 'REQUEST_NOT_OPEN', status: 409 };

        if (action === 'WITHDRAW') {
          if (match.matchStatus !== 'ACCEPTED') return { error: 'RESPONSE_NOT_WITHDRAWABLE', status: 409 };
          const updated = await tx.requestMatch.updateMany({
            where: { id: matchId, donorProfileId: donor.id, matchStatus: 'ACCEPTED' },
            data: { matchStatus: 'WITHDRAWN', respondedAt: now },
          });
          if (updated.count !== 1) return { error: 'RESPONSE_ALREADY_CHANGED', status: 409 };
          await createNotifications(tx, [{
            userId: match.request.requesterUserId, eventKey: `donor-response:${matchId}:WITHDRAWN`, type: 'DONOR_WITHDREW',
            title: 'A donor changed their response', message: 'A donor withdrew an earlier response to your request.',
            referenceType: 'REQUEST', referenceId: match.request.id,
          }]);
        } else {
          if (match.matchStatus !== 'NOTIFIED') return { error: 'OPPORTUNITY_ALREADY_ANSWERED', status: 409 };
          if (!donor.discoveryConsentAt || donor.availabilityStatus !== 'AVAILABLE' || donor.user.status !== 'ACTIVE' || donor.user.deletedAt) {
            await tx.requestMatch.updateMany({ where: { id: matchId, matchStatus: 'NOTIFIED' }, data: { matchStatus: 'INVALIDATED', respondedAt: now } });
            return { error: 'DONOR_NO_LONGER_ELIGIBLE', status: 409 };
          }
          const nextStatus = action === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
          const updated = await tx.requestMatch.updateMany({
            where: { id: matchId, donorProfileId: donor.id, matchStatus: 'NOTIFIED' },
            data: { matchStatus: nextStatus, respondedAt: now },
          });
          if (updated.count !== 1) return { error: 'OPPORTUNITY_ALREADY_ANSWERED', status: 409 };
          await createNotifications(tx, [{
            userId: match.request.requesterUserId, eventKey: `donor-response:${matchId}:${nextStatus}`,
            type: nextStatus === 'ACCEPTED' ? 'DONOR_ACCEPTED' : 'DONOR_DECLINED',
            title: nextStatus === 'ACCEPTED' ? 'A donor accepted your request' : 'A donor declined your request',
            message: nextStatus === 'ACCEPTED' ? 'A donor accepted your blood request opportunity.' : 'A donor declined your blood request opportunity.',
            referenceType: 'REQUEST', referenceId: match.request.id,
          }]);
        }
        const updatedMatch = await tx.requestMatch.findFirst({ where: { id: matchId, donorProfileId: donor.id }, select: { matchStatus: true, respondedAt: true } });
        return { match: updatedMatch };
      }, { isolationLevel: 'Serializable' });
      if (result.error) return res.status(result.status).json({ error: { code: result.error, message: 'This opportunity can no longer be changed.' } });
      res.json({ match: result.match });
    } catch (error) { next(error); }
  });

  router.get('/me', async (req, res, next) => {
    try {
      const profile = await prisma.donorProfile.findUnique({ where: { userId: req.auth.userId }, select: profileSelect });
      res.json({ profile: profile ? serializeProfile(profile) : null });
    } catch (error) { next(error); }
  });

  router.post('/me', async (req, res, next) => {
    try {
      const input = profileSchema.parse(req.body);
      const bloodGroup = await prisma.bloodGroup.findUnique({ where: { code: input.bloodGroup }, select: { id: true } });
      if (!bloodGroup) return res.status(503).json({ error: { code: 'REFERENCE_DATA_MISSING', message: 'Blood group data is unavailable.' } });
      const profile = await prisma.donorProfile.create({
        data: {
          userId: req.auth.userId,
          displayName: input.displayName,
          bloodGroupId: bloodGroup.id,
          division: input.division,
          district: input.district,
          area: input.area,
        },
        select: profileSelect,
      });
      res.status(201).json({ profile: serializeProfile(profile) });
    } catch (error) { next(error); }
  });

  router.put('/me', async (req, res, next) => {
    try {
      const input = profileSchema.parse(req.body);
      const existing = await prisma.donorProfile.findUnique({ where: { userId: req.auth.userId }, select: { id: true } });
      if (!existing) return res.status(404).json({ error: { code: 'PROFILE_NOT_FOUND', message: 'Create a donor profile before editing it.' } });
      const bloodGroup = await prisma.bloodGroup.findUnique({ where: { code: input.bloodGroup }, select: { id: true } });
      if (!bloodGroup) return res.status(503).json({ error: { code: 'REFERENCE_DATA_MISSING', message: 'Blood group data is unavailable.' } });
      const profile = await prisma.donorProfile.update({
        where: { userId: req.auth.userId },
        data: {
          displayName: input.displayName,
          bloodGroupId: bloodGroup.id,
          division: input.division,
          district: input.district,
          area: input.area,
        },
        select: profileSelect,
      });
      res.json({ profile: serializeProfile(profile) });
    } catch (error) { next(error); }
  });

  router.patch('/me/availability', async (req, res, next) => {
    try {
      const { status } = availabilitySchema.parse(req.body);
      const existing = await prisma.donorProfile.findUnique({ where: { userId: req.auth.userId }, select: { id: true } });
      if (!existing) return res.status(404).json({ error: { code: 'PROFILE_NOT_FOUND', message: 'Donor profile not found.' } });
      const profile = await prisma.$transaction(async (tx) => {
        const updated = await tx.donorProfile.update({ where: { userId: req.auth.userId }, data: { availabilityStatus: status }, select: profileSelect });
        if (status === 'PAUSED') await invalidatePendingDonorMatches(tx, existing.id);
        return updated;
      }, { isolationLevel: 'Serializable' });
      res.json({ profile: serializeProfile(profile) });
    } catch (error) { next(error); }
  });

  router.patch('/me/consent', async (req, res, next) => {
    try {
      const { consented } = consentSchema.parse(req.body);
      const existing = await prisma.donorProfile.findUnique({ where: { userId: req.auth.userId }, select: { id: true, consentVersion: true } });
      if (!existing) return res.status(404).json({ error: { code: 'PROFILE_NOT_FOUND', message: 'Donor profile not found.' } });
      const changedAt = new Date();
      const profile = await prisma.$transaction(async (tx) => {
        const updated = await tx.donorProfile.update({
          where: { userId: req.auth.userId },
          data: {
            discoveryConsentAt: consented ? changedAt : null,
            consentVersion: consented ? CONSENT_VERSION : existing.consentVersion,
            consentUpdatedAt: changedAt,
          },
          select: profileSelect,
        });
        if (!consented) await invalidatePendingDonorMatches(tx, existing.id);
        return updated;
      }, { isolationLevel: 'Serializable' });
      res.json({ profile: serializeProfile(profile) });
    } catch (error) { next(error); }
  });

  return router;
}
