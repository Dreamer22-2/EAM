# EAM

## Live MNB exchange rates

The browser can use a Cloudflare Worker as a small, cached proxy for the MNB
exchange-rate SOAP service. Firebase Hosting does not deploy this Worker.

1. Install Wrangler or run it through `npx`:

   ```sh
   npx wrangler login
   npx wrangler deploy
   ```

   Run these commands from the repository root. The Worker configuration is in
   [`wrangler.toml`](./wrangler.toml), and its source is
   [`workers/mnb-rates.js`](./workers/mnb-rates.js).

2. Copy the deployed Worker URL, for example
   `https://eam-mnb-rates.<account>.workers.dev/rates`, into
   [`public/runtime-config.js`](./public/runtime-config.js):

   ```js
   window.EAM_EXCHANGE_RATE_ENDPOINT =
     "https://eam-mnb-rates.<account>.workers.dev/rates";
   ```

3. Deploy the Firebase site:

   ```sh
   npx -y firebase-tools@latest deploy --only hosting
   ```

The Worker requests current EUR and USD rates from MNB and caches the response
for one hour. If the endpoint is left empty or temporarily unavailable, the
app displays that live data could not be fetched and does not calculate a
foreign-currency HUF equivalent from stale data.

## Client-side Excel import

The **Importálás** page reads `.xlsx`, `.xls`, and `.csv` files in the browser
using SheetJS. The selected file is not uploaded to a server. After scanning,
the user can select a worksheet, choose the header/first/last data rows, map
spreadsheet columns to inventory fields, review a preview, and then import the
confirmed rows into Firestore.

For safe imports, each row must have a unique `Leltári szám` ending in a
two- or three-digit counter, such as `SEE-00-CA31-00` or
`MEE-00-CA00-119`. A range can be written with brackets, such as
`MEE-00-CA00-[69-119]`; it is expanded into individual entries. Explicit
counter lists are also supported, for example `SEE-00-CA31-[02, 05, 09]`.
The code segments may contain Hungarian or other Unicode letters, such as
`MKÖ-00-DS00-01`.
Multiple serial numbers may be separated with
commas, semicolons, or spaces and are assigned to the expanded entries in
order when their count matches. If the counts do not match, all imported
serial-number fields remain empty. Existing entries with the same code are
replaced when the import is confirmed. Vertically merged spreadsheet cells are
also read: a merged inventory-code range is matched to the individual rows
inside that merged area.

## Firestore inventory storage migration

The inventory uses a versioned nested-map/array layout: `eszkozok` contains one
document by default and adds a shard only when needed to stay below a
conservative 700 KiB estimate; `leltariSzamlalok` stores all counters in one
document. The inventory screen reads the shard documents and the counter
document, rather than every legacy prefix document. Large inventory fields are
excluded from automatic indexing because the app filters and sorts them in the
browser.

The app requires the migration marker before it reads or writes inventory.
Schedule a short maintenance window so old clients cannot change the legacy
collections during migration. Authenticate the Firebase Admin SDK using
Application Default Credentials with access to the project, install the
maintenance dependency, then preview the migration:

```sh
npm install
npm run migrate:inventory -- --project=e5muhely
```

Review the record count, shard count, and largest estimated document size. The
script is dry-run by default. To copy the data and verify the new documents
without deleting the old collections:

```sh
npm run migrate:inventory -- --project=e5muhely --apply
```

Deploy the updated app and verify inventory, counters, imports, editing, and
deletion before removing the old documents. Legacy documents are preserved by
default. Only after verifying the migrated app, remove them explicitly:

```sh
npm run migrate:inventory -- --project=e5muhely --apply --delete-legacy
```

Do not run the cleanup option until the new inventory has been checked and a
backup is available. The migration utility refuses to overwrite an active
versioned inventory.

For an intentionally empty local Firestore emulator, initialize the migration
marker before using the app. With the emulator running, this writes an empty v2
inventory and counter document to the emulator only:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run migrate:inventory -- --project=e5muhely --apply
```

For an emulator containing legacy inventory, omit `--apply` first to preview
the migration, then apply it after checking the preview counts.

## Automatic Firebase Hosting deployment

The repository includes GitHub Actions workflows for Firebase Hosting:

- Pull requests create a Firebase Hosting preview channel.
- Pushes to `main` deploy the `public` directory to the live Hosting channel.

The live deployment workflow requires a repository secret named
`FIREBASE_SERVICE_ACCOUNT_E5MUHELY`. Create or verify it in GitHub under
**Settings → Secrets and variables → Actions**. Its value must be the Firebase
service-account JSON generated for the `e5muhely` project.