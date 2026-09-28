/**
 * Proposal metadata as published on IPFS, bundled for the questions of the
 * index, keyed by CID.
 *
 * TODO(DECISION-D7): the bundled question texts are to be validated as the
 * official ones (product owner, content owner).
 *
 * Why: IPFS answers "Unable to resolve data for blob" / "The specified blob is
 * invalid" now and then (seen for #56 on 21/09: the home showed "Loaded 5/6"),
 * and the SDK dropped the whole proposal when its metadata failed, so an open
 * question could vanish from the list. The patched FreedomTool.getProposalInfo
 * falls back to this table (config.fallbackMetadata) and logs only the
 * proposal id and a constant code.
 *
 * Keyed by CID, which is the hash of the content: an entry can only ever stand
 * for the exact file the chain points to, so a stale entry is simply never
 * used. Copied verbatim from https://ipfs.rarimo.com/ipfs/<cid> on 22/09/2026;
 * add a question's CID when it enters the index.
 *
 * Since wave 4b C3 this table does more than cover a gateway outage: it is
 * AUTHORITATIVE for the option ORDER, because a vote is an index into
 * `acceptedOptions[q].variants` and a permuted array inverts the meaning of
 * every vote cast without anything on screen betraying it. See
 * utils/ballot-options.ts for the whole argument, for what the chain can and
 * cannot bound on its own, and for the one field the signed proposal index
 * still needs (a per-question metadata CID) before a question published after
 * a build can be protected the same way. Adding a question to the index and
 * forgetting its entry here is therefore a real gap, not a cosmetic one.
 */
export interface BundledProposalMetadata {
  title: string;
  description?: string;
  acceptedOptions: { title: string; variants: string[] }[];
  rankingBased?: boolean;
  imageCid?: string;
}

export const BUNDLED_PROPOSAL_METADATA: Readonly<Record<string, BundledProposalMetadata>> = {
  // #72 and #73
  'QmUgNBTTbJ4jca7fkZGkcSfvSku3dRMthV9MNT5gCPVwk2': {
    "title": "Le référendum d'initiative citoyenne",
    "description": "Voulez-vous que 500 000 citoyens déclenchent eux-mêmes un référendum national, hors du contrôle du Conseil constitutionnel, selon le plan Marianne?",
    "acceptedOptions": [
      {
        "title": "Approuvez-vous le plan Marianne?",
        "variants": [
          "Oui",
          "Non",
          "Blanc",
          "Je refuse de voter"
        ]
      }
    ],
    "rankingBased": false
  },
  // #52
  'QmNRzu3pCx1sThuV4RRsAfkTwf9Q9TwH9CdfMbfomoRZwM': {
    "title": "SUPPRESSION DES ZFE",
    "description": "Approuvez-vous qu'une nouvelle loi soit adoptée avant février 2027 pour supprimer définitivement les ZFE, en réponse à la décision du Conseil constitutionnel du 21 mai de les maintenir ?",
    "acceptedOptions": [
      {
        "title": "Approuvez-vous la suppression définitive des ZFE",
        "variants": [
          "Oui",
          "Non",
          "Blanc",
          "Je refuse de voter"
        ]
      }
    ],
    "rankingBased": false
  },
  // #53
  'QmYVemzbEWXdUXAyVjJjEJunSEuLgUN1MFMCnpqAU2zN4k': {
    "title": "PRIX DES CARBURANTS ET TRANSITION ÉNERGÉTIQUE",
    "description": "Faut-il supprimer les Certificats d'Économie d'Énergie (CEE), malgré leur contribution à la transition énergétique, pour réduire les prix des carburants et de l'énergie ?",
    "acceptedOptions": [
      {
        "title": "Faut-il supprimer les Certificats d'Économie d'Énergie",
        "variants": [
          "Oui",
          "Non",
          "Blanc",
          "Je refuse de voter"
        ]
      }
    ],
    "rankingBased": false
  },
  // #54
  'QmZum1tEa49DZSyKRXArLJABaf26WbUcu7rcVLbLjBavoU': {
    "title": " PRIX DE L'ÉLECTRICITÉ ET ÉNERGIES RENOUVELABLES",
    "description": "Faut-il supprimer les aides publiques à l'éolien et au solaire afin de réduire le coût de l'électricité, quitte à freiner le développement de ces énergies ?",
    "acceptedOptions": [
      {
        "title": "Faut-il supprimer les aides publiques à l'éolien et au solaire?",
        "variants": [
          "Oui",
          "Non",
          "Blanc",
          "Je refuse de voter"
        ]
      }
    ],
    "rankingBased": false
  },
  // #55
  'QmXLqmiXChjhkQDxUqZZv5VcWfwj91Tx1v4YqBZifoEoDw': {
    "title": "RÉFORME DU SYSTÈME DE SANTÉ",
    "description": "Approuvez-vous le plan de l'Institut Santé pour refonder le système de santé par de la prévention, une gouvernance départementale et un équilibre financier constitutionnel de la Sécurité sociale?",
    "acceptedOptions": [
      {
        "title": "Approuvez-vous le plan de l'Institut Santé pour la santé?",
        "variants": [
          "Oui",
          "Non",
          "Blanc",
          "Je refuse de voter"
        ]
      }
    ],
    "rankingBased": false
  },
  // #56
  'QmTEqK8AkwRRo1m3vbLWrq2DMpgC17NTSMipwryrKyQySE': {
    "title": "Responsabilité des magistrats",
    "description": "Faut-il que les magistrats répondent personnellement de leurs fautes lourdes devant une cour de personnalités qualifiées extérieures à la magistrature, selon le plan \"Responsabilité des\nmagistrats\" ?",
    "acceptedOptions": [
      {
        "title": "Approuvez-vous le plan « Responsabilité des magistrats »?",
        "variants": [
          "Oui",
          "Non",
          "Blanc",
          "Je refuse de voter"
        ]
      }
    ],
    "rankingBased": false
  },
};
