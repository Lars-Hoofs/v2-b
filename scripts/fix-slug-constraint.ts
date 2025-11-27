import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixSlugConstraint() {
  try {
    console.log('Dropping existing unique constraint...');
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "workspaces_slug_key";`);
    
    console.log('Creating partial unique index...');
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "workspaces_slug_key" 
      ON "workspaces"("slug") 
      WHERE "deletedAt" IS NULL;
    `);
    
    console.log('✓ Slug constraint fixed successfully!');
    console.log('✓ Workspaces with the same slug can now be created after soft delete.');
  } catch (error) {
    console.error('Error fixing slug constraint:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

fixSlugConstraint();
