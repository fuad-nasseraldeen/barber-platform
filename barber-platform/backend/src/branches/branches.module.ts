import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { ServicesModule } from '../services/services.module';
import { RolesGuard } from '../common/guards/roles.guard';

@Module({
  imports: [ServicesModule],
  controllers: [BranchesController],
  providers: [BranchesService, RolesGuard],
  exports: [BranchesService],
})
export class BranchesModule {}
