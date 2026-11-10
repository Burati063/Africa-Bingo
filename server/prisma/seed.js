import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_SETTINGS } from '../src/settings.js';

const prisma = new PrismaClient();

async function main() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.platformSetting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }

  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@bingo.et').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@12345';
  await prisma.staffAccount.upsert({
    where: { email: adminEmail },
    update: { passwordHash: await bcrypt.hash(adminPassword, 10), role: 'admin' },
    create: {
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      role: 'admin',
      name: 'Platform Admin',
    },
  });

  const agentEmail = (process.env.AGENT_EMAIL || 'agent@bingo.et').toLowerCase();
  const agentPassword = process.env.AGENT_PASSWORD || 'Agent@12345';

  let agentUser = await prisma.user.findUnique({ where: { telegramId: '900000001' } });
  if (!agentUser) {
    agentUser = await prisma.user.create({
      data: { telegramId: '900000001', firstName: 'Demo Agent', username: 'demoagent', role: 'agent' },
    });
  }

  let agent = await prisma.agent.findUnique({ where: { userId: agentUser.id } });
  if (!agent) {
    agent = await prisma.agent.create({
      data: { userId: agentUser.id, referralCode: 'AGDEMO' },
    });
  }

  await prisma.staffAccount.upsert({
    where: { email: agentEmail },
    update: {
      passwordHash: await bcrypt.hash(agentPassword, 10),
      role: 'agent',
      agentId: agent.id,
    },
    create: {
      email: agentEmail,
      passwordHash: await bcrypt.hash(agentPassword, 10),
      role: 'agent',
      agentId: agent.id,
      name: 'Demo Agent',
    },
  });

  console.log('Seed complete:');
  console.log(`  Admin: ${adminEmail} / ${adminPassword}`);
  console.log(`  Agent: ${agentEmail} / ${agentPassword} (code AGDEMO)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
