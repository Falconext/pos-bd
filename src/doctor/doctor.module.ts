import { Module } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { DoctorController } from './doctor.controller';
import { RolesGuard } from '../common/guards/roles.guard';

@Module({
  controllers: [DoctorController],
  providers: [DoctorService, RolesGuard],
  exports: [DoctorService],
})
export class DoctorModule {}
