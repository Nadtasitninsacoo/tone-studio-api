import { Module } from '@nestjs/common';

import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionsStorage } from './sessions.storage';

@Module({
  controllers: [SessionsController],
  providers: [SessionsService, SessionsStorage],
  exports: [SessionsService],
})
export class SessionsModule {}
