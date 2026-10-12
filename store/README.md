# Folio on Google Play

Everything the Play Console asks for, ready to upload, and how to rebuild it.

```
store/
├── google-play/                     ← upload these
│   ├── icon-512.png                 App icon, 512 × 512
│   ├── feature-graphic-1024x500.png Feature graphic, 1024 × 500
│   ├── phone/01…08.png              Phone screenshots, 1080 × 1920
│   ├── tablet-7/01…03.png           7-inch tablet screenshots, 1200 × 1920
│   ├── tablet-10/01…03.png          10-inch tablet screenshots, 1920 × 1200
│   └── listing/en-US/               Title, short and full description, release notes
├── scripts/create-upload-key.sh     Makes the release upload key (run it yourself)
├── build.sh                         Rebuilds every graphic from the real app
└── src/                             Sample books, capture script, frames, graphics
```

All images are opaque RGB PNGs at exactly the sizes Play asks for. The
screenshots show the real app (captured from the dev build, with a sample
library of public-domain classics), framed with a headline.

## 1. Before the first upload

**Upload key.** Run once, yourself (it asks for a password and prints nothing):

```bash
sh store/scripts/create-upload-key.sh
```

It creates `android/folio-upload.jks` and `android/keystore.properties`, both
kept out of git. Back them up with the password in a password manager. In the
Play Console, keep **Play App Signing** on (the default): Google holds the app
signing key, and a lost upload key can be reset by Play support.

**Build the bundle:**

```bash
yarn android:bundle
```

The signed bundle is `android/app/build/outputs/bundle/release/app-release.aab`.
For each later upload, raise `versionCode` in `android/app/build.gradle` by one
(and `versionName` as you like).

**The server** must be running the current build so these pages work:
`https://folio.armorclub.org/privacy` and
`https://folio.armorclub.org/delete-account` (see the deploy notes in the
project).

## 2. Play Console: create the app

| Field | Value |
| --- | --- |
| App name | Folio: Ebook & PDF Reader |
| Default language | English (United States) |
| App or game | App |
| Free or paid | Free |
| Package name | `io.github.ssoad.folio` (comes from the bundle) |

## 3. Store listing (Grow → Store presence → Main store listing)

| Field | Where |
| --- | --- |
| App name | `listing/en-US/title.txt` (25/30) |
| Short description | `listing/en-US/short-description.txt` (77/80) |
| Full description | `listing/en-US/full-description.txt` (2,084/4,000) |
| App icon | `icon-512.png` |
| Feature graphic | `feature-graphic-1024x500.png` |
| Phone screenshots | `phone/01…08.png`, in order |
| 7-inch tablet screenshots | `tablet-7/01…03.png` |
| 10-inch tablet screenshots | `tablet-10/01…03.png` |
| Video | none |

**Store settings:** category **Books & Reference**; tags such as *E-book
reader*, *PDF reader*, *Reading*. Contact email **mdsoad@gmail.com**, website
**https://folio.armorclub.org**.

## 4. App content (Policy → App content)

**Privacy policy:** `https://folio.armorclub.org/privacy`

**Ads:** No, the app contains no ads.

**App access:** *All or some functionality is restricted.* Reading needs no
account, but AI, voices, OCR and Folio Cloud need a Folio account. Create a
reviewer account in the admin panel (`/admin` → Users), give it the **Pro**
package with no end date, and enter:

- Name: Google Play review
- Email and password: the reviewer account's
- Instructions: *Open Settings (gear icon) → Server, and sign in. AI is under
  the sparkle icon in the reader; Folio Cloud is in Settings → Sync and backup →
  Add data source → Folio Cloud.*

**Content rating (IARC questionnaire):** category **Reference, News, or
Educational**. Answer **No** to violence, sexuality, language, controlled
substances, gambling and crude humour. Users can't interact with each other
or share content with other users, and the app doesn't share the user's
location. Expected rating: Everyone / PEGI 3.
*Note:* the AI helper generates text about passages the reader selects;
answer the generative-AI question **Yes** and describe it that way.

**Target audience:** 13 and over (the app isn't designed for children, and the
privacy policy says so). Not a teacher-approved app.

**News app:** No. **COVID-19 tracing:** No. **Data safety:** see below.
**Government app:** No. **Financial features:** None. **Health:** None.

**Account deletion** (asked in Data safety): users can delete their account in
the app (*Settings → Server → Delete account*) and on the web at
`https://folio.armorclub.org/delete-account`.

## 5. Data safety form

**Does your app collect or share any of the required user data types?** Yes.
**Is all of the user data collected by your app encrypted in transit?** Yes (HTTPS).
**Do you provide a way for users to request that their data is deleted?** Yes.
Deletion URL: `https://folio.armorclub.org/delete-account`.

Data **collected** (none of it is **shared**: the AI providers process text on
Folio's behalf, which Play doesn't count as sharing):

| Data type | Collected | Optional? | Purposes | Ephemeral? |
| --- | --- | --- | --- | --- |
| Personal info → Email address | Yes | Optional (only with an account) | App functionality, Account management | No |
| Personal info → Name | Yes | Optional | Account management | No |
| Files and docs | Yes | Optional (Folio Cloud only) | App functionality | No |
| App activity → Other user-generated content (notes, highlights, reading progress) | Yes | Optional (Folio Cloud only) | App functionality | No |
| App activity → Other actions (monthly counts of AI requests, voice characters, OCR pages) | Yes | Optional (with an account) | App functionality | No |
| Messages → Other in-app messages (text sent to the AI helper) | Yes | Optional | App functionality | **Yes**, processed and not stored |
| Photos and videos → Photos (page images for text recognition) | Yes | Optional | App functionality | **Yes** |

Not collected: location, contacts, financial info, health, web history, device
or advertising IDs, crash logs, diagnostics, audio, calendar.

## 6. Release

1. **Testing → Internal testing**: create a release, upload the `.aab`,
   paste `listing/en-US/release-notes.txt`, add testers, roll out. Install it
   from the Play link and check sign-in, reading and Folio Cloud.
2. New personal developer accounts must run a **closed test** with at least
   12 testers for 14 days before production access; create it under
   **Testing → Closed testing** the same way.
3. **Production**: promote the tested release, choose the countries, and send
   it for review.

## 7. Policy notes

- **Billing.** Play only allows its own billing for digital features bought in
  an app. The Android app therefore doesn't show plan prices, payment
  instructions or plan requests (`isNativeApp()` in
  `src/containers/settings/selfHostedSetting/component.tsx`); plans are given on
  the web or by the admin, and the app shows the current one. To sell plans
  inside the Android app, add Google Play Billing first.
- **Target API.** The app targets API 36 (`android/variables.gradle`), above
  Play's current minimum.
- **Permissions.** Only `INTERNET`. Books open through the system file
  picker and "Open with", so no storage permission is needed.
- **Sample books** in the screenshots are public-domain works (Austen, Melville,
  Carroll, Shelley, Doyle, Wells, Alcott, Stoker, Fitzgerald) with covers drawn
  for the screenshots.

## Rebuilding the graphics

With the dev server running (`yarn start`):

```bash
sh store/build.sh
```

It renders the sample book covers and EPUBs, drives the app in a headless
Chrome with a fresh profile (onboarding, importing the books, reading,
highlighting, themes, tablet layouts), and renders the framed screenshots,
feature graphic and icon into `store/google-play/`. Headlines and the shot
list are in `src/frames/shots.js`; the icon and feature graphic are
`src/graphics/*.html`.
