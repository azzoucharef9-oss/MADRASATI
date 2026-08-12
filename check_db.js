const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: 'postgresql://postgres:TFntSDALEkSnBUqwXixEAqjwNuHonLjW@crossover.proxy.rlwy.net:44693/railway'
      }
    }
  });

  try {
    const students = await prisma.student.findMany();
    console.log('Total students:', students.length);
    console.log('Students:', JSON.stringify(students, null, 2));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
