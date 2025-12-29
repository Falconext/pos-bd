// Standalone script to seed ubigeos into the template database
// Run with: npx ts-node prisma/seeds/seed-ubigeo.ts

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

interface Departamento {
    id: string;
    name: string;
}

interface Provincia {
    id: string;
    name: string;
    department_id: string;
}

interface Distrito {
    id: string;
    name: string;
    province_id: string;
    department_id: string;
}

async function main() {
    const prisma = new PrismaClient();

    try {
        console.log('🌍 Seeding Ubigeos...');
        console.log(`   Database: ${process.env.DATABASE_URL}`);

        // Check if ubigeos already exist
        const count = await prisma.ubigeo.count();
        if (count > 0) {
            console.log(`✅ Ubigeos already seeded (${count} records)`);
            return;
        }

        const dataDir = path.join(__dirname, '../data');

        // Read JSON files
        const deptPath = path.join(dataDir, 'departamentos.json');
        const provPath = path.join(dataDir, 'provincias.json');
        const distPath = path.join(dataDir, 'distritos.json');

        if (!fs.existsSync(deptPath) || !fs.existsSync(provPath) || !fs.existsSync(distPath)) {
            console.log('⚠️ Ubigeo data files not found, skipping...');
            return;
        }

        const departamentos: Departamento[] = JSON.parse(fs.readFileSync(deptPath, 'utf-8'));
        const provincias: Provincia[] = JSON.parse(fs.readFileSync(provPath, 'utf-8'));
        const distritos: Distrito[] = JSON.parse(fs.readFileSync(distPath, 'utf-8'));

        // Create lookup maps
        const deptMap = new Map(departamentos.map(d => [d.id, d.name]));
        const provMap = new Map(provincias.map(p => [p.id, p.name]));

        // Build ubigeo records
        const ubigeoData = distritos.map(d => ({
            codigo: d.id,
            departamento: deptMap.get(d.department_id) || '',
            provincia: provMap.get(d.province_id) || '',
            distrito: d.name,
        }));

        // Insert in batches
        const batchSize = 500;
        for (let i = 0; i < ubigeoData.length; i += batchSize) {
            const batch = ubigeoData.slice(i, i + batchSize);
            await prisma.ubigeo.createMany({
                data: batch,
            });
            console.log(`   Inserted ${Math.min(i + batchSize, ubigeoData.length)}/${ubigeoData.length} ubigeos...`);
        }

        console.log(`✅ Seeded ${ubigeoData.length} ubigeos successfully!`);
    } catch (error) {
        console.error('❌ Error seeding ubigeos:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
