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
 * Content is French-git n (this is a French legal document; per
 * the 2026-05-22 product decision, other locales fall back to French here
 * rather than receive an unreviewed machine translation).
 */

export const TERMS_VERSION = '2026-05-22';

export const TERMS_TITLE_FR =
  "Conditions Générales d'Utilisation de l'application « Referendum Citoyen »";

export const TERMS_TEXT_FR = `**NB.** L'Utilisateur doit consentir à ces CGU avant de pouvoir utiliser l'application.

## Préambule

Les présentes Conditions Générales d'Utilisation (ci-après les *« CGU »*) régissent l'accès et l'utilisation de l'application mobile **« REFERENDUM CITOYEN »** (ci-après *l'Application*), éditée par l'association **« LIBÉREZ VOUS CITOYENS »** sise 70 rue La Boétie, 75008 représentée par son Président Robinson Jardin (ci-après *« l'Éditeur »*), dédiée à l'organisation de consultations publiques et de votes par tout citoyen qui souhaitera en faire usage dans les conditions détaillées dans ce document (ci-après *l'Utilisateur*).

L'application a pour objectif de permettre aux citoyens de participer à des votes et consultations de manière **sécurisée, intègre et anonyme**, en garantissant le principe *« une personne, une voix »* grâce à un mécanisme de vérification d'identité **sans conservation de donnée personnelle**. Les coûts sont pris en charge par l'Éditeur de manière à ce que l'Utilisateur puisse voter gratuitement ; seul le coût du téléphone et de son fonctionnement restent à la charge de l'Utilisateur.

## Article 1. Acceptation des CGU

L'accès et l'utilisation de l'Application impliquent l'acceptation **pleine et entière** des présentes CGU par l'utilisateur. *Si l'utilisateur n'accepte pas ces CGU, il ne doit pas utiliser l'Application.*

## Article 2. Objet de l'Application

L'Application permet aux citoyens de participer à des consultations publiques et des votes citoyens.

Elle assure :

- La **vérification de l'éligibilité** au vote et l'absence de doublons via la lecture de la puce NFC de la pièce d'identité
- L'expression d'un vote **d'une manière anonyme**
- La garantie de l'**intégrité et de la sincérité** des résultats

## Article 3. Accès et Utilisation du Service

### 3.1. Conditions d'accès

L'accès à l'Application est réservé aux **citoyens français majeurs**, éligibles aux consultations ou votes proposés, et qui sont détenteurs d'une pièce d'identité française disposant d'une puce NFC.

À ce jour, **seul le passeport français** (ci-après *« la pièce d'identité »*) est accepté par l'Application. La carte nationale d'identité française, bien qu'elle soit également équipée d'une puce NFC, ne peut pas être utilisée pour le moment pour éviter le risque de double vote d'un utilisateur (avec le passeport et avec la carte d'identité). L'Éditeur n'acceptera la carte nationale d'identité que lorsque cette garantie sera techniquement disponible.

L'utilisateur doit disposer d'un smartphone compatible avec la technologie NFC. L'Application est compatible avec les appareils répondant aux conditions suivantes :

- **iPhone** : iOS 17 ou version ultérieure
- **Android** : Android 10 ou version ultérieure

La lecture du passeport requiert un appareil équipé d'un appareil photo fonctionnel. L'Éditeur ne garantit pas le bon fonctionnement de l'Application sur des appareils ne satisfaisant pas ces exigences minimales. Ces conditions sont susceptibles d'évoluer lors de mises à jour de l'Application.

### 3.2. Processus de vote et vérification d'identité

Pour voter, l'utilisateur devra :

- Télécharger sur son smartphone l'Application sur le site **referendumcitoyen.fr** ou sur un magasin d'applications (*Stores*)
- Accepter son installation et ouvrir l'Application
- Positionner comme indiqué par l'application sa pièce d'identité contre le smartphone
- L'application lira la puce NFC pour extraire un **identifiant unique et non nominatif** de la pièce d'identité dont le seul but sera de vérifier que l'utilisateur n'a pas déjà voté avec cette pièce d'identité
- **Aucune donnée personnelle** de la pièce d'identité n'est conservée par l'application, l'Éditeur ou un tiers
- Une fois la vérification effectuée et l'éligibilité confirmée, l'utilisateur pourra exprimer son vote.
- Le vote est enregistré de manière **anonyme** et ne peut en aucun cas être rattaché à l'identifiant unique généré lors de la vérification, ni à la pièce d'identité de l'utilisateur.

## Article 4. Anonymat

### 4.1. Principes

L'Éditeur s'engage à respecter les principes fondamentaux du vote électronique, notamment le **secret du scrutin** et le **caractère anonyme du vote**.

### 4.2. Traitement des données

Lors de la vérification de la pièce d'identité, l'application procède à un traitement **transitoire, très bref**, de certaines données techniques issues de la puce pour générer un identifiant unique et non réversible. Ce traitement est strictement limité à la finalité de non duplication des votes et de vérification de l'éligibilité. Ces données **ne sont ni stockées, ni conservées, ni transmises à des tiers** sous une forme permettant d'identifier l'utilisateur.

### 4.3. Droits des personnes concernées (RGPD)

Conformément au **Règlement Général sur la Protection des Données (RGPD)**, bien qu'aucune donnée personnelle ne soit conservée, l'Éditeur s'engage à la transparence sur le processus de vérification.

Pour toute question relative aux données personnelles, l'utilisateur peut contacter l'Éditeur à l'adresse électronique *referemdumcitoyen@proton.me* ou à l'adresse postale 70 rue La Boétie, 75008 Paris.

### 4.4. Données de vote

Les votes exprimés sont enregistrés de manière **totalement anonyme et agrégée** grâce à RARIMO, une méthode qui permet de prouver la validité d'une identité sans révéler aucune information sur celle-ci. C'est un protocole cryptographique dit *« preuve à divulgation nulle de connaissance »* (ou *Zero-Knowledge Proof, ZKP*).

Il est **impossible de reconstituer un vote individuel** ou de le relier à un utilisateur.

Les résultats finaux du vote seront accessibles sur le site internet de l'Association.

## Article 5. Sécurité

L'Éditeur met en œuvre des mesures techniques et organisationnelles appropriées pour garantir la **sécurité, l'intégrité et la confidentialité** du processus de vote. L'Application est développée avec une attention particulière quant à la protection contre les tentatives de fraude ou d'altération des résultats.

## Article 6. Responsabilité

### 6.1. Responsabilité de l'Éditeur

L'Éditeur s'engage à fournir un service fiable et sécurisé. Sa responsabilité ne pourra être engagée en cas de défaillance technique indépendante de sa volonté, de force majeure, ou d'une mauvaise utilisation de l'Application par l'utilisateur. L'Éditeur ne pourra être tenu responsable d'une usurpation d'identité ou d'un vol de pièce d'identité lors de l'utilisation de l'Application.

### 6.2. Responsabilité de l'utilisateur

L'utilisateur est **seul responsable** de l'utilisation de sa propre pièce d'identité et de l'utilisation conforme de l'Application. Toute tentative de fraude ou de contournement du système de vérification entraînera des poursuites.

## Article 7. Propriété Intellectuelle

Les droits sur l'Application, son nom, son contenu (textes, images, graphismes, logos, icônes, etc.) et sa technologie sont détenus par l'Éditeur. Toute reproduction, représentation, modification, publication, adaptation de tout ou partie des éléments de l'application, quel que soit le moyen ou le procédé utilisé, est **interdite**, sauf autorisation écrite préalable de l'Éditeur.

## Article 8. Modifications des CGU

L'Éditeur se réserve le droit de modifier les présentes CGU à tout moment. Les modifications prendront effet **dès leur publication sur l'application**. Il est recommandé à l'utilisateur de consulter régulièrement le site où figurent les CGU pour prendre connaissance des éventuelles modifications. Il ne peut y avoir d'avertissement de l'Utilisateur puisque l'Application ne conserve aucune donnée.

## Article 9. Droit Applicable et Juridiction Compétente

Les présentes CGU sont régies par le **droit français**. Tout litige relatif à l'interprétation ou à l'exécution des présentes CGU sera soumis aux tribunaux compétents de **Paris**.`;
