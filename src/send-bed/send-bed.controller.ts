import { Controller, Get, Post, Query } from '@nestjs/common';
import { SendBedService, BedRow, BedOccupancyRow } from './send-bed.service';

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

  // GET /send-bed/occupancy-rate?months=12&beds=101,102,103&totalBeds=120
  // ไม่ใส่ beds = ดึงรายชื่อเตียงจาก bed-config API อัตโนมัติ (เหมือน getBeds)
  @Get('occupancy-rate')
  getMonthlyOccupancyRate(
    @Query('months') months?: string,
    @Query('beds') beds?: string,
    @Query('totalBeds') totalBeds?: string,
  ): Promise<BedOccupancyRow[]> {
    return this.service.getMonthlyBedOccupancyRate(
      months ? parseInt(months, 10) : undefined,
      beds ? beds.split(',').map((b) => b.trim()).filter(Boolean) : undefined,
      totalBeds ? parseInt(totalBeds, 10) : undefined,
    );
  }
}
