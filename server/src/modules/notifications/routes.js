import { Router } from 'express';
import { z } from 'zod';
import { findVerifiedMembership } from '../organizations/access.js';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export function createNotificationRouter({ prisma, requireAuth }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res, next) => {
    try {
      const { page, limit } = listSchema.parse(req.query);
      const where = { userId: req.auth.userId };
      const [notifications, unreadCount, total] = await Promise.all([
        prisma.notification.findMany({
          where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit,
          select: { id: true, type: true, title: true, message: true, referenceType: true, referenceId: true, readAt: true, createdAt: true },
        }),
        prisma.notification.count({ where: { ...where, readAt: null } }),
        prisma.notification.count({ where }),
      ]);
      res.json({ notifications, unreadCount, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (error) { next(error); }
  });

  router.patch('/read-all', async (req, res, next) => {
    try {
      const result = await prisma.notification.updateMany({ where: { userId: req.auth.userId, readAt: null }, data: { readAt: new Date() } });
      res.json({ updated: result.count });
    } catch (error) { next(error); }
  });

  router.delete('/', async (req, res, next) => {
    try {
      const result = await prisma.notification.deleteMany({ where: { userId: req.auth.userId } });
      res.json({ deleted: result.count });
    } catch (error) { next(error); }
  });

  router.patch('/:id/read', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const result = await prisma.notification.updateMany({ where: { id, userId: req.auth.userId, readAt: null }, data: { readAt: new Date() } });
      if (!result.count) {
        const exists = await prisma.notification.findFirst({ where: { id, userId: req.auth.userId }, select: { id: true } });
        if (!exists) return res.status(404).json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' } });
      }
      res.json({ read: true });
    } catch (error) { next(error); }
  });

  router.post('/:id/open', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const notification = await prisma.notification.findFirst({
        where: { id, userId: req.auth.userId },
        select: { referenceType: true, referenceId: true },
      });
      if (!notification) return res.status(404).json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' } });
      const { referenceType, referenceId } = notification;
      if (!referenceId) return res.json({ destination: { view: 'notifications' } });
      if (referenceType === 'REQUEST') {
        const request = await prisma.bloodRequest.findFirst({ where: { id: referenceId, requesterUserId: req.auth.userId }, select: { id: true } });
        let organizationAccess = false;
        if (!request && req.auth.isAdmin) organizationAccess = true;
        if (!request && !organizationAccess) {
          const linked = await prisma.bloodRequest.findUnique({ where: { id: referenceId }, select: { organizationId: true } });
          if (linked?.organizationId) organizationAccess = Boolean(await findVerifiedMembership(prisma, linked.organizationId, req.auth.userId));
        }
        if (!request && !organizationAccess) return res.status(404).json({ error: { code: 'REFERENCE_NOT_FOUND', message: 'Referenced item is unavailable.' } });
        return res.json({ destination: { view: 'requests', id: referenceId } });
      }
      if (referenceType === 'OPPORTUNITY') {
        const match = await prisma.requestMatch.findFirst({ where: { id: referenceId, donorProfile: { is: { userId: req.auth.userId } } }, select: { id: true } });
        if (!match) return res.status(404).json({ error: { code: 'REFERENCE_NOT_FOUND', message: 'Referenced item is unavailable.' } });
        return res.json({ destination: { view: 'opportunities', id: referenceId } });
      }
      if (referenceType === 'ORGANIZATION') {
        const organization = await prisma.organization.findUnique({ where: { id: referenceId }, select: { id: true } });
        const member = await prisma.organizationMembership.findFirst({ where: { organizationId: referenceId, userId: req.auth.userId, status: 'ACTIVE' }, select: { id: true } });
        if (req.auth.isAdmin) return res.json({ destination: { view: 'admin-organizations', id: referenceId } });
        if (!organization || !member) return res.status(404).json({ error: { code: 'ORGANIZATION_REFERENCE_NOT_FOUND', message: 'This organization application is unavailable to your account. Return to notifications to open another item.' } });
        return res.json({ destination: { view: 'organization', id: referenceId } });
      }
      res.json({ destination: { view: 'notifications' } });
    } catch (error) { next(error); }
  });

  return router;
}
