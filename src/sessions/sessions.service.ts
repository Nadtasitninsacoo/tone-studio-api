import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type {
  ChannelConfig,
  CreateSessionDto,
  MasterConfig,
  MixerSession,
  UpdateSessionDto,
} from './session.types';
import { SessionsStorage } from './sessions.storage';

const ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

@Injectable()
export class SessionsService implements OnModuleInit {
  constructor(private readonly storage: SessionsStorage) {}

  async onModuleInit(): Promise<void> {
    await this.storage.ensureReady();
  }

  findAll(): Promise<MixerSession[]> {
    return this.storage.list();
  }

  private assertValidId(id: string): void {
    if (!ID_PATTERN.test(id)) {
      throw new BadRequestException('Malformed session id.');
    }
  }

  async findOne(id: string): Promise<MixerSession> {
    this.assertValidId(id);
    const session = await this.storage.findById(id);
    if (!session) {
      throw new NotFoundException(`No session with id ${id}.`);
    }
    return session;
  }

  async create(dto: CreateSessionDto): Promise<MixerSession> {
    const id = randomUUID();
    const now = Date.now();

    const name = this.sanitiseText(dto.name, 'New Session').slice(0, 100);

    const channels = this.validateAndBuildChannels(dto.channels ?? []);
    const master = this.validateAndBuildMaster(dto.master);

    const session: MixerSession = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      channels,
      master,
    };

    return this.storage.save(session);
  }

  async update(id: string, dto: UpdateSessionDto): Promise<MixerSession> {
    const existing = await this.findOne(id);

    const now = Date.now();
    const name =
      dto.name !== undefined
        ? this.sanitiseText(dto.name, existing.name).slice(0, 100)
        : existing.name;

    const channels =
      dto.channels !== undefined
        ? this.validateAndBuildChannels(dto.channels, existing.channels)
        : existing.channels;

    const master =
      dto.master !== undefined
        ? this.validateAndBuildMaster(dto.master, existing.master)
        : existing.master;

    const updated: MixerSession = {
      ...existing,
      name,
      channels,
      master,
      updatedAt: now,
    };

    return this.storage.save(updated);
  }

  async remove(id: string): Promise<void> {
    this.assertValidId(id);
    const removed = await this.storage.remove(id);
    if (!removed) {
      throw new NotFoundException(`No session with id ${id}.`);
    }
  }

  private sanitiseText(raw: string | undefined, fallback: string): string {
    const cleaned = (raw ?? '').replace(CONTROL_CHARS, '').trim();
    return cleaned || fallback;
  }

  private validateAndBuildChannels(
    rawChannels: ChannelConfig[],
    existingChannels?: ChannelConfig[],
  ): ChannelConfig[] {
    return rawChannels.map((c, idx) => {
      const id = this.sanitiseText(c.id, `channel-${idx}`);
      const existing = existingChannels?.find((ec) => ec.id === id);

      const name = this.sanitiseText(
        c.name,
        existing ? existing.name : `Channel ${idx + 1}`,
      ).slice(0, 50);

      const volume = this.validateNumber(c.volume, 'volume', {
        min: 0,
        max: 10,
        fallback: existing ? existing.volume : 1.0,
      });

      const pan = this.validateNumber(c.pan, 'pan', {
        min: -1.0,
        max: 1.0,
        fallback: existing ? existing.pan : 0.0,
      });

      const phaseInverted =
        c.phaseInverted !== undefined
          ? !!c.phaseInverted
          : existing
            ? existing.phaseInverted
            : false;
      const muted =
        c.muted !== undefined ? !!c.muted : existing ? existing.muted : false;
      const soloed =
        c.soloed !== undefined
          ? !!c.soloed
          : existing
            ? existing.soloed
            : false;

      const hpfEnabled =
        c.hpfEnabled !== undefined
          ? !!c.hpfEnabled
          : existing
            ? existing.hpfEnabled
            : false;
      const hpfFrequency = this.validateNumber(c.hpfFrequency, 'hpfFrequency', {
        min: 20,
        max: 20000,
        fallback: existing ? existing.hpfFrequency : 80,
      });

      const lpfEnabled =
        c.lpfEnabled !== undefined
          ? !!c.lpfEnabled
          : existing
            ? existing.lpfEnabled
            : false;
      const lpfFrequency = this.validateNumber(c.lpfFrequency, 'lpfFrequency', {
        min: 20,
        max: 20000,
        fallback: existing ? existing.lpfFrequency : 20000,
      });

      const eqLow = this.validateNumber(c.eqLow, 'eqLow', {
        min: -24,
        max: 24,
        fallback: existing ? existing.eqLow : 0,
      });

      const eqMid = this.validateNumber(c.eqMid, 'eqMid', {
        min: -24,
        max: 24,
        fallback: existing ? existing.eqMid : 0,
      });

      const eqHigh = this.validateNumber(c.eqHigh, 'eqHigh', {
        min: -24,
        max: 24,
        fallback: existing ? existing.eqHigh : 0,
      });

      let recordingId: string | null = existing ? existing.recordingId : null;
      if (c.recordingId !== undefined) {
        if (c.recordingId) {
          if (!ID_PATTERN.test(c.recordingId)) {
            throw new BadRequestException(
              `Malformed recordingId in channel ${name}.`,
            );
          }
          recordingId = c.recordingId;
        } else {
          recordingId = null;
        }
      }

      return {
        id,
        name,
        muted,
        soloed,
        volume,
        pan,
        phaseInverted,
        hpfEnabled,
        hpfFrequency,
        lpfEnabled,
        lpfFrequency,
        eqLow,
        eqMid,
        eqHigh,
        recordingId,
      };
    });
  }

  private validateAndBuildMaster(
    rawMaster?: Partial<MasterConfig>,
    existingMaster?: MasterConfig,
  ): MasterConfig {
    const volume = this.validateNumber(rawMaster?.volume, 'master.volume', {
      min: 0,
      max: 10,
      fallback: existingMaster ? existingMaster.volume : 1.0,
    });

    const limiterEnabled =
      rawMaster?.limiterEnabled !== undefined
        ? !!rawMaster.limiterEnabled
        : existingMaster
          ? existingMaster.limiterEnabled
          : false;

    const limiterThresholdDb = this.validateNumber(
      rawMaster?.limiterThresholdDb,
      'master.limiterThresholdDb',
      {
        min: -100,
        max: 0,
        fallback: existingMaster ? existingMaster.limiterThresholdDb : 0,
      },
    );

    const crossoverEnabled =
      rawMaster?.crossoverEnabled !== undefined
        ? !!rawMaster.crossoverEnabled
        : existingMaster
          ? existingMaster.crossoverEnabled
          : false;

    const subCutoffHz = this.validateNumber(
      rawMaster?.subCutoffHz,
      'master.subCutoffHz',
      {
        min: 20,
        max: 1000,
        fallback: existingMaster ? existingMaster.subCutoffHz : 80,
      },
    );

    const mainCutoffHz = this.validateNumber(
      rawMaster?.mainCutoffHz,
      'master.mainCutoffHz',
      {
        min: 20,
        max: 20000,
        fallback: existingMaster ? existingMaster.mainCutoffHz : 80,
      },
    );

    const subDelayMs = this.validateNumber(
      rawMaster?.subDelayMs,
      'master.subDelayMs',
      {
        min: 0,
        max: 1000,
        fallback: existingMaster ? existingMaster.subDelayMs : 0,
      },
    );

    const mainDelayMs = this.validateNumber(
      rawMaster?.mainDelayMs,
      'master.mainDelayMs',
      {
        min: 0,
        max: 1000,
        fallback: existingMaster ? existingMaster.mainDelayMs : 0,
      },
    );

    return {
      volume,
      limiterEnabled,
      limiterThresholdDb,
      crossoverEnabled,
      subCutoffHz,
      mainCutoffHz,
      subDelayMs,
      mainDelayMs,
    };
  }

  private validateNumber(
    val: number | undefined,
    field: string,
    bounds: { min: number; max: number; fallback: number },
  ): number {
    if (val === undefined) return bounds.fallback;
    const num = Number(val);
    if (!Number.isFinite(num)) {
      throw new BadRequestException(
        `Field "${field}" must be a finite number.`,
      );
    }
    if (num < bounds.min || num > bounds.max) {
      throw new BadRequestException(
        `Field "${field}" must be between ${bounds.min} and ${bounds.max}.`,
      );
    }
    return num;
  }
}
