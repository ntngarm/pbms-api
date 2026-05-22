import { Module } from '@nestjs/common';
import { SendBedController } from './send-bed.controller';
import { SendBedService } from './send-bed.service';

@Module({
  controllers: [SendBedController],
  providers: [SendBedService],
})
export class SendBedModule {}
