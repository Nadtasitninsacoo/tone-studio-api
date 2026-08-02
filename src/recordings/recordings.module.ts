import { Module } from '@nestjs/common';

import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { RecordingsStorage } from './recordings.storage';

/**
 * Take persistence: upload, list, stream and delete.
 *
 * `RecordingsStorage` is the only filesystem-aware class, so replacing it with a
 * database- or S3-backed implementation later needs no change to the controller.
 */
@Module({
  controllers: [RecordingsController],
  providers: [RecordingsService, RecordingsStorage],
})
export class RecordingsModule {}
