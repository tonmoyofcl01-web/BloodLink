import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { medicalNotice } from '../requests/routes.js';

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
      const profile = await prisma.donorProfile.update({ where: { userId: req.auth.userId }, data: { availabilityStatus: status }, select: profileSelect });
      res.json({ profile: serializeProfile(profile) });
    } catch (error) { next(error); }
  });

  router.patch('/me/consent', async (req, res, next) => {
    try {
      const { consented } = consentSchema.parse(req.body);
      const existing = await prisma.donorProfile.findUnique({ where: { userId: req.auth.userId }, select: { id: true, consentVersion: true } });
      if (!existing) return res.status(404).json({ error: { code: 'PROFILE_NOT_FOUND', message: 'Donor profile not found.' } });
      const changedAt = new Date();
      const profile = await prisma.donorProfile.update({
        where: { userId: req.auth.userId },
        data: {
          discoveryConsentAt: consented ? changedAt : null,
          consentVersion: consented ? CONSENT_VERSION : existing.consentVersion,
          consentUpdatedAt: changedAt,
        },
        select: profileSelect,
      });
      res.json({ profile: serializeProfile(profile) });
    } catch (error) { next(error); }
  });

  return router;
}
