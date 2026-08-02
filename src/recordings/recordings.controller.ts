import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import type {
  CreateRecordingFields,
  Recording,
  RecordingMeta,
} from './recording.types';
import { MAX_UPLOAD_BYTES, RecordingsService } from './recordings.service';

@Controller('recordings')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  /** List every take, newest first. Metadata only — no waveform envelopes. */
  @Get()
  findAll(): Promise<RecordingMeta[]> {
    return this.recordings.findAll();
  }

  /**
   * Accept a WAV upload plus its metadata.
   *
   * Held in memory rather than streamed to a temp file: the file is already fully
   * formed in the browser before upload, and the size ceiling keeps this bounded.
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() fields: CreateRecordingFields,
  ): Promise<Recording> {
    return this.recordings.create(file, fields);
  }

  /** One take, including its waveform envelope. */
  @Get(':id')
  findOne(@Param('id') id: string): Promise<Recording> {
    return this.recordings.findOne(id);
  }

  /**
   * Serve the audio payload.
   *
   * Uses `res.sendFile` so Express handles Range requests — without byte ranges
   * the browser's <audio> element cannot seek within the file.
   *
   * `?download=1` forces a download instead of inline playback. This matters
   * because the HTML `download` attribute is ignored on cross-origin links, so
   * the header is the only way to make "Download" work against a separate API host.
   */
  @Get(':id/file')
  async streamFile(
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const recording = await this.recordings.findMeta(id);

    res.type('audio/wav');
    if (download === '1' || download === 'true') {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${recording.name}"`,
      );
    }
    // Takes are immutable once written, so they can be cached hard.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

    res.sendFile(this.recordings.audioPathFor(recording));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.recordings.remove(id);
  }
}
