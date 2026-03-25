# Frontend TODO - Référendum Citoyen

## 🚨 Critical - Waiting on Backend/Design

### Backend Coordination
- [ ] Finalize API contracts with backend engineer
  - [ ] Vote list/details endpoint structure
  - [ ] Vote submission payload format
  - [ ] Results data format
  - [ ] User verification response
- [ ] Clarify smart contract integration
  - [ ] Is vote submission direct to contract or through API?
  - [ ] How does anonymous token generation work?
  - [ ] Where do vote results come from (blockchain vs database)?
- [ ] Define error response formats
  - [ ] Already voted
  - [ ] Invalid identity
  - [ ] Network failures
  - [ ] Vote period ended

### Missing Screens (from Designer)
- [ ] Vote detail/information screen (deep dive into specific vote)
- [ ] Vote history (past votes user participated in)
- [ ] Empty state when no active votes
- [ ] Network error screen
- [ ] Legal/privacy policy screens (app store requirement)

## 🔧 Technical Implementation

### NFC Integration
- [ ] Install and configure `react-native-nfc-manager`
- [ ] Implement NFC reader for carte d'identité chip
- [ ] Extract required data from NFC chip
- [ ] Handle NFC errors (no chip, read failure, etc.)
- [ ] Add NFC availability detection
- [ ] Test on real carte d'identité

### Camera / MRZ Scanning
- [ ] Research MRZ OCR library (react-native-mlkit or similar)
- [ ] Implement MRZ scanner for Step 5
- [ ] Extract data from machine-readable zone
- [ ] Add manual fallback if OCR fails
- [ ] Handle camera permissions properly
- [ ] Optimize scanning accuracy

### Smart Contract Integration
- [ ] Choose Web3 library (ethers.js, web3.js, or wagmi)
- [ ] Set up wallet/provider connection
- [ ] Implement vote submission to smart contract
- [ ] Implement anonymous token verification
- [ ] Fetch vote results from blockchain
- [ ] Handle transaction errors and pending states
- [ ] Add transaction confirmation UI

### Identity Verification
- [ ] Clarify local vs server verification split
- [ ] Implement age verification logic
- [ ] Implement nationality verification logic
- [ ] Ensure data is encrypted and not stored
- [ ] Add verification status feedback

## ✨ Features & Polish

### Core Features
- [ ] Pull-to-refresh on home screen
- [ ] Real-time vote results updates (WebSocket or polling?)
- [ ] Share vote results feature
- [ ] Deep linking to specific votes
- [ ] Push notifications for new votes

### UX Improvements
- [ ] Add haptic feedback on important actions
- [ ] Loading states for all async operations
- [ ] Skeleton screens while data loads
- [ ] Error retry mechanisms
- [ ] Offline mode handling
- [ ] Success animations for vote submission

### Accessibility
- [ ] Add accessibility labels to all interactive elements
- [ ] Test with VoiceOver/TalkBack
- [ ] Ensure sufficient color contrast
- [ ] Support dynamic font sizes

## 🐛 Known Issues
- [ ] Remove debug countdown displays from Step 7 and Step 11
- [ ] Clean up console.log statements from bottom sheet
- [ ] Remove mock random success/fail logic

## 📱 App Store Prep
- [ ] Privacy policy screen
- [ ] Terms of service screen
- [ ] App store screenshots
- [ ] App store description
- [ ] Handle app permissions properly
- [ ] Test on various device sizes

## 🔒 Security
- [ ] Ensure ID data is never transmitted unencrypted
- [ ] Verify data is cleared after vote submission
- [ ] Add certificate pinning for API calls
- [ ] Implement proper key storage for crypto
- [ ] Security audit before launch

## 🎯 Before Launch
- [ ] End-to-end testing of entire vote flow
- [ ] Test error scenarios
- [ ] Performance optimization
- [ ] Remove all debug code
- [ ] Final QA pass

---

## Questions for Backend Engineer
1. Is vote submission direct to smart contract or through our API?
2. Is identity verification 100% local or does server validate anything?
3. Where do vote results come from - blockchain or database?
4. What blockchain are we using? (Ethereum, Polygon, custom?)
5. How is the anonymous token generated and stored?
6. Do we need a wallet connection or is it handled differently?

## Questions for Designer
1. Vote detail screen design?
2. Vote history screen design?
3. Empty states design?
4. Error screen designs?
5. Legal/privacy screens design?


---

## QA Report - Robinson Jardin (v1.1, iOS, 2026-03-25)

### Done (copy fixes in `locales/fr.json`)
- [x] 2.1 - Comprendre intro text rewrite
- [x] 2.2 - Typo fix "nom à votre vote" -> "nom et votre vote" + grammar
- [x] 2.3 - Rewrite "Les autres peuvent voter" title + body
- [x] 2.4 - Fix duplicated sentence in "Que se passe-t-il"
- [x] 6 - Step 3 grammar: "vérifiées et authentiques" -> "vérifiées comme authentiques"
- [x] 3 - Rename "Accueil" tab to "Votes" (all locale files)

### Done - Easy
- [x] 12 - Update "Vote transparent" text: removed individual verification claim (no Vérifier feature yet)

### Done - Medium
- [x] 8+14 - Add NFC text instruction on Step 6
- [x] 11 - Add "Résultats à l'heure actuelle" label above charts for active referendums

### TODO - Medium
- [ ] 9 - Remove/hide language selection in production (keep behind dev mode)

### Done - Large
- [x] 5+15 - Extended voting options: chart + vote UI already dynamic, fixed label readability for 4-6 options

### TODO - Large (needs design/product decisions)
- [ ] 4+11 - Two result display modes: hidden until closing vs live (needs backend flag per proposal)
- [ ] 2.5+10+13 - "Vérifier" tab: verify vote on-chain (scan ID -> derive token -> query blockchain). Until built, verification claims in Comprendre are misleading.
- [ ] 7 - Multi-user same-device flow: needs real-device QA with 2 IDs 