import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

async function main() {
  console.log(`Start seeding ...`);

  // !!! REPLACE THIS WITH YOUR ACTUAL OID AFTER SIGNING IN !!!
  const userOid = '6e7e4701-8097-4f29-bcc7-68681a4b07cf'; 
  const userDisplayName = 'Philip Jönsson';
  const userEmail = 'philip.jonsson@example.com';

  // Create a User
  const user = await prisma.user.upsert({
    where: { oid: userOid },
    update: {
      displayName: userDisplayName,
      email: userEmail,
    },
    create: {
      oid: userOid,
      displayName: userDisplayName,
      email: userEmail,
    },
  });
  console.log(`Created/updated user ${user.displayName} with OID ${user.oid}`);

  // Create Projects
  const project1 = await prisma.project.upsert({
    where: { name: 'Project Alpha' }, // Assuming project names are unique for upsert
    update: {},
    create: {
      name: 'Project Alpha',
      description: 'This is the first sample project.',
    },
  });
  console.log(`Created/updated project ${project1.name}`);

  const project2 = await prisma.project.upsert({
    where: { name: 'Project Beta' },
    update: {},
    create: {
      name: 'Project Beta',
      description: 'This is the second sample project.',
    },
  });
  console.log(`Created/updated project ${project2.name}`);

  // Link User to Projects
  await prisma.userProject.upsert({
    where: { userId_projectId: { userId: user.id, projectId: project1.id } },
    update: {},
    create: {
      userId: user.id,
      projectId: project1.id,
      assignedBy: 'seed-script',
    },
  });
  console.log(`Linked user ${user.displayName} to project ${project1.name}`);

  await prisma.userProject.upsert({
    where: { userId_projectId: { userId: user.id, projectId: project2.id } },
    update: {},
    create: {
      userId: user.id,
      projectId: project2.id,
      assignedBy: 'seed-script',
    },
  });
  console.log(`Linked user ${user.displayName} to project ${project2.name}`);

  console.log(`Seeding finished.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 