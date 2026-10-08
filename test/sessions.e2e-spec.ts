import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import type { MixerSession } from '../src/sessions/session.types';

describe('SessionsController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableCors({
      origin: ['http://localhost:3000', 'http://localhost:3001'],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      exposedHeaders: ['Content-Disposition', 'Content-Length'],
    });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('performs full CRUD of a mixer session and validates boundaries', async () => {
    // 1. List sessions initially (returns array)
    const listRes = await request(app.getHttpServer())
      .get('/sessions')
      .expect(200);
    expect(Array.isArray(listRes.body)).toBe(true);

    // 2. Create a new session
    const createRes = await request(app.getHttpServer())
      .post('/sessions')
      .send({
        name: 'Mor Lam Live Show',
        channels: [
          {
            id: 'guitar-1',
            name: 'Lead Guitar',
            muted: false,
            soloed: false,
            volume: 1.2,
            pan: -0.5,
            phaseInverted: true,
            hpfEnabled: true,
            hpfFrequency: 100,
            lpfEnabled: false,
            lpfFrequency: 20000,
            eqLow: 3,
            eqMid: -2,
            eqHigh: 1,
            recordingId: null,
          },
        ],
        master: {
          volume: 1.0,
          limiterEnabled: true,
          limiterThresholdDb: -0.3,
          crossoverEnabled: true,
          subCutoffHz: 90,
          mainCutoffHz: 90,
          subDelayMs: 4.5,
          mainDelayMs: 0.0,
        },
      })
      .expect(201);

    const session = createRes.body as MixerSession;
    expect(session.id).toBeDefined();
    expect(session.name).toBe('Mor Lam Live Show');
    expect(session.channels[0].id).toBe('guitar-1');
    expect(session.channels[0].phaseInverted).toBe(true);
    expect(session.channels[0].hpfFrequency).toBe(100);
    expect(session.master.subCutoffHz).toBe(90);
    expect(session.master.subDelayMs).toBe(4.5);

    // 3. Retrieve the created session
    const getRes = await request(app.getHttpServer())
      .get(`/sessions/${session.id}`)
      .expect(200);
    const sessionGet = getRes.body as MixerSession;
    expect(sessionGet.name).toBe('Mor Lam Live Show');

    const preflightRes = await request(app.getHttpServer())
      .options(`/sessions/${session.id}`)
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);
    expect(preflightRes.headers['access-control-allow-methods']).toContain('PUT');

    // 4. Update the session (e.g. change master volume & panning)
    const updateRes = await request(app.getHttpServer())
      .put(`/sessions/${session.id}`)
      .send({
        name: 'Mor Lam Soundcheck Day 1',
        master: {
          volume: 0.8,
          subDelayMs: 6.2,
        },
      })
      .expect(200);
    const sessionUpdate = updateRes.body as MixerSession;
    expect(sessionUpdate.name).toBe('Mor Lam Soundcheck Day 1');
    expect(sessionUpdate.master.volume).toBe(0.8);
    expect(sessionUpdate.master.subDelayMs).toBe(6.2);
    // Unchanged fields should remain
    expect(sessionUpdate.master.subCutoffHz).toBe(90);

    // 5. Boundary Validation Check: Panning out of range (> 1.0)
    await request(app.getHttpServer())
      .put(`/sessions/${session.id}`)
      .send({
        channels: [
          {
            id: 'guitar-1',
            pan: 2.5, // Invalid: must be between -1.0 and 1.0
          },
        ],
      })
      .expect(400);

    // 6. Boundary Validation Check: HPF frequency out of range (< 20Hz)
    await request(app.getHttpServer())
      .put(`/sessions/${session.id}`)
      .send({
        channels: [
          {
            id: 'guitar-1',
            hpfFrequency: 10, // Invalid: must be >= 20Hz
          },
        ],
      })
      .expect(400);

    // 7. Delete the session
    await request(app.getHttpServer())
      .delete(`/sessions/${session.id}`)
      .expect(204);

    // 8. Verify it is gone
    await request(app.getHttpServer())
      .get(`/sessions/${session.id}`)
      .expect(404);
  });
});
