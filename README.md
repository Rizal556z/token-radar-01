# Launch Radar — token-radar-01

A token launch radar: it reads a sealed DefiLlama snapshot, ranks the pre-token
protocols by what their launch would be worth, and hands in a web dashboard with
the board, a detail view per protocol, and the steps to farm each one.

## The model (peer-multiple radar-2)

A launch is priced at the multiple the market already pays for the same kind of
business: the median market-cap over TVL of the live-token protocols in its
category (at least 3 of them, else the median over all live tokens), clamped to
[0.03, 1.50]. Then:

```
implied = round( tvl_usd × peer_multiple
               × (1 + 0.6 × clamp(change_7d, -50, 100) / 100)
               × maturity × (1 + 0.04 × min(chains − 1, 5)) )
```

Maturity is `0.70 + 0.30 × min(age_days, 730) / 730` (an unlisted age uses 0.85),
where age is the time since the protocol was first listed — the record of how
long it has run with no token. No protocol name is special-cased.

The board ranks all 40 watchlist protocols plus the pre-token protocols the watchlist
leaves out, by TVL (158 of them, 198 rows). Protocols whose token already trades are
never ranked; they are shown apart with the market cap the market reports, and they
set the peer multiples.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22.18+ (or newer), standard library only, no network. The program runs
twice in grading and both runs write identical bytes.

## Layout

- `main.ts` — entrypoint: reads the snapshot, writes `board.json`, `data.js`,
  copies `dashboard/` and `screenshots/`, writes `dossier.json`.
- `lib/radar.ts` — the model, the farm-plan generator, and the board checks.
- `vendor/makefun-board.ts` — make.fun's dossier library, as shipped in the kit.
- `dashboard/` — the static page (no network): `index.html`, `style.css`, `app.js`.
- `screenshots/` — the board, a protocol detail view, and a filtered view.
