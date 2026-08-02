import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RecordingsModule } from './recordings/recordings.module';
import { SessionsModule } from './sessions/sessions.module';

@Module({
  imports: [RecordingsModule, SessionsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
