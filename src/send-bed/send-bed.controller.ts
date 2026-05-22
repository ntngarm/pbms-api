import { Controller, Get, Post } from '@nestjs/common';
import { SendBedService, BedRow } from './send-bed.service';

@Controller('send-bed')
export class SendBedController {
  constructor(private readonly service: SendBedService) {}

  @Get('settings')
  getBeds(): Promise<BedRow[]> {
    return this.service.getBeds();
  }

  @Post('trigger')
  trigger(): Promise<{ success: boolean; count: number }> {
    return this.service.sendBedData()
  }
}
