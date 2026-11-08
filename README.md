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

## Automatic Firebase Hosting deployment

The repository includes GitHub Actions workflows for Firebase Hosting:

- Pull requests create a Firebase Hosting preview channel.
- Pushes to `main` deploy the `public` directory to the live Hosting channel.

The live deployment workflow requires a repository secret named
`FIREBASE_SERVICE_ACCOUNT_E5MUHELY`. Create or verify it in GitHub under
**Settings → Secrets and variables → Actions**. Its value must be the Firebase
service-account JSON generated for the `e5muhely` project.