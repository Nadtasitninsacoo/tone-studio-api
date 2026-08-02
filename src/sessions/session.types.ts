export interface ChannelConfig {
  id: string; // Unique identifier for the channel (e.g. 'guitar', 'bass', or a UUID)
  name: string; // User-defined name of the channel
  muted: boolean;
  soloed: boolean;
  volume: number; // Fader gain multiplier (>= 0, typical range 0.0 to 2.0)
  pan: number; // Stereo panning (-1.0 to 1.0)
  phaseInverted: boolean; // ø Phase inversion toggle (180 degrees)

  // High-Pass Filter (HPF / Low Cut)
  hpfEnabled: boolean;
  hpfFrequency: number; // 20 Hz to 20,000 Hz

  // Low-Pass Filter (LPF / High Cut)
  lpfEnabled: boolean;
  lpfFrequency: number; // 20 Hz to 20,000 Hz

  // 3-band EQ gain levels (in dB, e.g., -15dB to +15dB)
  eqLow: number;
  eqMid: number;
  eqHigh: number;

  // Link to a recorded audio file id
  recordingId: string | null;
}

export interface MasterConfig {
  volume: number; // Master fader gain multiplier (>= 0)
  limiterEnabled: boolean;
  limiterThresholdDb: number; // dB (<= 0)

  // Output Crossover & Speaker Phase Alignment Settings
  crossoverEnabled: boolean;
  subCutoffHz: number; // Cutoff frequency for Subwoofer output (Hz)
  mainCutoffHz: number; // Cutoff frequency for Line Array output (Hz)
  subDelayMs: number; // Time delay for subwoofer phase alignment (in ms)
  mainDelayMs: number; // Time delay for main speaker phase alignment (in ms)
}

export interface MixerSession {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  channels: ChannelConfig[];
  master: MasterConfig;
}

export interface CreateSessionDto {
  name: string;
  channels?: ChannelConfig[];
  master?: MasterConfig;
}

export interface UpdateSessionDto {
  name?: string;
  channels?: ChannelConfig[];
  master?: MasterConfig;
}
