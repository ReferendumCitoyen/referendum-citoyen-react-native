# Testing Protocol: Referendum Citoyen App

**Quick Reference Guide for Demonstration**

---

## Prerequisites

- **Device:** iOS 13+ or Android 10+ with NFC
- **Test Materials:** Passport or French ID card with NFC chip
- **Permissions:** Camera (for MRZ scanning)

---

## Quick Test Checklist

### Basic Navigation (2 minutes)
- [ ] Open app and verify 3 tabs work (Home, Comprendre, Paramètres)
- [ ] Toggle dark mode on/off in Settings
- [ ] Switch language (French ↔ English)

### Home Screen (1 minute)
- [ ] Verify 3 vote cards display with correct badges:
  - "Vote en cours" (active)
  - "Bientôt" (upcoming)
  - "Terminé" (finished)
- [ ] Check bar charts show results (76.8% Oui, 4.3% Blanc, 18.9% Non)

### Voting Flow - Full Demo (5-10 minutes)
- [ ] Tap "Voter" button on active vote
- [ ] Steps 1-3: Navigate through educational videos
- [ ] Step 4: Grant camera permission
- [ ] Step 5: Scan ID card MRZ (or use "Remplir manuellement" for manual input)
- [ ] Step 6: Place phone on card for NFC reading
- [ ] Step 7: Watch 5-second verification countdown
- [ ] Step 8: See "Vous êtes prêt" success screen
- [ ] Step 10: Confirm vote
- [ ] Step 11: Watch submission loading
- [ ] Step 12: See success screen with confetti

### NFC Testing (3-5 minutes)
- [ ] Go to Settings → Test NFC
- [ ] Verify Rarimo testnet profile key generated
- [ ] Scan MRZ with camera
- [ ] Tap "Scan Passport (EDocument)" and read NFC chip
- [ ] Verify person details extracted correctly
- [ ] (Optional) Register identity on testnet

---

## Main Features Guide

## 1. Navigation & UI

**Test:** Basic app navigation
- Launch app → 3 tabs at bottom (Home, Comprendre, Paramètres)
- Tap each tab to verify navigation works
- Custom tab bar should highlight active tab

**Test:** Dark mode
- Settings → Toggle "Dark Mode" switch
- Entire app theme should change instantly

**Test:** Language switching
- Settings → Tap "Langue" row
- Text switches between French and English

---

## 2. Home Screen

**What to check:**
- Vote list section at top (2 items with caret icons)
- Active vote card shows:
  - Badge: "Vote en cours"
  - Vote stats: 6,932 votes, 24J 12H 5M remaining
  - Blue "Voter" button
  - Results bar chart with 3 colored bars
- Upcoming vote card (badge: "Bientôt")
- Finished vote card (badge: "Terminé") with results

---

## 3. Complete Voting Flow

**Entry point:** Tap "Voter" button on active vote card

### Platform Differences:
- **iOS:** Bottom sheet modal (swipe down to close)
- **Android:** Full-screen (back button to exit)

### Flow Steps:

**Steps 1-3: Educational Videos**
- 3 videos explaining the process
- Progress bar (3 dots) at bottom
- Arrow button to advance

**Step 4: Camera Permission**
- Tap "Commencer l'analyse" button
- Grant camera permission when prompted

**Step 5: MRZ Scan**
- Point camera at back of ID card
- Hold steady for automatic detection
- **Fallback:** Tap "Remplir manuellement" to enter manually:
  - Document Number (e.g., 123456789)
  - Birth Date (YYMMDD format: 900101)
  - Expiry Date (YYMMDD format: 301231)

**Step 6: NFC Reading**
- Follow instruction: "Placez votre téléphone sur votre carte"
- Place phone flat on back of card
- Hold steady for 5-30 seconds
- Status updates shown in real-time
- **Note:** If "Invalid MRZ" error, returns to Step 5

**Step 7: Verification**
- 5-second countdown with person details displayed
- Shows name and birthdate from NFC data
- Automatically proceeds to success or error

**Step 8: Success**
- "Vous êtes prêt" message
- Tap "Votez maintenant" button

**Step 10: Confirmation**
- Shows "Êtes-vous sûr de voter : OUI ?"
- Tap "Confirmer" (or "Annuler" to cancel)

**Step 11: Submission**
- Loading animation (~3 seconds)
- Randomly succeeds or fails (demo mode)

**Step 12: Result**
- **Success:** Confetti animation + "Voir les résultats"
- **Error:** Error message + "Retour à l'accueil"

---

## 4. NFC Test Screen

**Access:** Settings → Test NFC

**What to test:**

1. **Rarimo Testnet**
   - Profile key automatically generated
   - Check document registration status
   - Tap "Register Identity on Testnet" to register

2. **MRZ Scanning**
   - Use camera to scan ID card back
   - Or manually enter: Document Number, Birth Date, Expiry Date

3. **Passport Reading (EDocument)**
   - Tap "Scan Passport (EDocument)"
   - Place phone on card for full NFC read
   - Person details should display after successful read

---

## Known Limitations

**What's NOT connected:**
- Backend API (vote list uses mock data)
- Vote submission (randomly simulates success/error)
- Smart contract integration (testnet only in NFC screen)
- RPC settings (placeholder)

**What IS working:**
- All UI/UX flows
- NFC passport/ID reading
- MRZ camera scanning
- Rarimo testnet integration (Test NFC screen)
- Local verification simulation

---

## Troubleshooting

**Camera not working (Step 5)?**
- Grant camera permission in device Settings → [App] → Permissions

**MRZ not detecting?**
- Ensure good lighting
- Hold card flat and steady
- Use "Remplir manuellement" as fallback

**NFC timeout?**
- Remove phone case
- Position phone flat against card center
- Hold very steady
- Android: 30-second timeout, retry if needed

**Invalid MRZ error?**
- Verify date format: YYMMDD (6 digits)
- Check document number matches card
- Re-scan or re-enter manually

---

## Test Data Examples

**MRZ Format (ID Card - TD1):**
```
Document Number: 123456789
Birth Date: 900101 (means 01/01/1990)
Expiry Date: 301231 (means 31/12/2030)
```

**Date Format:**
- MRZ uses YYMMDD (6 digits)
- Example: `900101` = January 1, 1990
- Example: `301231` = December 31, 2030

---

## Demo Checklist

**For a complete demo to stakeholders:**

1. ✅ Show home screen (3 vote cards with results)
2. ✅ Demonstrate dark mode toggle
3. ✅ Walk through voting flow (Steps 1-12)
4. ✅ Scan real ID card (MRZ + NFC)
5. ✅ Show Test NFC screen capabilities
6. ✅ Explain known limitations (backend pending)

**Total demo time:** ~15-20 minutes

---

## Summary

**What's Complete:**
- ✅ Full UX/UI per designs
- ✅ NFC passport/ID reading
- ✅ MRZ camera scanning
- ✅ 12-step voting flow
- ✅ Dark mode & bilingual support
- ✅ Rarimo testnet integration

**What's Pending:**
- ⏳ Backend API integration
- ⏳ Smart contract connection
- ⏳ Production deployment

---

**Document Version:** 1.0
**Last Updated:** December 17, 2025
