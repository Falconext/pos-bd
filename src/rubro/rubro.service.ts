import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RubroService {
    constructor(private readonly prisma: PrismaService) { }

    async findAll() {
        return this.prisma.rubro.findMany();
    }

    async findOne(id: number) {
        return this.prisma.rubro.findUnique({ where: { id } });
    }
}
