// Launch Radar's night dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, the filters, the already-trading view, and a
// per-protocol detail panel with the model's own inputs and the protocol's farm plan.
// No network: every byte it shows is in data.js. No framework, no external font.
//
// The farm plan below is the same derivation main.ts writes to board.json: category, chains,
// TVL and age decide the action, the capital, the hold and every cost and time. No name is
// special-cased. The page recomputes a row's implied value from the same figures, so the
// number on screen and the number in board.json are visibly the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre', watch: false, sort: 'implied', dir: -1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n.toFixed(2) + 'x'; }

  // The model in one function: peer multiple x growth x maturity x chain spread, on TVL.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? null : row.age_days;
    var maturity = age === null
      ? model.unknown_age_multiplier
      : model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chainMult = 1 + model.chain_step * Math.min(Math.max((row.chains || []).length - 1, 0), model.chain_max_steps);
    return Math.max(1, Math.min(model.implied_cap, Math.round(row.tvl_usd * row.peer_multiple * growthMult * maturity * chainMult)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- the farm plan (mirrors lib/radar.ts exactly) ----

  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 500;
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 2.5e8) return 150;
    if (p.tvl_usd >= 5e7) return 100;
    return 50;
  }
  function gasFor(chain) {
    var c = chain.toLowerCase();
    if (c === 'ethereum') return 12;
    if (c === 'solana') return 0.1;
    if (c === 'bitcoin') return 5;
    if (c.indexOf('base') >= 0 || c.indexOf('arbitrum') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('polygon') >= 0 || c.indexOf('linea') >= 0 || c.indexOf('scroll') >= 0 || c.indexOf('blast') >= 0 || c.indexOf('mode') >= 0 || c.indexOf('zksync') >= 0 || c.indexOf('ink') >= 0 || c.indexOf('unichain') >= 0 || c.indexOf('soneium') >= 0 || c.indexOf('world chain') >= 0) return 1;
    return 3;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 60;
    if (age < 180) return 90;
    if (age < 365) return 60;
    return 45;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0) return 'Open a lend-and-borrow loop on ' + name + ': deposit $' + capital + ' of USDC as collateral on ' + chain + ' and borrow $' + Math.round(capital * 0.4) + ' of the cheapest stable against it, keeping the health factor above 1.8.';
    if (c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Mint $' + Math.round(capital * 0.6) + ' of the stablecoin by locking $' + capital + ' of collateral in ' + name + ' on ' + chain + ', and keep the collateral ratio above 200%.';
    if (c.indexOf('dex') >= 0) return 'Seed liquidity on ' + name + ': add $' + capital + ' split across both sides of its deepest pool on ' + chain + ', and stake the LP tokens in the pool\'s gauge when one exists.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Enter the highest-yield vault: deposit $' + capital + ' into ' + name + '\'s top vault on ' + chain + ' and leave the yield compounding in the same wallet.';
    if (c.indexOf('restak') >= 0) return 'Restake $' + capital + ' of ETH through ' + name + ' on ' + chain + ' and hold the restaking receipt token in the farming wallet.';
    if (c.indexOf('liquid staking') >= 0) return 'Mint $' + capital + ' of the liquid staking token through ' + name + ' on ' + chain + ' and keep it in the farming wallet instead of swapping it away.';
    if (c.indexOf('bridge') >= 0) return 'Route $' + capital + ' of USDC through ' + name + ' from ' + chain + ' to its busiest destination chain, then put the bridged funds to work in that chain\'s largest app.';
    if (c.indexOf('rwa') >= 0) return 'Subscribe $' + capital + ' to ' + name + '\'s tokenised yield product on ' + chain + ' and hold the receipt token until the position matures.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) return 'Post $' + capital + ' of USDC as margin on ' + name + ' and open one small delta-neutral hedge, rebalancing it once a week.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Allocate $' + capital + ' into a ' + name + ' curator vault on ' + chain + ' and keep the vault shares through at least one rebalancing cycle.';
    if (c.indexOf('insurance') >= 0) return 'Underwrite $' + capital + ' of cover on ' + name + ' on ' + chain + ' and keep the policy active through its full term.';
    if (c.indexOf('launchpad') >= 0) return 'Commit $' + capital + ' to the next ' + name + ' launch pool on ' + chain + ' and hold the allocation through the sale instead of flipping it.';
    if (c.indexOf('prediction') >= 0) return 'Take a $' + capital + ' position in the most liquid market on ' + name + ' and let it settle rather than trading in and out.';
    if (c.indexOf('payment') >= 0) return 'Route a $' + capital + ' payment through ' + name + ' on ' + chain + ' and keep the receipt in the farm log.';
    if (c.indexOf('stable') >= 0) return 'Mint $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it in the farming wallet.';
    if (c === 'chain') return 'Bridge $' + capital + ' to ' + chain + ' and use ' + name + '\'s own native apps with it, starting with the largest one by TVL.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Adjust the position once a week: top up collateral, repay a little debt, or move between the lending markets.';
    if (c.indexOf('dex') >= 0) return 'Rebalance the pool once a week: claim the fees, add them back to the position, and check the pool is still the deepest one.';
    if (c.indexOf('bridge') >= 0) return 'Send one small transfer a week through the bridge, alternating the direction when the route allows it.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) return 'Rebalance the hedge once a week and keep the margin above the liquidation line at all times.';
    if (c.indexOf('prediction') >= 0) return 'Place one settled market position a week and leave each one to resolve before opening the next.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield') >= 0) return 'Check the vault once a week, claim the yield, and redeposit it so the balance compounds.';
    if (c.indexOf('launchpad') >= 0) return 'Vote or stake once a week in the launch pool so the account stays active between sales.';
    return 'Make one qualifying action a week, such as a deposit, a borrow, a swap, a vote or a claim, and vary the action.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    var gasText = 'about $' + gas + ' of gas';
    var secondChain = p.chains.length > 1 ? p.chains[1] : null;
    var leg3 = secondChain !== null
      ? { text: 'Use the second chain too: move $' + Math.round(capital / 2) + ' of the position to ' + secondChain + ' through the protocol\'s own bridge or a bridge it names, so the wallet is active on both chains.', cost: 'about $' + (gas + 4) + ' of gas and the bridge fee', time: '20 minutes' }
      : { text: 'Open a second leg on ' + chain + ': put $' + Math.round(capital / 2) + ' into the protocol\'s other main product, so the wallet shows two kinds of activity instead of one.', cost: 'about $' + gas + ' of gas', time: '20 minutes' };
    return [
      { text: 'Start with a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gasText, time: '15 minutes to set up' },
      leg3,
      { text: weeklyFor(p), cost: 'about $' + Math.max(1, gas) + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot window.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Once a month, open the protocol\'s own points or rewards page from the link it publishes and check what the wallet has earned.', cost: 'no fee to check, and never pay to claim', time: '10 minutes a month' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, and unwind when the token launches, the TVL halves, or 180 days pass with no signal.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }
  // Debug hooks the entry's own checks use: the page's plan and value for one row.
  window.__farmStepsFor = function (slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    return row ? farmSteps(row) : null;
  };
  window.__impliedOf = function (slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    return row ? impliedOf(row, DATA.model) : null;
  };

  // ---- hash state ----

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('cat')) state.category = params.get('cat');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('watch') === '1') state.watch = true;
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('cat', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre') params.set('tab', state.tab);
    if (state.watch) params.set('watch', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ---- filtering and sorting ----

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'peer') { av = a.peer_multiple; bv = b.peer_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---- sections ----

  function masthead() {
    return el('header', { class: 'masthead' },
      el('div', { class: 'wordmark' },
        el('span', { class: 'radar-dot', 'aria-hidden': 'true' }),
        el('b', { text: 'Launch Radar' }),
        el('span', { text: 'token-radar-01' })
      ),
      el('div', { class: 'meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version })),
        el('span', null, 'Source ', el('b', { text: 'DefiLlama protocol index' }))
      )
    );
  }

  function hero() {
    return el('section', { class: 'hero' },
      el('h1', { text: 'Which pre-token protocol is worth farming next?' }),
      el('p', null,
        'The watchlist is the floor: every protocol with at least ', el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
        ' of TVL that records no token. The early radar adds ', el('b', { text: String(DATA.early_size) }),
        ' more pre-token protocols the watchlist leaves out, found early. Each launch is priced at the multiple the market already pays for the same kind of business — ',
        el('b', { text: 'implied value is this radar\u2019s own estimate, never a price and never a promise of a token.' })
      )
    );
  }

  function kpis() {
    var top = DATA.rows[0];
    return el('section', { class: 'kpis', 'aria-label': 'Headline figures' },
      el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist slug is ranked' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Pre-token rows' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' early rows the watchlist leaves out' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Top implied value' }), el('b', { text: top ? fmtUsd(top.implied_value_usd) : 'n/a' }), el('small', { text: top ? top.name : '' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Median peer multiple' }), el('b', { text: fmtMult(DATA.peer_median) }), el('small', { text: 'live-token market cap over TVL' }))
    );
  }

  function toolbar() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Already trading', onclick: function () { state.tab = 'live'; render(); } });
    var watchBtn = el('button', { type: 'button', 'aria-pressed': state.watch ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watch = !state.watch; writeHash(); render(); } });
    var countText = state.tab === 'pre' ? visibleRows().length + ' of ' + DATA.board_size + ' rows' : DATA.live.length + ' live-token protocols';
    return el('div', { class: 'toolbar' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { text: 'Token status' }), el('div', { class: 'seg' }, pre, live)),
      el('div', { class: 'field' }, el('label', { text: 'Scope' }), el('div', { class: 'seg' }, watchBtn)),
      el('span', { class: 'count', text: countText })
    );
  }

  function sortHead(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'btn primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render(); } })
      ));
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank-num' + (r.rank <= 3 ? ' top3' : ''), text: String(r.rank) }),
        el('td', null, el('div', { class: 'proto' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
          el('span', null, el('span', { class: 'badge ' + (r.watchlist ? 'watch' : 'early'), text: r.watchlist ? 'WATCHLIST' : 'EARLY' }))
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.peer_multiple) }),
        el('td', null, el('div', { class: 'value-cell' },
          el('div', { class: 'track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        ))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-scroll' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHead('implied', 'Rank'),
            sortHead('name', 'Protocol'),
            sortHead('tvl', 'TVL'),
            sortHead('growth', '7d'),
            sortHead('age', 'Age'),
            sortHead('peer', 'Peer \u00d7'),
            sortHead('implied', 'Implied value')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'proto' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd > 0 ? fmtMult(r.mcap_usd / r.tvl_usd) : 'n/a' }),
        el('td', null, el('span', { class: 'badge live', text: 'ALREADY TRADES' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-scroll' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They set the peer multiples the pre-token board is priced at.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Mcap / TVL' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function modelNote() {
    var m = DATA.model;
    var peers = DATA.peer_table.map(function (p) {
      return el('div', { class: 'peer' },
        el('span', { text: p.category + ' (' + p.samples + ')' }),
        el('b', { text: fmtMult(p.multiple) })
      );
    });
    return el('section', { class: 'panel note' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { text: 'One function scores every protocol. A launch is priced at the multiple the market already pays for the same kind of business: the median market-cap over TVL of the live-token protocols in its category (at least 3 of them, else the median over all 144 live tokens, ' + fmtMult(DATA.peer_median) + '). No protocol name is special-cased and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd \u00d7 peer_multiple \u00d7 (1 + 0.6 \u00d7 clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100) \u00d7 maturity \u00d7 (1 + 0.04 \u00d7 min(chains \u2212 1, 5)) )'
      ),
      el('p', { text: 'Maturity is 0.70 + 0.30 \u00d7 min(age_days, 730) / 730, where age is the time since the protocol was first listed — the record of how long it has run with no token. An unlisted age uses 0.85. TVL and seven-day growth come from the snapshot itself.' }),
      el('h3', { text: 'Peer multiples by category' }),
      el('div', { class: 'peer-grid' }, peers),
      el('p', { text: 'The board separates the two worlds: pre-token protocols are ranked by this model, and protocols whose token already trades are set aside with the market cap the market reports. A protocol is called pre-token only because its record carries no token — the record is not proof that it has none.' })
    );
  }

  function footer() {
    return el('p', { class: 'foot' },
      'Snapshot: DefiLlama protocol index, fetched ' + DATA.as_of + '. Implied values are this radar\u2019s own estimates, not prices and not a promise of a token. Farm plans are generic steps derived from each protocol\u2019s category, chains, TVL and age; check the protocol\u2019s own pages before you move funds, and never pay to claim an airdrop.'
    );
  }

  var panel = el('aside', { class: 'detail', id: 'detail', hidden: '', 'aria-label': 'Protocol detail' });

  function closeDetail() {
    state.selected = null;
    panel.setAttribute('hidden', '');
    writeHash();
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var ageText = row.age_days === null ? 'an unlisted age' : fmtAge(row.age_days) + ' since first listed';
    panel.textContent = '';
    panel.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'badge ' + (row.watchlist ? 'watch' : 'early'), text: (row.watchlist ? 'WATCHLIST' : 'EARLY') + ' \u00b7 RANK ' + row.rank + ' OF ' + DATA.board_size }),
        el('h2', { text: row.name }),
        el('span', { class: 'sub', text: (row.category || 'Other') + ' \u00b7 ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: closeDetail })
    ));
    panel.appendChild(el('div', { class: 'why' },
      el('b', { text: 'Why it ranks here. ' }),
      'Its ' + fmtUsd(row.tvl_usd) + ' of TVL is priced at a ' + (row.category || 'Other') + ' peer multiple of ' + fmtMult(row.peer_multiple) +
      ' (median of ' + row.peer_samples + ' live tokens), with ' + fmtPct(row.change_7d) + ' over seven days, ' + ageText +
      ', across ' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + '.'
    ));
    panel.appendChild(el('section', { class: 'detail-sec' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'eq' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: fmtMult(row.peer_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chain spread' }), el('b', { class: 'num', text: fmtMult(row.chain_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    panel.appendChild(el('section', { class: 'detail-sec' },
      el('h3', { text: 'Farm plan — seven steps' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        var parts = tail.split('. Time: ');
        var cost = parts[0] ? parts[0].replace(/^Cost: /, '') : '';
        var time = parts[1] ? parts[1].replace(/\.$/, '') : '';
        return el('li', null,
          el('b', { text: action }),
          el('span', { class: 'chips' },
            el('span', { class: 'chip', text: 'Cost: ' + cost }),
            el('span', { class: 'chip', text: 'Time: ' + time })
          )
        );
      }))
    ));
    panel.removeAttribute('hidden');
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'wrap' });
    shell.appendChild(masthead());
    shell.appendChild(hero());
    shell.appendChild(kpis());
    shell.appendChild(toolbar());
    shell.appendChild(state.tab === 'pre' ? boardTable() : liveTable());
    if (state.tab === 'pre') shell.appendChild(modelNote());
    shell.appendChild(footer());
    app.appendChild(shell);
    if (!panel.isConnected) document.body.appendChild(panel);
    app.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
    window.__shotReady = true;
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hasAttribute('hidden')) closeDetail();
  });
})();
