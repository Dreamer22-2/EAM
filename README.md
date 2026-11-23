# EAM inventory

EAM is a browser-based inventory app for Eötvös Alkotó Műhely. It uses Firebase
Authentication and Cloud Firestore, is hosted on Firebase Hosting, and uses a
Cloudflare Worker for compact inventory reads and live exchange rates.

## What the app does

- **New entry:** add one or more items with inventory codes, owner, type,
  subtype, price, serial numbers, storage notes, sticker size, and sticker
  count.
- **Inventory:** search, filter, sort, and view grouped inventory. Open a group
  to see individual items. Edit groups or delete groups and individual items.
  Add child serial numbers inline; each can have a serial number and an
  optional label.
- **Bulk actions:** select individual records or groups, select the entire
  inventory, delete selected items, or change sticker settings.
- **Import:** read `.xlsx`, `.xls`, and `.csv` files in the browser, map
  columns, preview the result, and import the confirmed records.
- **Matricainátor:** export HERMA Label Assistant Online article 4461 data.
  The Excel file has one header row (`Name`, `IC`, `SN`) and one data row per
  sticker. An item's row is repeated according to its sticker count. Items
  whose sticker size is **Nincs** are excluded. Select a sticker size to export;
  after a successful download, those items are tagged `sticker done` and skipped
  by later exports.
- **Sticker logs:** review each export-tagging or restore operation, inspect the
  affected items, and reverse an operation. Reversals are logged as well.
- **Parameters:** edit the owner, type, manufacturer, model, and subtype rules
  used by entry forms.

## How data is stored

The app uses the existing Firestore v2 inventory layout; no per-item summary or
detail collections are required:

- `eszkozok/__v2_inventory_*` stores inventory records grouped by inventory
  code prefix. Shards are kept below a conservative 700 KiB size estimate.
- `leltariSzamlalok/__v2_counters` stores inventory counters and the v2
  migration marker.
- `beallitasok/parameterek` stores editable catalogs and subtype rules.
- `users/{uid}` stores the signed-in user's profile and `hasAccess` setting.
- `logs/sticker done` stores the sticker-tag operation history in one
  `operations` map. Each entry records the affected item IDs, codes, and tag
  values before and after the operation. Because all history is kept in one
  document as requested, Firestore's 1 MiB per-document size limit applies as the
  log grows.

The inventory list and group-detail requests go through the Cloudflare Worker.
The list response contains fields needed to show and operate on the table.
Opening or editing a group requests that group's full item records separately.
Writes still go from the browser to Firestore using the Firebase client SDK.
The Firestore schema and existing v2 migration remain unchanged.

## Requirements

- Node.js and npm for tests and the Firestore migration utility.
- A Firebase project configured for Google sign-in, Firestore, and Firebase
  Hosting.
- The Firebase Emulator Suite for local Auth, Firestore, and Hosting testing.
- Wrangler and a Cloudflare account to deploy the Worker.

The app is configured for Firebase project `e5muhely` in
[`public/app.js`](./public/app.js), [`firebase.json`](./firebase.json), and
[`wrangler.toml`](./wrangler.toml). The Firebase CLI project alias is in
[`.firebaserc`](./.firebaserc).

## Run locally with Firebase emulators

Install the repository dependencies:

```sh
npm install
```

Start the Auth, Firestore, and Hosting emulators from the repository root:

```sh
npx -y firebase-tools@latest emulators:start --only auth,firestore,hosting --project e5muhely
```

Open `http://127.0.0.1:5000`. The app connects to the local Auth emulator at
port `9099` and Firestore emulator at port `8080`. Emulator data is separate
from production and may start empty. The app initializes the v2 inventory
counter automatically when both inventory collections are empty; otherwise
initialize emulator inventory using the migration instructions below.

The app uses the configured Worker for rates; local inventory reads use the
Firestore emulator directly. Google sign-in in the emulator is for local
testing only and does not change production accounts.

Run the test suite with:

```sh
npm test
```

## Sign-in and granting access

Users sign in with Google. On first sign-in, the app creates a Firestore user
profile with `hasAccess: false`. Existing access settings are preserved on
later sign-ins. Firestore rules allow inventory access only when the user's
profile has `hasAccess: true`.

To grant access to the first administrator:

1. Sign in once so the app creates the profile.
2. In Firebase Console, open **Authentication → Users** and copy that account's
   UID.
3. In **Firestore Database**, open `users` and set
   `users/{uid}.hasAccess` to the boolean `true`.
4. Reload the app.

Grant access to additional users by setting their profile's `hasAccess` field
to `true` in the same way. This manual process avoids a Cloud Functions
deployment and its billing requirements.

## Importing inventory

The import page processes the selected spreadsheet locally in the browser;
the file is not uploaded. Choose a worksheet and its header and data rows, map
columns to inventory fields, review the preview, and confirm the import.

Inventory codes must end in a two- or three-digit counter, for example
`SEE-00-CA31-00` or `MEE-00-CA00-119`. Supported forms include:

- A range: `MEE-00-CA00-[69-119]`
- An explicit list: `SEE-00-CA31-[02, 05, 09]`
- Unicode code segments, such as `MKÖ-00-DS00-01`

Multiple serial numbers may be separated by commas, semicolons, or spaces.
They are assigned in order when their count matches the expanded records;
otherwise imported serial-number fields are left empty. Merged spreadsheet
inventory-code cells are supported. Importing an existing inventory code
replaces that record after confirmation.

To add child serial numbers, open an inventory group and click the plus button
in the item's row. An indented row appears directly below it; enter the child
serial number and an optional descriptive name, then save. The name is for
display only. Use the edit button in a parent or child row to change its serial
number inline; child names can be edited there as well.

## Stickers and HERMA export

Each individual item has a **Matrica méret** and a **Matricák száma**. The
count is how many physical labels to create for that item—for example, set it
to `3` for a box that needs labels on three sides.

The Matricainátor export:

- creates one header row: `Name`, `IC`, `SN`;
- repeats each item's data row once per sticker count;
- excludes items with sticker size **Nincs**;
- exports only the size selected on the Matricainátor page;
- skips items already tagged `sticker done`;
- adds that tag to the items represented in the exported file, then records the
  operation in `logs/sticker done`;
- uses one row per physical label, even when several labels belong to one item.

Items created before sticker count was stored default to one sticker during
export. A count of zero creates no data rows. The `.xlsx` file is generated in
the browser and is not uploaded.

When using bulk actions, choose a sticker size to update the selected items.
Leave the sticker-count field blank to preserve each item's count, or enter an
integer from `0` to `10` to set the count for all selected items.

Open **Címkézési napló** to inspect export and restore operations. Selecting an
entry shows the affected item codes and tag changes. **Címkék eltávolítása**
reverses an export-tagging operation; reversing that restore adds the tags back.
Each reversal is appended to the same `logs/sticker done` document, so it too
can be reversed. If an affected item has been deleted, or its tags changed after
the logged operation, the app leaves the data unchanged and reports that the
operation cannot be restored safely.

## Firestore inventory migration

The migration utility converts legacy prefix documents and counters into the
v2 sharded layout. It is a dry run unless `--apply` is supplied. Legacy records
are preserved unless the explicit `--delete-legacy` option is used.

Before migrating production:

1. Back up the Firestore database.
2. Plan a short maintenance window and prevent older clients from writing
   inventory during migration.
3. Authenticate the Firebase Admin SDK using Application Default Credentials
   with permission to access the project.
4. Install dependencies and preview the migration:

   ```sh
   npm install
   npm run migrate:inventory -- --project=e5muhely
   ```

Review the reported legacy record/document counts, shard count, and largest
estimated shard. Apply only after confirming the preview:

```sh
npm run migrate:inventory -- --project=e5muhely --apply
```

Deploy the app and check listing, counters, imports, editing, and deletion.
Keep the legacy records until the new inventory is verified and a backup is
available. To remove legacy documents after verification, run:

```sh
npm run migrate:inventory -- --project=e5muhely --apply --delete-legacy
```

Do not use `--delete-legacy` before checking the active v2 inventory. The
utility refuses to overwrite an active v2 layout.

For emulator migration, set `FIRESTORE_EMULATOR_HOST` and preview first:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run migrate:inventory -- --project=e5muhely
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run migrate:inventory -- --project=e5muhely --apply
```

If the database has no inventory or counter documents, the app creates an
empty v2 counter automatically. If inventory documents exist without the v2
marker, the app reports that migration is required instead of treating the
database as empty.

## Cloudflare Worker

The Worker in [`workers/mnb-rates.js`](./workers/mnb-rates.js) serves two
features:

- `GET /rates` requests the current EUR and USD exchange rates from the
  Hungarian National Bank (MNB) and caches the result for one hour.
- `GET /inventory/list` returns compact, server-grouped inventory data.
- `POST /inventory/details` accepts a JSON body such as
  `{"code":"E-RO-UL-SP-01"}` and returns that item's group details.

Inventory requests require the signed-in user's Firebase ID token in the
`Authorization: Bearer <token>` header. The Worker forwards the token to
Firestore's REST API, so Firestore security rules still control access. No
service-account credential is stored in Cloudflare.

The project ID is configured as `FIREBASE_PROJECT_ID` in
[`wrangler.toml`](./wrangler.toml). The live endpoint URLs are in
[`public/runtime-config.js`](./public/runtime-config.js). If deploying to a
different Cloudflare account, update those URLs to match the deployed Worker.

Deploy the Worker from the repository root:

```sh
npx wrangler login
npx wrangler deploy
```

Firebase Hosting does not deploy the Worker. Deploy the site separately after
changing browser code or runtime configuration.

## Deploy Firebase Hosting

For a manual deployment, authenticate with the Firebase CLI and run:

```sh
npx -y firebase-tools@latest login
npx -y firebase-tools@latest deploy --only hosting --project e5muhely
```

GitHub Actions also deploys Hosting:

- Pull requests create a preview channel.
- Pushes to `main` deploy the live site.

Both workflows require the GitHub Actions secret
`FIREBASE_SERVICE_ACCOUNT_E5MUHELY`, containing a Firebase service-account JSON
with permission to deploy Hosting. The live workflow deploys Hosting only; the
Cloudflare Worker is deployed separately with Wrangler.

## Project files

| Path | Purpose |
| --- | --- |
| `public/index.html`, `public/styles.css` | App pages and styling |
| `public/app.js` | Firebase setup, UI, inventory workflows, and navigation |
| `public/inventory-storage.js` | v2 sharding and transactional inventory mutations |
| `public/sticker-export.js` | HERMA row generation by sticker count |
| `public/subtype-editor.js` | Split-subtype selection helper |
| `public/runtime-config.js` | Worker endpoint URLs used by the browser |
| `workers/mnb-rates.js` | Inventory API and MNB exchange-rate Worker |
| `scripts/migrate-firestore-inventory.mjs` | Legacy-to-v2 Firestore migration |
| `firestore.rules`, `firestore.indexes.json` | Firestore access rules and index settings |
| `tests/` | Node.js test suite |
| `.github/workflows/` | Firebase Hosting preview and live deployment |
