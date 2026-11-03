import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { closePendingMatches, expireRequestIfNeeded, generatePotentialMatches, matchSummary } from '../matching/service.js';
import { notifyRequestStatus } from '../notifications/service.js';

const urgencyValues = ['URGENT', 'SCHEDULED'];
const statusValues = ['OPEN', 'PAUSED', 'CANCELLED', 'CLOSED', 'EXPIRED', 'FULFILLED'];
const bloodGroupValues = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const requestSchema = z.object({
  bloodGroup: z.enum(bloodGroupValues),
  unitsRequested: z.number().int().min(1).max(1000),
  division: z.string().trim().min(1).max(80),
  district: z.string().trim().min(1).max(80),
  area: z.string().trim().min(1).max(100),
  urgency: z.enum(urgencyValues),
  neededAt: z.string().datetime({ offset: true }),
  facilityName: z.preprocess((value) => value === '' ? undefined : value, z.string().trim().max(180).optional()),
  publicNote: z.preprocess((value) => value === '' ? undefined : value, z.string().trim().max(500).optional()),
}).strict();
const listSchema = z.object({
  status: z.enum(statusValues).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
}).strict();
const requesterTransitionSchema = z.object({ status: z.enum(['OPEN', 'PAUSED', 'CANCELLED', 'CLOSED', 'FULFILLED']) }).strict();
const requestSelect = {
  id: true,
  bloodGroup: { select: { code: true } },
  unitsRequested: true,
  division: true,
  district: true,
  area: true,
  urgency: true,
  neededAt: true,
  facilityName: true,
  publicNote: true,
  status: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
};
const transitions = {
  OPEN: ['PAUSED', 'CANCELLED', 'CLOSED', 'FULFILLED'],
  PAUSED: ['OPEN', 'CANCELLED', 'CLOSED', 'FULFILLED'],
  CANCELLED: [],
  CLOSED: [], FULFILLED: [],
};

function serializeRequest(request) {
  return { ...request, bloodGroup: request.bloodGroup.code };
}

export const medicalNotice = 'Potential donor candidates are not medical approval. Qualified medical professionals must verify donor suitability and blood compatibility.';

export function createRequestRouter({ prisma, requireAuth }) {
  const router = Router();
  router.use(requireAuth);
  const createLimit = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests created. Try again later.' } }),
  });

  router.post('/', createLimit, async (req, res, next) => {
    try {
      const input = requestSchema.parse(req.body);
      const transactionResult = await prisma.$transaction(async (tx) => {
        const group = await tx.bloodGroup.findUnique({ where: { code: input.bloodGroup }, select: { id: true } });
        if (!group) return { missingBloodGroup: true };
        const created = await tx.bloodRequest.create({
          data: {
            requesterUserId: req.auth.userId,
            bloodGroupId: group.id,
            unitsRequested: input.unitsRequested,
            division: input.division,
            district: input.district,
            area: input.area,
            urgency: input.urgency,
            neededAt: new Date(input.neededAt),
            facilityName: input.facilityName,
            publicNote: input.publicNote,
          },
          select: requestSelect,
        });
        const matchingResult = await generatePotentialMatches(tx, created.id);
        const finalRequest = await tx.bloodRequest.findUnique({ where: { id: created.id }, select: requestSelect });
        return { request: finalRequest, matching: matchingResult };
      }, { isolationLevel: 'Serializable' });
      if (transactionResult.missingBloodGroup) return res.status(503).json({ error: { code: 'REFERENCE_DATA_MISSING', message: 'Blood group data is unavailable.' } });
      res.status(201).json({ request: serializeRequest(transactionResult.request), matching: transactionResult.matching });
    } catch (error) { next(error); }
  });

  router.get('/mine', async (req, res, next) => {
    try {
      const { status, page, limit } = listSchema.parse(req.query);
      const where = { requesterUserId: req.auth.userId, ...(status ? { status } : {}) };
      const [items, total] = await Promise.all([
        prisma.bloodRequest.findMany({ where, select: requestSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
        prisma.bloodRequest.count({ where }),
      ]);
      res.json({ requests: items.map(serializeRequest), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (error) { next(error); }
  });

  router.get('/:id/matches', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const request = await prisma.bloodRequest.findFirst({ where: { id, requesterUserId: req.auth.userId }, select: { id: true } });
      if (!request) return res.status(404).json({ error: { code: 'REQUEST_NOT_FOUND', message: 'Blood request not found.' } });
      await expireRequestIfNeeded(prisma, id);
      const rows = await prisma.requestMatch.findMany({
        where: { requestId: id },
        select: { matchStatus: true, locationRank: true, notifiedAt: true, respondedAt: true, updatedAt: true },
        orderBy: [{ locationRank: 'desc' }, { createdAt: 'asc' }],
      });
      res.json({
        counts: matchSummary(rows),
        matches: rows.map((row) => ({
          status: row.matchStatus,
          locationMatch: row.locationRank === 3 ? 'AREA' : row.locationRank === 2 ? 'DISTRICT' : 'DIVISION',
          notifiedAt: row.notifiedAt,
          respondedAt: row.respondedAt,
          updatedAt: row.updatedAt,
        })),
        medicalNotice: 'Potential donor matches are not medical approval. Qualified medical professionals must verify donor suitability and blood compatibility.',
      });
    } catch (error) { next(error); }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const request = await prisma.bloodRequest.findFirst({ where: { id, requesterUserId: req.auth.userId }, select: requestSelect });
      if (!request) return res.status(404).json({ error: { code: 'REQUEST_NOT_FOUND', message: 'Blood request not found.' } });
      res.json({ request: serializeRequest(request) });
    } catch (error) { next(error); }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const input = requestSchema.parse(req.body);
      const existing = await prisma.bloodRequest.findFirst({ where: { id, requesterUserId: req.auth.userId }, select: { id: true, status: true } });
      if (!existing) return res.status(404).json({ error: { code: 'REQUEST_NOT_FOUND', message: 'Blood request not found.' } });
      if (!['OPEN', 'PAUSED'].includes(existing.status)) return res.status(409).json({ error: { code: 'REQUEST_NOT_EDITABLE', message: 'Only open or paused requests can be edited.' } });
      const group = await prisma.bloodGroup.findUnique({ where: { code: input.bloodGroup }, select: { id: true } });
      if (!group) return res.status(503).json({ error: { code: 'REFERENCE_DATA_MISSING', message: 'Blood group data is unavailable.' } });
      await prisma.bloodRequest.update({ where: { id }, data: {
        bloodGroupId: group.id, unitsRequested: input.unitsRequested,
        division: input.division, district: input.district, area: input.area,
        urgency: input.urgency, neededAt: new Date(input.neededAt),
        facilityName: input.facilityName, publicNote: input.publicNote,
      } });
      const matching = existing.status === 'OPEN' ? await generatePotentialMatches(prisma, id) : null;
      const request = await prisma.bloodRequest.findFirst({ where: { id, requesterUserId: req.auth.userId }, select: requestSelect });
      res.json({ request: serializeRequest(request), matching });
    } catch (error) { next(error); }
  });

  router.patch('/:id/status', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const { status } = requesterTransitionSchema.parse(req.body);
      const existing = await prisma.bloodRequest.findFirst({ where: { id, requesterUserId: req.auth.userId }, select: { id: true, status: true } });
      if (!existing) return res.status(404).json({ error: { code: 'REQUEST_NOT_FOUND', message: 'Blood request not found.' } });
      if (!transitions[existing.status].includes(status)) return res.status(409).json({ error: { code: 'INVALID_STATUS_TRANSITION', message: `Cannot change a ${existing.status.toLowerCase()} request to ${status.toLowerCase()}.` } });
      const changed = await prisma.bloodRequest.updateMany({
        where: { id, requesterUserId: req.auth.userId, status: existing.status },
        data: { status, closedAt: ['CANCELLED', 'CLOSED', 'FULFILLED'].includes(status) ? new Date() : null },
      });
      if (changed.count !== 1) return res.status(409).json({ error: { code: 'INVALID_STATUS_TRANSITION', message: 'Request status changed; reload and try again.' } });
      let matching = null;
      if (status === 'OPEN') matching = await generatePotentialMatches(prisma, id);
      if (['CANCELLED', 'CLOSED', 'FULFILLED'].includes(status)) await closePendingMatches(prisma, id, 'CLOSED');
      const request = await prisma.bloodRequest.findFirst({ where: { id, requesterUserId: req.auth.userId }, select: requestSelect });
      await notifyRequestStatus(prisma, id, status, request.updatedAt);
      res.json({ request: serializeRequest(request), matching });
    } catch (error) { next(error); }
  });

  return router;
}
