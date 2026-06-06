import { buildContactVars, RawContactInfo } from './contact-info';

const base: RawContactInfo = {
  version: '1.0.0',
  build: 2,
  deviceModel: 'iPhone 16',
  platformOS: 'ios',
  osVersion: '18.5',
  otaEmbedded: false,
  otaPatch: 3,
};

describe('buildContactVars', () => {
  it('maps version, build, device, OS, and the OTA number', () => {
    expect(buildContactVars(base)).toEqual({
      version: '1.0.0',
      build: '2',
      device: 'iPhone 16',
      platform: 'iOS',
      os: '18.5',
      ota: '3',
    });
  });

  it('shows OTA 0 on an embedded launch (no update applied)', () => {
    expect(buildContactVars({ ...base, otaEmbedded: true }).ota).toBe('0');
  });

  it('prettifies the platform and coerces a numeric Android OS version', () => {
    const out = buildContactVars({ ...base, platformOS: 'android', osVersion: 34 });
    expect(out.platform).toBe('Android');
    expect(out.os).toBe('34');
  });

  it('falls back to "?" for missing device / version / build', () => {
    expect(
      buildContactVars({
        version: '',
        build: null,
        deviceModel: null,
        platformOS: 'ios',
        osVersion: '18.5',
        otaEmbedded: false,
        otaPatch: 0,
      }),
    ).toEqual({ version: '?', build: '?', device: '?', platform: 'iOS', os: '18.5', ota: '0' });
  });
});
