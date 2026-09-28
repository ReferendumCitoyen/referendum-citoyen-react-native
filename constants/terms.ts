/**
 * Terms & Conditions (CGU) — single source of truth.
 *
 * `TERMS_VERSION` is the version string persisted in AsyncStorage when the
 * user accepts. On app startup we compare the stored value against this
 * constant via string equality; mismatch → the gate fires again. To force a
 * re-acceptance after a CGU change, bump this constant.
 *
 * The body is stored inline as a single TS string literal (rather than an
 * external asset) so:
 *   - There's no extra Asset.fromModule / async load step at the gate.
 *   - The build-time type system catches missing imports.
 *   - Search-and-replace edits are immediately visible in source review.
 *
 * The body uses **Markdown syntax** (rendered by react-native-markdown-display
 * in components/TermsBody.tsx). Supported inline formatting:
 *   - `## Heading`        → article / section heading
 *   - `**bold**`          → bold span
 *   - `*italic*`          → italic span
 *   - `- item` lists      → bullet list
 *   - `[label](url)`      → hyperlink
 *
 * Content is French only (this is a French legal document; per the
 * 2026-05-22 product decision, other locales fall back to French here rather
 * than receive an unreviewed machine translation).
 *
 * Source of the current text: CGU-app-15-Sept-2026.md from the 2026-09-13
 * production brief, reworded on 2026-09-15 for the ID-card-only launch
 * (version 2.0.0, one document, article 4.5 without any server) — to be
 * aligned word for word with https://referendumcitoyen.fr/cgu.html once the
 * publisher's final text is in. Everywhere the CGU appear (first-launch consent,
 * Paramètres, Comprendre) renders this one constant, so the text and its
 * date cannot diverge.
 */

// Bumped on 2026-09-23 with the corrections of the traceability review:
// article 2 now states the OS floors the build actually accepts, article 3.3
// says the exported key file is in clear, and article 4.5 names the
// third-party operator that receives the proof and the fingerprint. Those are
// substantive changes to a contract, so every user re-accepts (app/_layout.tsx
// compares the stored value with this one). PENDING THE PRODUCT OWNER AND
// LEGAL: the published https://referendumcitoyen.fr/cgu.html still carries the
// 15/09 text and has to be aligned word for word before this ships.
export const TERMS_VERSION = '2026-09-23';

/** Shown under the title, wherever the CGU are displayed. */
export const TERMS_UPDATED_FR = 'Dernière mise à jour : 23 septembre 2026';

export const TERMS_TITLE_FR =
  "Conditions Générales d'Utilisation de l'application « Référendum Citoyen »";

export const TERMS_TEXT_FR = `Dernière mise à jour : 23 septembre 2026 (version 2.0.2 de l'application, vote par carte d'identité). L'Utilisateur doit consentir à ces CGU avant de pouvoir utiliser l'application.

## Préambule

Les présentes Conditions Générales d'Utilisation (ci-après les « CGU ») régissent l'accès et l'utilisation de l'application mobile « REFERENDUM CITOYEN » (ci-après l'Application), éditée par l'association « LIBÉREZ VOUS CITOYENS » sise 70 rue La Boétie, 75008 Paris représentée par son Président Robinson Jardin (ci-après « l'Éditeur »), dédiée à l'organisation de consultations publiques et de votes par tout citoyen qui souhaitera en faire usage dans les conditions détaillées dans ce document (ci-après l'Utilisateur).

L'Application a pour objectif de permettre aux citoyens de participer à des votes et consultations de manière sécurisée, intègre et anonyme, en garantissant le principe « une personne, une voix » grâce à un mécanisme de vérification d'identité sans conservation de donnée nominative. Les coûts d'inscription des votes sont pris en charge par l'Éditeur de manière à ce que l'Utilisateur puisse voter gratuitement ; seul le coût du téléphone et de son fonctionnement reste à la charge de l'Utilisateur.

Les présentes CGU s'appliquent à la version 2.0.0 de l'Application et aux versions suivantes. Elles couvrent également les services du site referendumcitoyen.fr (pétitions, lettre d'information, page Contribuer) décrits à l'article 10.

## Article 1. Acceptation des CGU

L'accès et l'utilisation de l'Application impliquent l'acceptation pleine et entière des présentes CGU par l'Utilisateur. Si l'Utilisateur n'accepte pas ces CGU, il ne doit pas utiliser l'Application.

## Article 2. Objet de l'Application

L'Application permet aux citoyens de participer à des consultations publiques et des votes citoyens.

Elle assure :

- La vérification de l'éligibilité au vote et l'absence de doublons via la lecture de la puce NFC de la pièce d'identité ;

- L'expression d'un vote d'une manière anonyme ;

- Des garanties techniques sur l'intégrité du décompte : chaque bulletin est inscrit sur un registre public et vérifiable par tout tiers.

## Article 3. Accès et Utilisation du Service

### 3.1. Conditions d'accès et pièces d'identité acceptées

L'accès à l'Application est réservé aux citoyens français majeurs, éligibles aux consultations ou votes proposés, et détenteurs d'une pièce d'identité française disposant d'une puce NFC.

Une seule pièce d'identité est acceptée (ci-après « la pièce d'identité ») : la carte nationale d'identité française au format carte bancaire, délivrée depuis août 2021, lue à partir du code d'accès à six chiffres (code CAN) imprimé au recto de la carte. Le passeport et l'ancienne carte d'identité plastifiée ne sont pas acceptés dans cette version.

Une seule carte par personne. Une carte d'identité ne peut être enregistrée qu'une fois, et ne vote qu'une fois par question, quel que soit le téléphone utilisé.

L'Utilisateur doit disposer d'un smartphone compatible avec la technologie NFC. L'Application est compatible avec les appareils répondant aux conditions suivantes :

- iPhone : iPhone 8, iPhone SE (2e génération) ou modèle plus récent, sous iOS 16 ou version ultérieure ; un iPhone 11 sous iOS 17 ou version ultérieure est recommandé ;

- Android : Android 8.1 ou version ultérieure, avec une puce NFC ; Android 10 ou version ultérieure est recommandé.

L'Éditeur ne garantit pas le bon fonctionnement de l'Application sur des appareils ne satisfaisant pas ces exigences minimales. Ces conditions sont susceptibles d'évoluer lors de mises à jour de l'Application.

### 3.2. Processus de vote et vérification d'identité

Pour voter, l'Utilisateur devra :

- Télécharger sur son smartphone l'Application depuis le site referendumcitoyen.fr ou un magasin d'applications (App Store, Google Play) ;

- Accepter son installation et ouvrir l'Application ;

- Saisir le code CAN de sa carte, qui sert uniquement à ouvrir la communication avec la puce ;

- Positionner comme indiqué par l'Application sa pièce d'identité contre le smartphone pour la lecture de la puce NFC ;

- Attendre la génération de la preuve cryptographique et de la clé de vote, qui peut durer une à deux minutes lors du premier enregistrement et nécessite de garder l'Application ouverte ;

- Sauvegarder la clé de vote lorsque l'Application le propose (voir article 3.3) ;

- L'Application utilise les données de la puce pour produire une empreinte non nominative de la pièce d'identité, dont le seul but est de vérifier que cette pièce n'a pas déjà été enregistrée, et une preuve d'éligibilité ;

- Aucune donnée nominative de la pièce d'identité n'est conservée par l'Application, l'Éditeur ou un tiers ;

- Une fois la vérification effectuée et l'éligibilité confirmée, l'Utilisateur pourra exprimer son vote ;

- Le vote est enregistré de manière anonyme et ne peut en aucun cas être rattaché à l'empreinte générée lors de la vérification, ni à la pièce d'identité de l'Utilisateur.

### 3.3. Sauvegarde de la clé de vote

Lors du premier enregistrement d'une pièce d'identité, l'Application génère une clé cryptographique aléatoire, conservée uniquement sur le téléphone de l'Utilisateur. Cette clé est indispensable pour voter à nouveau avec la même pièce d'identité, sur ce téléphone ou sur un autre.

L'Utilisateur est seul responsable de la conservation de cette clé. L'Application lui propose de l'exporter dans un fichier depuis le menu « Gestion des clés », et de l'importer sur un nouvel appareil.

Ce fichier n'est protégé par aucun mot de passe : la clé y figure en clair. Quiconque l'ouvre peut savoir comment l'Utilisateur a voté, sur le scrutin en cours comme sur les suivants. Il ne permet pas en revanche de voter à sa place, ce qui suppose également la pièce d'identité. L'Application affiche cet avertissement avant chaque export. Il appartient à l'Utilisateur de conserver ce fichier comme un document confidentiel, sur un support qu'il maîtrise, et d'éviter de l'envoyer par messagerie ou de le déposer dans un espace de stockage en ligne.

La clé n'est transmise ni à l'Éditeur ni à un tiers : en cas de perte (suppression de l'Application, changement ou perte de téléphone sans sauvegarde), l'Éditeur n'est pas en mesure de la restaurer, et la pièce d'identité concernée ne peut plus être utilisée pour voter.

### 3.4. Disponibilité du service

L'inscription des votes dans le registre public a un coût, financé par les dons. Si les fonds destinés à cette inscription sont temporairement épuisés, l'Éditeur peut suspendre l'enregistrement des votes jusqu'à leur reconstitution. L'Utilisateur en est informé dans l'Application avant de voter ; aucun bulletin n'est enregistré pendant la suspension. Il pourra voter dès la reprise du service, jusqu'à la clôture de la question. L'Éditeur publie sur le site l'état du service.

## Article 4. Anonymat

### 4.1. Principes

L'Éditeur conçoit l'Application de façon à ce qu'aucun tiers, ni l'Éditeur lui-même, ne puisse relier un vote à une personne.

### 4.2. Traitement des données de la pièce d'identité

Lors de la vérification de la pièce d'identité, l'Application procède à un traitement transitoire, sur le téléphone, des données lues dans la puce (état civil de la bande MRZ, données complémentaires d'identité et signature électronique de l'État) pour générer une empreinte non réversible de la pièce et une preuve d'éligibilité. Ce traitement est strictement limité à la finalité de non duplication des votes et de vérification de l'éligibilité. Ces données sont effacées de la mémoire de l'Application après traitement. Seules subsistent sur le téléphone la clé de vote décrite à l'article 3.3 et l'empreinte technique de la pièce, qui ne permettent pas d'identifier leur titulaire.

### 4.3. Droits des personnes concernées (RGPD)

Conformément au Règlement Général sur la Protection des Données (RGPD), l'Éditeur s'engage à la transparence sur le processus de vérification. Les traitements réalisés sont décrits dans la politique de confidentialité.

Pour toute question relative aux données personnelles, l'Utilisateur peut contacter l'Éditeur à l'adresse électronique referendumcitoyen@proton.me ou à l'adresse postale 70 rue La Boétie, 75008 Paris.

### 4.4. Données de vote

Les votes exprimés sont enregistrés de manière anonyme et agrégée grâce à RARIMO, une méthode qui permet de prouver la validité d'une identité sans révéler aucune information sur celle-ci. C'est un protocole cryptographique dit « preuve à divulgation nulle de connaissance » (ou Zero-Knowledge Proof, ZKP).

Il n'est pas possible de reconstituer un vote individuel ou de le relier à un Utilisateur.

Les résultats du vote sont accessibles dans l'Application et sur le site internet de l'Association.

### 4.5. Vérification sur le téléphone, inscription dans le registre public

La vérification de la pièce d'identité est effectuée par l'Application, sur le téléphone. Aucune donnée lue dans la pièce d'identité n'est transmise à un serveur exploité par l'Éditeur, et l'Éditeur n'exploite aucun serveur recevant des données personnelles des Utilisateurs.

L'inscription de la pièce d'identité et le vote passent en revanche par les serveurs d'un opérateur tiers, celui du protocole RARIMO mentionné à l'article 4.1, qui les inscrit dans le registre public. Cet opérateur reçoit la preuve mathématique produite sur le téléphone, l'empreinte non réversible de la pièce décrite à l'article 3.2 et, lorsque cela est nécessaire, le certificat de signature électronique de l'État lu dans la puce. Ces éléments sont conservés de façon permanente dans le registre public. Ils ne comportent ni le nom, ni la date de naissance, ni le numéro de la pièce d'identité de l'Utilisateur.

La règle « une personne, une voix » repose uniquement sur cette empreinte : une carte ne peut être enregistrée qu'une fois, et sa clé de vote ne peut voter qu'une fois par question.

## Article 5. Sécurité

L'Éditeur met en œuvre des mesures techniques et organisationnelles appropriées pour garantir la sécurité, l'intégrité et la confidentialité du processus de vote. L'Application est développée avec une attention particulière quant à la protection contre les tentatives de fraude ou d'altération des résultats.

## Article 6. Responsabilité

### 6.1. Responsabilité de l'Éditeur

L'Éditeur s'engage à fournir un service fiable et sécurisé. Sa responsabilité ne pourra être engagée en cas de défaillance technique indépendante de sa volonté, de force majeure, d'indisponibilité du registre public ou de ses opérateurs, ou d'une mauvaise utilisation de l'Application par l'Utilisateur. L'Éditeur ne pourra être tenu responsable d'une usurpation d'identité ou d'un vol de pièce d'identité lors de l'utilisation de l'Application, ni de la perte de la clé de vote par l'Utilisateur, sauf faute prouvée de l'Éditeur dans la conception ou l'exploitation de l'Application.

### 6.2. Responsabilité de l'Utilisateur

L'Utilisateur est seul responsable de l'utilisation de sa propre pièce d'identité, de la conservation de sa clé de vote et de l'utilisation conforme de l'Application. L'utilisation de la pièce d'identité d'un tiers est interdite. Toute tentative de fraude ou de contournement du système de vérification peut donner lieu au rejet des votes concernés, à l'exclusion du service et, le cas échéant, à des poursuites sur le fondement des articles 323-1 et suivants du code pénal (atteintes aux systèmes de traitement automatisé de données) et de l'article 441-1 du même code (faux).

## Article 7. Propriété Intellectuelle

Les droits sur l'Application, son nom, son contenu (textes, images, graphismes, logos, icônes, etc.) et sa technologie sont détenus par l'Éditeur ou ses partenaires. Toute reproduction, représentation, modification, publication, adaptation de tout ou partie des éléments de l'Application, quel que soit le moyen ou le procédé utilisé, est interdite, sauf autorisation écrite préalable de l'Éditeur ou licence libre expressément accordée.

## Article 8. Modifications des CGU

L'Éditeur peut modifier les présentes CGU. Les modifications substantielles sont signalées dans l'Application lors de sa prochaine ouverture et prennent effet quinze jours après leur publication sur le site, avec la date de mise à jour indiquée en tête du document, sauf pour les corrections d'erreurs et les mises en conformité légales, qui prennent effet dès leur publication. L'Éditeur ne conservant aucune coordonnée des Utilisateurs de l'Application, il ne peut pas les avertir individuellement.

## Article 9. Droit Applicable et Juridiction Compétente

Les présentes CGU sont régies par le droit français. Tout litige relève des juridictions françaises compétentes selon les règles du code de procédure civile et du code de la consommation. Avant toute action, l'Utilisateur peut adresser une réclamation à l'Éditeur à referendumcitoyen@proton.me, qui y répond dans un délai d'un mois.

## Article 10. Services du site referendumcitoyen.fr

### 10.1. Pétitions

Le site publie des pétitions, c'est-à-dire des questions accompagnées d'un exposé et d'arguments, pour être lues, discutées et partagées. Les signatures ne sont pas encore ouvertes : elles ouvriront en octobre 2026. Jusqu'à cette ouverture, le site ne collecte aucune adresse e-mail ni aucune signature au titre des pétitions. Le dispositif de signature, ses conditions et les informations sur les données traitées seront publiés sur le site avant l'ouverture et feront l'objet d'une mise à jour des présentes CGU. Une pétition n'est pas un vote : elle mesure un volume d'intérêt et n'engage pas le mécanisme de vérification d'identité de l'Application.

### 10.2. Lettre d'information

Le site annonce une lettre d'information. Le formulaire d'inscription n'est pas encore ouvert : à ce jour, le site ne collecte aucune adresse e-mail à ce titre. L'inscription se fera uniquement sur le site, jamais dans l'Application, après confirmation par un lien reçu à l'adresse indiquée, et ne sera reliée à aucun vote.

### 10.3. Contributions

Le vote est gratuit. Les personnes qui le souhaitent peuvent contribuer au financement du service depuis la page « Contribuer » du site. L'Éditeur ne disposant pas encore de sa propre plateforme de dons, les contributions sont collectées au bénéfice de l'association Les #Gueux, qui finance l'infrastructure de vote, par carte bancaire sur la page de paiement de cette association ou par virement. Un don n'ouvre droit à aucun avantage dans l'Application et ne peut être relié à un vote. Un don n'ouvre pas droit à réduction d'impôt : aucun reçu fiscal n'est délivré. Les fonds collectés ne servent à aucune campagne électorale ni à aucun candidat.
`;
