/**
 * What the app promises the voter has to be true of the code that ships.
 *
 * Wave 4a A1: the FAQ said "once a vote is recorded, no information is kept on
 * the phone", three screens away from terms 4.2 saying the opposite, and from
 * `passport_key_db_v1`, a SecureStore database that is permanent by design and
 * exportable by the voter. That persistence is right: French documents have no
 * DG15, so `Registration2.revoke()` is closed and a voter who reinstalls with
 * no key loses the right to vote with that document for good. The sentence was
 * what had to change.
 *
 * Wave 4b C4: the key export wrote the private key in clear with no word about
 * what the file allows.
 *
 * These are contractual commitments shown to a voter, so they get a test that
 * fails when someone reintroduces an absolute claim, and not only a review.
 *
 * NOTE, and it is the point of the wording chosen: the CAN sentence is kept
 * true rather than softened. It now says the CAN is never sent over the
 * internet and never saved in the app, both of which the code makes true. It
 * deliberately does NOT claim anything about the iOS system log, because the
 * NFC pod still logs the PACE key there in release; that is the pod pin, which
 * is the app developer's to push and the product owner's to schedule (see the TODO in app.config.ts).
 */
import * as fs from 'fs';
import * as path from 'path';
import fr from '@/locales/fr.json';
import en from '@/locales/en.json';
import { TERMS_TEXT_FR } from '@/constants/terms';

type Json = { [k: string]: unknown };

function allStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => allStrings(n, out));
  else if (node && typeof node === 'object') {
    Object.values(node as Json).forEach((n) => allStrings(n, out));
  }
  return out;
}

const FR = allStrings(fr);
const EN = allStrings(en);

describe('nothing claims the phone keeps nothing', () => {
  // The exact claim wave 4a quoted, and the shapes a rewrite could slip back
  // in. The key store is permanent and the terms say so.
  const FORBIDDEN_FR = [
    /aucune information n['’]est conserv[ée]/i,
    /rien n['’]est conserv[ée] sur le t[ée]l[ée]phone/i,
    /aucune donn[ée]e n['’]est conserv[ée]e sur le t[ée]l[ée]phone/i,
  ];
  const FORBIDDEN_EN = [
    /no information is kept on the phone/i,
    /nothing is kept on the phone/i,
    /no data is kept on the phone/i,
  ];

  it.each(FORBIDDEN_FR)('French says no such thing: %s', (re) => {
    expect(FR.filter((s) => re.test(s))).toEqual([]);
  });

  it.each(FORBIDDEN_EN)('English says no such thing: %s', (re) => {
    expect(EN.filter((s) => re.test(s))).toEqual([]);
  });

  it('and says instead what stays, that it never leaves, and what is sent', () => {
    const intro = FR.find((s) => s.includes('Plusieurs personnes peuvent voter'))!;
    expect(intro).toContain('clé de vote');
    expect(intro).toMatch(/ne quitte jamais le t[ée]l[ée]phone/);
    expect(intro).toContain('preuve mathématique');
    // Still reassuring about what is NOT kept.
    expect(intro).toMatch(/ne garde ni votre nom/);

    const introEn = EN.find((s) => s.includes('Several people can vote'))!;
    expect(introEn).toContain('voting key');
    expect(introEn).toContain('never leaves the phone');
    expect(introEn).toContain('mathematical proof');
  });
});

describe('the CAN promise stays, and stays exactly true', () => {
  it('is about the network and the app, and claims nothing wider', () => {
    const fr0 = FR.find((s) => s.includes('Saisissez le code CAN'))!;
    expect(fr0).toMatch(/n['’]est ni envoyé sur internet, ni enregistré dans l['’]application/);
    const en0 = EN.find((s) => s.includes('Enter the CAN code'))!;
    expect(en0).toContain('never sent over the internet and never saved in the app');
  });
});

describe('the key export says what the file is before it writes one', () => {
  it.each([
    ['fr', fr],
    ['en', en],
  ])('%s has the three warning strings', (_lang, dict) => {
    const km = (dict as Json).keyManagement as Json;
    expect(typeof km.exportWarningTitle).toBe('string');
    expect(typeof km.exportWarningBody).toBe('string');
    expect(typeof km.exportWarningCta).toBe('string');
  });

  it('names the risk, the limit of the risk, and how to store it', () => {
    const body = (fr.keyManagement as Json).exportWarningBody as string;
    // what it allows
    expect(body).toMatch(/comment vous avez vot[ée]/);
    // what it does NOT allow, so the warning is believed
    expect(body).toMatch(/ne permet pas de voter [àa] votre place/);
    // that it is not encrypted, and how to keep it
    expect(body).toMatch(/aucun mot de passe/);
    expect(body).toMatch(/stockage en ligne/);
  });

  it('the description next to the button no longer sells only the benefit', () => {
    const desc = (fr.keyManagement as Json).dbDescription as string;
    expect(desc).toMatch(/en clair/);
    expect((en.keyManagement as Json).dbDescription as string).toMatch(/in clear/);
  });

  it('carries no jargon a voter would have to look up', () => {
    const body = (fr.keyManagement as Json).exportWarningBody as string;
    for (const word of ['BJJ', 'nullifier', 'Poseidon', 'on-chain', 'JSON']) {
      expect(body).not.toContain(word);
    }
  });
});

/* -------------------------------------------------------------------------
 * Wave 4a A9 and A10, and the traceability review of 23/09.
 *
 * `voting.step2Description_idCard` / `_passport` said "les données ne sont pas
 * transférées ni conservées sur un serveur tiers". Read against the code that
 * ships, that is false twice over:
 *
 *   - utils/register-via-noir.ts:293 POSTs the registration calldata to
 *     https://api.app.rarime.com/integrations/registration-relayer/v1/register,
 *     a server nobody in this project operates, and that calldata carries the
 *     card's passportHash and dgCommit. The relayer writes them on chain, where
 *     they are kept for good.
 *   - utils/csca-bootstrap.ts:356-377 sends the card's own document-signer
 *     certificate, read out of the SOD on the chip, through the same relayer.
 *
 * What IS true, and is what the new wording says: the store app verifies the
 * document on the phone (Step7.tsx:817-824 throws rather than use the hosted
 * light registrator), so the civil identity itself never leaves, and what is
 * sent is a proof plus a non-reversible fingerprint.
 * ---------------------------------------------------------------------------*/
describe('nothing claims a third-party server is not involved', () => {
  const FORBIDDEN_FR = [
    /ne sont (?:pas|ni) transf[ée]r[ée]e?s? (?:pas |ni )?(?:ni |et ne sont pas )?conserv[ée]e?s? sur un serveur tiers/i,
    /aucun serveur tiers/i,
    /pas de serveur tiers/i,
  ];
  const FORBIDDEN_EN = [
    /not transferred to or stored on any third-party server/i,
    /no third-party server/i,
  ];

  it.each(FORBIDDEN_FR)('French says no such thing: %s', (re) => {
    expect(FR.filter((s) => re.test(s))).toEqual([]);
  });

  it.each(FORBIDDEN_EN)('English says no such thing: %s', (re) => {
    expect(EN.filter((s) => re.test(s))).toEqual([]);
  });

  it.each(['idCard', 'passport'])(
    'step 2 (%s) says where the check happens and what is sent, in both languages',
    (doc) => {
      const voting = (lang: typeof fr | typeof en) => (lang as unknown as Json).voting as Json;
      const f = voting(fr)[`step2Description_${doc}`] as string;
      expect(f).toMatch(/v[ée]rification a lieu sur le t[ée]l[ée]phone/);
      expect(f).toContain('preuve mathématique');
      expect(f).toMatch(/empreinte non r[ée]versible/);
      expect(f).toMatch(/op[ée]rateur tiers/);
      expect(f).toContain('registre public');

      const e = voting(en)[`step2Description_${doc}`] as string;
      expect(e).toContain('happens on the phone');
      expect(e).toContain('mathematical proof');
      expect(e).toContain('non-reversible fingerprint');
      expect(e).toContain('third-party operator');
      expect(e).toContain('public register');
    },
  );
});

/* -------------------------------------------------------------------------
 * The terms are the same promises in their contractual form, and up to now no
 * test read them at all. Three articles, three corrections of 23/09.
 * ---------------------------------------------------------------------------*/
describe('the terms say what the screens say', () => {
  it('3.3 says the exported key file is in clear, as the export screen does', () => {
    // The screen has said it since wave 4b C4 (keyManagement.exportWarningBody,
    // keyManagement.dbDescription); the article sold the benefit alone.
    const article = TERMS_TEXT_FR.split('### 3.3.')[1].split('### 3.4.')[0];
    expect(article).toMatch(/aucun mot de passe/);
    expect(article).toMatch(/en clair/);
    expect(article).toMatch(/comment l['’]Utilisateur a vot[ée]/);
    // and the limit of the risk, so the warning stays believable
    expect(article).toMatch(/ne permet pas .{0,20}de voter [àa] sa place/);
  });

  it('4.5 names the third-party operator instead of stopping at the publisher', () => {
    const article = TERMS_TEXT_FR.split('### 4.5.')[1].split('## Article 5')[0];
    // What was already true and stays: the publisher runs no server.
    expect(article).toMatch(/n['’]exploite aucun serveur recevant des données personnelles/);
    // What was missing: somebody else's server does receive something.
    expect(article).toMatch(/op[ée]rateur tiers/);
    expect(article).toContain('RARIMO');
    expect(article).toMatch(/conserv[ée]s de façon permanente/);
    // and what it is not: still no civil identity.
    expect(article).toMatch(/ni le nom, ni la date de naissance, ni le num[ée]ro/);
  });

  it('the article heading no longer promises an absence of server', () => {
    expect(TERMS_TEXT_FR).not.toContain('Absence de serveur de vérification');
  });
});

/* -------------------------------------------------------------------------
 * The compatibility article against the floors the build actually accepts.
 * Never reported by any audit: the terms declared iOS 17 and Android 10 while
 * app.config.ts builds for iOS 16 and API 27, so the app installed on phones
 * its own terms put out of scope. Derived from app.config.ts, not typed twice,
 * so raising a floor without touching the terms fails here.
 * ---------------------------------------------------------------------------*/
describe('the compatibility article matches the build', () => {
  const CONFIG = fs.readFileSync(path.resolve(__dirname, '../app.config.ts'), 'utf8');
  /** API level -> the Android version name a reader knows it by. */
  const ANDROID_NAMES: Record<string, string> = {
    '26': '8.0', '27': '8.1', '28': '9', '29': '10', '30': '11',
    '31': '12', '32': '12L', '33': '13', '34': '14', '35': '15', '36': '16',
  };

  it('names the iOS floor the build is compiled for', () => {
    const ios = /deploymentTarget:\s*'(\d+)(?:\.\d+)?'/.exec(CONFIG)![1];
    expect(TERMS_TEXT_FR).toContain(`sous iOS ${ios} ou version ultérieure`);
    // iOS 16 drops the iPhone 7, which the article used to name as the floor.
    expect(TERMS_TEXT_FR).not.toContain('iPhone 7 ou modèle plus récent');
  });

  it('names the Android floor the build is compiled for', () => {
    const api = /minSdkVersion:\s*(\d+)/.exec(CONFIG)![1];
    const name = ANDROID_NAMES[api];
    expect(name).toBeDefined();
    expect(TERMS_TEXT_FR).toContain(`Android ${name} ou version ultérieure`);
  });
});

/* -------------------------------------------------------------------------
 * The site services the terms describe, against what the site actually runs.
 * The terms shipped in 2.0.1 described petition signing by email and a
 * newsletter signup, with confirmation links, a 15 year floor and a withdrawal
 * link. Neither is open: the site publishes petition texts read only until
 * October 2026 and its newsletter page still carries a placeholder. Terms that
 * describe a personal data collection which does not happen are wrong in the
 * direction that matters, so the article says what is true today and says when
 * it will change.
 * ---------------------------------------------------------------------------*/
describe('the site services article describes services that exist', () => {
  it('does not promise petition signing while signatures are closed', () => {
    expect(TERMS_TEXT_FR).not.toContain('soutenir une question par une pétition signée avec une adresse e-mail');
    expect(TERMS_TEXT_FR).toContain('Les signatures ne sont pas encore ouvertes');
    expect(TERMS_TEXT_FR).toContain("ne collecte aucune adresse e-mail ni aucune signature au titre des pétitions");
  });

  it('does not promise a newsletter signup while the form is not published', () => {
    expect(TERMS_TEXT_FR).not.toContain("Le site permet de s'inscrire à une lettre d'information");
    expect(TERMS_TEXT_FR).toContain("Le formulaire d'inscription n'est pas encore ouvert");
  });
});

describe('no em dash in what the voter reads', () => {
  // the product owner's rule for written deliverables, and these strings are the most read
  // text the project ships.
  it.each([
    ['fr', FR],
    ['en', EN],
  ])('%s', (_lang, strings) => {
    const changed = strings.filter(
      (s) =>
        s.includes('—') &&
        (s.includes('clé de vote') ||
          s.includes('voting key') ||
          s.includes('code CAN') ||
          s.includes('CAN code')),
    );
    expect(changed).toEqual([]);
  });
});
