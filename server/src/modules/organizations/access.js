export async function findVerifiedMembership(db, organizationId, userId) {
  return db.organizationMembership.findFirst({
    where: { organizationId, userId, status: 'ACTIVE', organization: { is: { status: 'VERIFIED' } } },
    select: { id: true, organizationId: true, userId: true, role: true, organization: { select: { id: true, name: true, status: true } } },
  });
}
