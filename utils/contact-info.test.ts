import { buildContactVars, RawContactInfo } from './contact-info';

const base: RawContactInfo = {
  version: '1.0.0',
  build: 2,
  deviceModel: 'iPhone 16',
  platformOS: 'ios',
  osVersion: '18.5',
};

describe('buildContactVars', () => {
  it('maps version, build, device and OS', () => {
    expect(buildContactVars(base)).toEqual({
      version: '1.0.0',
      build: '2',
      device: 'iPhone 16',
      platform: 'iOS',
      os: '18.5',
    });
  });

  it('carries no update generation: the binary is the whole bundle', () => {
    // 2.0.1 removed the over-the-air updater; a footer that still named an
    // "OTA" number would be claiming a mechanism the app no longer has.
    expect(Object.keys(buildContactVars(base))).toEqual([
      'version',
      'build',
      'device',
      'platform',
      'os',
    ]);
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
      }),
    ).toEqual({ version: '?', build: '?', device: '?', platform: 'iOS', os: '18.5' });
  });
});
