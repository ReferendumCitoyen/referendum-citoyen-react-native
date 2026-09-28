/**
 * Wordings the 2.0.2 reconciliation fixed (plan C-8 and C-9): no platform name
 * a phone may not be, no claim the app cannot prove, no jargon.
 */
import fr from '@/locales/fr.json';
import en from '@/locales/en.json';

const dicts = { fr, en } as Record<string, any>;

describe.each(Object.keys(dicts))('%s', (lang) => {
  const d = dicts[lang];

  // Neutral text (plan C-8, P5): the probe proves the prover cannot
  // load, not why, and the same text is read on an iPhone.
  it.each([
    ['voting.errors.unsupportedPhone', d.voting.errors.unsupportedPhone],
    ['home.unsupportedPhoneBody', d.home?.unsupportedPhoneBody ?? findKey(d, 'unsupportedPhoneBody')],
  ])('%s names no platform and no cause', (_k, text) => {
    expect(typeof text).toBe('string');
    expect(text).not.toMatch(/android|iphone|ios\b/i);
    expect(text).not.toMatch(/processeur|processor|CPU/i);
  });
});

function findKey(obj: any, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const found = findKey(v, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

// QA 2.0.2, item 7: the vote failure "prover incompatible" is read on iPhones
// too, and the voter needs a way out, not a diagnosis (final wording, 22/09).
describe.each(['fr', 'en'] as const)('%s step11ProverIncompatible', (lang) => {
  const text: string = (lang === 'fr' ? fr : en).voting.step11ProverIncompatible;

  it('names no platform, no SDK and no error code', () => {
    expect(text).not.toMatch(/android|iphone|ios\b/i);
    expect(text).not.toMatch(/SDK|Rarime|PAIRING|0x[0-9a-f]+/i);
  });

  it('offers the way out: another phone, the voter\'s own document', () => {
    expect(text).toMatch(lang === 'fr' ? /autre téléphone/i : /another phone/i);
    expect(text).toMatch(lang === 'fr' ? /votre propre/i : /your own/i);
  });
});

// D-2: the sentence a voter reads when the registration was sent and not
// confirmed in the window. It must never say the vote failed, must name the
// button the screen actually shows, and must stay free of jargon.
describe.each(['fr', 'en'] as const)('%s registrationPending', (lang) => {
  const d = lang === 'fr' ? fr : en;
  const text: string = d.voting.errors.registrationPending;

  it('says it was sent and is not confirmed yet, and never that it failed', () => {
    expect(text).toMatch(lang === 'fr' ? /envoyée/i : /has been sent/i);
    expect(text).toMatch(lang === 'fr' ? /pas encore confirmée/i : /not confirmed yet/i);
    expect(text).not.toMatch(lang === 'fr' ? /échec|a échoué|non enregistré/i : /failed|not registered/i);
  });

  it('says the vote is not lost and what to do', () => {
    expect(text).toMatch(lang === 'fr' ? /n'est pas perdu/i : /not lost/i);
    expect(text).toMatch(lang === 'fr' ? /application ouverte/i : /app open/i);
    expect(text).toMatch(lang === 'fr' ? /plus tard/i : /later/i);
  });

  it('names the button the screen shows', () => {
    expect(text).toContain(d.voting.step7RestartVote);
  });

  it('carries no jargon', () => {
    expect(text).not.toMatch(/blockchain|relais|relayer|SMT|transaction|hash|RPC/i);
  });
});

/* -------------------------------------------------------------------------
 * The two languages must show the same sections.
 *
 * Until 23/09/2026 the "Comprendre" tab had ten sections in French and eleven
 * in English. The extra one, "Where does this come from?", named three people,
 * one of whom appears nowhere in the legal notices, and cited a former
 * employer. French readers never saw it, so the text attributing the origin of
 * the project existed for English readers only. In a source tree about to be
 * published, an asymmetry between the two languages is the first thing a
 * reader who compares them will find. Product decision: remove it everywhere.
 * ---------------------------------------------------------------------------*/
describe('the Comprendre tab is the same in both languages', () => {
  it('has the same number of sections', () => {
    expect(en.comprendre.sections.length).toBe(fr.comprendre.sections.length);
  });

  it('no longer carries the origin section that only English readers saw', () => {
    const titles = [...en.comprendre.sections, ...fr.comprendre.sections]
      .map((s: { title?: string }) => s.title ?? '');
    expect(titles.some((t) => /where does this come from/i.test(t))).toBe(false);
  });

  /**
   * Cette garde listait les quatre noms a proscrire, en clair. Deux d'entre
   * eux n'apparaissaient nulle part ailleurs dans l'arbre publie : la garde
   * publiait donc exactement ce qu'elle protegeait. Constate le 24/09/2026 par
   * la verification mecanique du cliche, section 1.
   *
   * Elle est devenue structurelle. On n'enumere plus des personnes, on refuse
   * toute suite de deux mots capitalises qui ne figure pas dans une liste de
   * termes manifestement non nominatifs. C'est plus strict que l'ancienne
   * version, qui ne voyait que les noms auxquels quelqu'un avait pense.
   *
   * Si ce test tombe sur un ajout legitime, on ajoute le terme ci-dessous ;
   * le sens de l'echec est le bon : une paire capitalisee inconnue dans un
   * onglet destine aux votants merite un regard.
   */
  it('names no individual in either language', () => {
    const blob = JSON.stringify({ fr: fr.comprendre, en: en.comprendre });
    const allowed = ['Référendum Citoyen', 'Because FranceConnect', 'The ID', 'Which ID'];
    // [À-Þ] couvre toute la plage des majuscules latines accentuees, U+00C0 a
    // U+00DE : la liste ecrite a la main la nuit du 24/09 oubliait O, U, I, A
    // accentues aigus et le N tilde, et « Olafur Arnalds » passait sans etre vu.
    const pairs = blob.match(/[A-ZÀ-Þ][\wÀ-ÿ'-]+ [A-ZÀ-Þ][\wÀ-ÿ'-]+/g) ?? [];
    expect([...new Set(pairs)].filter((p) => !allowed.includes(p))).toEqual([]);
  });
});
