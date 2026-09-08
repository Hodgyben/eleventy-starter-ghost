# Eleventy Starter Ghost

A starter template to build completely static websites with [Ghost](https://ghost.org) & [Eleventy](https://www.11ty.io)

**Demo:** https://eleventy.ghost.org

![screenshot](https://user-images.githubusercontent.com/1177460/61880744-5b138980-aeed-11e9-9d8e-07c0b3c03cc5.png)

# Installing

```bash
# From Source
git clone https://github.com/TryGhost/eleventy-starter-ghost.git
cd eleventy-starter-ghost
```

This project uses [pnpm](https://pnpm.io). If you don't have it, Node ships
Corepack, which will fetch the pinned version for you:

```bash
corepack enable
```

Then install dependencies

```bash
pnpm install
```

# Running

Start the development server

```bash
pnpm start
```

You now have a completely static site pulling content from Ghost running as a headless CMS.

By default, the starter will populate content from a default Ghost install located at https://eleventy.ghost.io.

To use your own install, edit the `.env` config file with your credentials. You can find your `contentApiKey` in the "Integrations" screen in Ghost Admin. The minimum required version for Ghost is `2.10.0` in order to use this starter without issues.

# Deploying with Netlify

The starter contains three config files specifically for deploying with Netlify. A `netlify.toml` file for build settings, a `headers.njk` file with default security headers set for all routes (builds to `/_headers` path), and `redirects.njk` to set Netlify custom domain redirects (builds to `/_redirects` path).

To deploy to your Netlify account, hit the button below.

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/TryGhost/eleventy-starter-ghost)

Content API Keys are generally not considered to be sensitive information, they exist so that they can be changed in the event of abuse; so most people commit it directly to their `.env` config file. If you prefer to keep this information out of your repository you can remove this config and set [Netlify ENV variables](https://www.netlify.com/docs/continuous-deployment/#build-environment-variables) for production builds instead.

Once deployed, you can set up a [Ghost + Netlify Integration](https://docs.ghost.org/integrations/netlify/) to use deploy hooks from Ghost to trigger Netlify rebuilds. That way, any time data changes in Ghost, your site will rebuild on Netlify.

# Optimising

You can disable the default Ghost Handlebars Theme front-end by enabling the `Make this site private` flag within your Ghost settings. This enables password protection in front of the Ghost install and sets `<meta name="robots" content="noindex" />` so your Eleventy front-end becomes the source of truth for SEO.

# Extra options

```bash
# Build the site locally
pnpm build
```

# Octopus Energy dashboard

The site includes an energy dashboard at `/energy/`, built from the
[Octopus Energy API](https://developer.octopus.energy/rest/guides/api-basics).
Consumption and tariff data are pulled **at build time**, so nothing is fetched
in the browser and your API key never reaches the client.

**Requires Node 18 or newer** — the API client uses the global `fetch`.

## Setup

1. Grab your API key from
   [octopus.energy → API access](https://octopus.energy/dashboard/new/accounts/personal-details/api-access).
   Treat it as a password — it can read your whole account.
2. Copy `.env.example` to `.env.local` (git-ignored) and fill in the key, your
   account number, and the meter identifiers.
3. Check the credentials work:

   ```bash
   pnpm octopus:refresh
   ```

   That forces a fresh pull into `.cache/octopus.json` and prints a summary.
4. Build or serve as normal — `pnpm dev` / `pnpm build`.

For a deployed build, set the same variables as build environment variables on
your host rather than committing them.

## What it shows

Half-hourly electricity and gas over the last 7, 30, or 90 days: a headline cost
figure, stat tiles with sparklines, daily use and cost, the **blended electricity
rate**, the average shape of a day split weekday/weekend, use by day of the week,
and a half-hour heatmap. Every chart has a table view behind a toggle.

Each reading is costed at the unit rate in force at that instant, so half-hourly
tariffs such as Agile are priced correctly rather than averaged; standing charges
are added per day.

**The blended rate** ("What a kWh actually cost") plots two lines on one p/kWh
axis: the unit rate paid, and the same rate once the daily standing charge is
spread across the kilowatt hours used. The shaded gap between them is the
standing charge, so it visibly widens on light-usage days — the same fixed charge
carried by fewer units. On a flat tariff the unit line is flat and only the
all-in line moves; on Agile or Go both move.

## Notes

- **Tariffs.** Set `OCTOPUS_ACCOUNT_NUMBER` and the dashboard reads your real
  tariff codes from the account. Without it, set
  `OCTOPUS_ELECTRICITY_TARIFF_CODE` / `OCTOPUS_GAS_TARIFF_CODE` explicitly, or
  costs fall back to the flat rates in `.env.example`.
- **Gas units.** SMETS2 meters report cubic metres, SMETS1 meters report kWh.
  The default assumes m³ and converts with
  `m³ × 1.02264 × 39.5 ÷ 3.6`. Set `OCTOPUS_GAS_UNITS=kwh` if your readings come
  through in kWh already. The conversion in use is shown on the page.
- **Graceful degradation.** The build never fails on the API: it falls back to
  the cache, then to clearly-labelled demo data, and explains which on the page.

# Copyright & License

Copyright (c) 2013-2022 Ghost Foundation - Released under the [MIT license](LICENSE).
