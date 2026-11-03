import { Router } from 'express';
import { z } from 'zod';
import { findVerifiedMembership } from './access.js';
import { generatePotentialMatches } from '../matching/service.js';
import { createNotifications, notifyOrganizationMembers } from '../notifications/service.js';

const organizationSchema = z.object({
  name: z.string().trim().min(2).max(180),
  type: z.enum(['HOSPITAL', 'BLOOD_BANK']),
  registrationNumber: z.string().trim().min(2).max(80),
  division: z.string().trim().min(1).max(80),
  district: z.string().trim().min(1).max(80),
  area: z.string().trim().min(1).max(100),
  publicContactPhone: z.string().trim().min(6).max(32),
  verificationInfo: z.string().trim().max(1000).optional(),
}).strict();
const requestSchema = z.object({
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
  unitsRequested: z.number().int().min(1).max(1000),
  division: z.string().trim().min(1).max(80), district: z.string().trim().min(1).max(80), area: z.string().trim().min(1).max(100),
  urgency: z.enum(['URGENT', 'SCHEDULED']), neededAt: z.string().datetime({ offset: true }),
  facilityName: z.preprocess((value) => value === '' ? undefined : value, z.string().trim().max(180).optional()),
  publicNote: z.preprocess((value) => value === '' ? undefined : value, z.string().trim().max(500).optional()),
}).strict();

const organizationSelect = { id: true, name: true, type: true, registrationNumber: true, division: true, district: true, area: true, publicContactPhone: true, verificationInfo: true, status: true, createdAt: true, updatedAt: true };
const requestSelect = { id: true, bloodGroup: { select: { code: true } }, unitsRequested: true, division: true, district: true, area: true, urgency: true, neededAt: true, status: true, createdAt: true, updatedAt: true };

export function createOrganizationRouter({ prisma, requireAuth }) {
  const router = Router();
  router.use(requireAuth);

  router.post('/', async (req, res, next) => {
    try {
      const input = organizationSchema.parse(req.body);
      const registrationNumber = input.registrationNumber.toUpperCase();
      const result = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({ data: {
          ...input, registrationNumber, createdByUserId: req.auth.userId, status: 'PENDING',
        } });
        await tx.organizationMembership.create({ data: { organizationId: organization.id, userId: req.auth.userId, role: 'OWNER', status: 'ACTIVE' } });
        await tx.organizationVerificationEvent.create({ data: {
          organizationId: organization.id, actorUserId: req.auth.userId, action: 'SUBMITTED', fromStatus: null, toStatus: 'PENDING',
        } });
        const admins = await tx.adminAccount.findMany({ where: { revokedAt: null, user: { is: { status: 'ACTIVE', deletedAt: null } } }, select: { userId: true } });
        await createNotifications(tx, admins.map(({ userId }) => ({
          userId, eventKey: `organization:${organization.id}:submitted:${userId}`, type: 'ORGANIZATION_SUBMITTED',
          title: 'Organization verification requested', message: 'A new organization application is ready for review.',
          referenceType: 'ORGANIZATION', referenceId: organization.id,
        })));
        return organization;
      });
      res.status(201).json({ organization: result });
    } catch (error) {
      if (error?.code === 'P2002') return res.status(409).json({ error: { code: 'REGISTRATION_NUMBER_EXISTS', message: 'An organization with that registration number is already registered.' } });
      next(error);
    }
  });

  router.get('/mine', async (req, res, next) => {
    try {
      const memberships = await prisma.organizationMembership.findMany({
        where: { userId: req.auth.userId, status: 'ACTIVE' },
        select: { role: true, status: true, organization: { select: organizationSelect } },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ organizations: memberships.map(({ role, status, organization }) => ({ ...organization, membership: { role, status } })) });
    } catch (error) { next(error); }
  });

  router.get('/mine/:organizationId/dashboard', async (req, res, next) => {
    try {
      const organizationId = z.string().uuid().parse(req.params.organizationId);
      const membership = await prisma.organizationMembership.findFirst({
        where: { organizationId, userId: req.auth.userId, status: 'ACTIVE' },
        include: { organization: { select: organizationSelect } },
      });
      if (!membership) return res.status(404).json({ error: { code: 'ORGANIZATION_NOT_FOUND', message: 'Organization is unavailable.' } });
      const [staff, requests, history] = await Promise.all([
        prisma.organizationMembership.findMany({ where: { organizationId, status: 'ACTIVE' }, select: { role: true, user: { select: { fullName: true } } }, orderBy: { createdAt: 'asc' } }),
        prisma.bloodRequest.findMany({ where: { organizationId }, select: requestSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 50 }),
        prisma.organizationVerificationEvent.findMany({ where: { organizationId }, select: { action: true, fromStatus: true, toStatus: true, reason: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
      ]);
      const requestStatusCounts = Object.fromEntries(['OPEN', 'PAUSED', 'CANCELLED', 'CLOSED', 'EXPIRED', 'FULFILLED'].map((status) => [status, requests.filter((item) => item.status === status).length]));
      const requestActivity = requests.map((request) => ({ action: 'REQUEST_CREATED', fromStatus: null, toStatus: request.status, reason: null, createdAt: request.createdAt }));
      const activity = [...history, ...requestActivity].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20);
      res.json({ organization: membership.organization, membership: { role: membership.role }, staff, requests: requests.map((request) => ({ ...request, bloodGroup: request.bloodGroup.code })), requestStatusCounts, activity });
    } catch (error) { next(error); }
  });

  router.post('/mine/:organizationId/requests', async (req, res, next) => {
    try {
      const organizationId = z.string().uuid().parse(req.params.organizationId);
      const input = requestSchema.parse(req.body);
      const membership = await findVerifiedMembership(prisma, organizationId, req.auth.userId);
      if (!membership) return res.status(403).json({ error: { code: 'ORGANIZATION_NOT_VERIFIED', message: 'Only active members of verified organizations may create organization requests.' } });
      const result = await prisma.$transaction(async (tx) => {
        const group = await tx.bloodGroup.findUnique({ where: { code: input.bloodGroup }, select: { id: true } });
        if (!group) return null;
        const request = await tx.bloodRequest.create({ data: {
          organizationId, requesterUserId: req.auth.userId, bloodGroupId: group.id, unitsRequested: input.unitsRequested,
          division: input.division, district: input.district, area: input.area, urgency: input.urgency,
          neededAt: new Date(input.neededAt), facilityName: input.facilityName, publicNote: input.publicNote,
        } });
        const matching = await generatePotentialMatches(tx, request.id);
        const record = await tx.bloodRequest.findUnique({ where: { id: request.id }, select: requestSelect });
        return { request: record, matching };
      }, { isolationLevel: 'Serializable' });
      if (!result) return res.status(503).json({ error: { code: 'REFERENCE_DATA_MISSING', message: 'Blood group data is unavailable.' } });
      res.status(201).json({ request: { ...result.request, bloodGroup: result.request.bloodGroup.code }, matching: result.matching });
    } catch (error) { next(error); }
  });

  return router;
}

export function createOrganizationAdminRouter({ prisma, requireAuth, requireAdmin }) {
  const router = Router();
  router.use(requireAuth, requireAdmin);

  router.get('/', async (req, res, next) => {
    try {
      const status = req.query.status ? z.enum(['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED']).parse(req.query.status) : 'PENDING';
      const organizations = await prisma.organization.findMany({ where: { status }, select: organizationSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      res.json({ organizations });
    } catch (error) { next(error); }
  });

  router.get('/:organizationId', async (req, res, next) => {
    try {
      const organizationId = z.string().uuid().parse(req.params.organizationId);
      const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: {
        ...organizationSelect,
        creator: { select: { fullName: true, email: true } },
        verificationHistory: { select: { action: true, fromStatus: true, toStatus: true, reason: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
      } });
      if (!organization) return res.status(404).json({ error: { code: 'ORGANIZATION_NOT_FOUND', message: 'Organization not found.' } });
      res.json({ organization });
    } catch (error) { next(error); }
  });

  router.patch('/:organizationId/decision', async (req, res, next) => {
    try {
      const organizationId = z.string().uuid().parse(req.params.organizationId);
      const { action, reason } = z.object({
        action: z.enum(['APPROVE', 'REJECT', 'SUSPEND']),
        reason: z.string().trim().max(500).optional(),
      }).strict().refine((value) => value.action === 'APPROVE' || Boolean(value.reason?.length), { message: 'A reason is required for rejection or suspension.', path: ['reason'] }).parse(req.body);
      const result = await prisma.$transaction(async (tx) => {
        const current = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true, status: true } });
        if (!current) return { error: 'NOT_FOUND', status: 404 };
        const transitions = { APPROVE: ['PENDING', 'VERIFIED'], REJECT: ['PENDING', 'REJECTED'], SUSPEND: ['VERIFIED', 'SUSPENDED'] };
        if (current.status !== transitions[action][0]) return { error: 'INVALID_TRANSITION', status: 409 };
        const toStatus = transitions[action][1];
        const event = await tx.organizationVerificationEvent.create({ data: {
          organizationId, actorUserId: req.auth.userId, action: action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'SUSPENDED',
          fromStatus: current.status, toStatus, reason,
        } });
        await tx.organization.update({ where: { id: organizationId }, data: { status: toStatus } });
        const notificationType = { APPROVE: 'ORGANIZATION_APPROVED', REJECT: 'ORGANIZATION_REJECTED', SUSPEND: 'ORGANIZATION_SUSPENDED' }[action];
        const message = action === 'APPROVE' ? 'Your organization has been verified.' : action === 'REJECT' ? 'Your organization application was not approved. Sign in to review the application status.' : 'Your organization access was suspended. Sign in to review the organization status.';
        await notifyOrganizationMembers(tx, organizationId, {
          eventKey: `organization:${organizationId}:verification-event:${event.id}`, type: notificationType,
          title: { APPROVE: 'Organization verified', REJECT: 'Organization application update', SUSPEND: 'Organization suspended' }[action],
          message,
        });
        const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: organizationSelect });
        return { organization };
      }, { isolationLevel: 'Serializable' });
      if (result.error) return res.status(result.status).json({ error: { code: result.error, message: 'The requested verification change is not available.' } });
      res.json({ organization: result.organization });
    } catch (error) { next(error); }
  });

  return router;
}
