import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

try {
  for (const code of bloodGroups) {
    await prisma.bloodGroup.upsert({
      where: { code },
      update: { displayName: code },
      create: { code, displayName: code },
    });
  }
  console.info(`Ensured ${bloodGroups.length} blood groups exist.`);
} finally {
  await prisma.$disconnect();
}
