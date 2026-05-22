import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello() {
    return {
      name: 'PBMS API',      
      description: 'Psychiatric Bed Management System',
      version: '0.0.1',
    }
  }
}
