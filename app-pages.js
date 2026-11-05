/* Disc Golf Tracker - pages: home, round, player, courses, course, leaderboard. */
(function () {
  'use strict';
  const DG = window.DG;
  const esc = DG.esc;
  const UI = (DG.ui = DG.ui || {});

  /* ============================================================ shared bits */
  UI.chips = function (items, current, action, label) {
    return `<div class="chips" role="group" aria-label="${esc(label || 'Filter')}">${items
      .map((it) => `<button type="button" class="chip ${String(it.value) === String(current) ? 'is-on' : ''}"
        aria-pressed="${String(it.value) === String(current)}" data-action="${action}" data-value="${esc(it.value)}">${esc(it.label)}</button>`)
      .join('')}</div>`;
  };

  UI.stats = (items) => `<dl class="stat-row">${items
    .map((s) => `<div class="stat"><dt>${esc(s.label)}</dt><dd>${s.html !== undefined ? s.html : esc(s.value)}</dd></div>`)
    .join('')}</dl>`;

  UI.playerLink = (ix, id) => `<a href="#/player/${esc(id)}">${esc(DG.playerName(ix, id))}</a>`;

  /** "A 285 ft, B 330 ft par 4" under a tee's par on the course page. */
  UI.basketDetail = function (hole, tee) {
    const parts = (hole.baskets || []).map((b) => {
      const ft = DG.feetFor(hole, tee, b);
      const par = DG.parFor(hole, tee, b);
      const own = par !== hole.pars[tee];
      if (!ft && !own) return '';
      return `${b} ${ft ? ft + ' ft' : ''}${own ? `${ft ? ', ' : ''}par ${par}` : ''}`.trim();
    }).filter(Boolean);
    return parts.length ? `<span class="hole-dist">${parts.map(esc).join('<br>')}</span>` : '';
  };

  UI.layoutNote = function (round) {
    if (!round.layout_recorded) return 'Tee and basket not recorded';
    const tees = Array.from(new Set(round.holes.map((h) => h.tee)));
    return tees.length === 1 ? `${tees[0]} tees` : 'Mixed tees';
  };

  /** A round in the feed. */
  UI.feedItem = function (ix, round, focusPlayer) {
    const cards = ix.cardsByRound.get(round.id) || [];
    const thisYear = new Date().getFullYear();
    const yr = DG.yearOf(round.played_on);
    const solo = cards.length === 1 || focusPlayer;
    const main = focusPlayer ? cards.find((c) => c.playerId === focusPlayer) : cards[0];
    const est = DG.sum(cards.map((c) => c.estimated));
    const lay = UI.layoutNote(round);
    const sub = [
      DG.plural(round.holes.length, 'hole'),
      round.layout_recorded ? lay : lay.charAt(0).toLowerCase() + lay.slice(1),
      est ? DG.plural(est, 'hole') + ' not played' : '',
    ].filter(Boolean).join(', ');
    const players = cards.length > 1
      ? `<span class="feed-players">${cards.map((c) => `<span class="fp ${focusPlayer && c.playerId === focusPlayer ? 'is-me' : ''}">
          <span class="fp-name">${esc(DG.playerName(ix, c.playerId))}</span>
          <span class="fp-score">${DG.fmtToPar(c.toPar)}</span></span>`).join('')}</span>`
      : `<span class="feed-who">${esc(DG.playerName(ix, cards[0] ? cards[0].playerId : null))}</span>`;
    return `<li class="feed-item"><a class="feed-link" href="#/round/${esc(round.id)}">
      <span class="feed-date" aria-hidden="true"><span class="feed-mon">${esc(DG.fmtMonth(round.played_on))}</span>
        <span class="feed-day">${DG.dayOf(round.played_on)}</span>${yr !== thisYear ? `<span class="feed-yr">${yr}</span>` : ''}</span>
      <span class="feed-body">
        <span class="feed-course">${esc(DG.courseName(ix, round.course_id))}</span>
        <span class="visually-hidden">${esc(DG.fmtDateLong(round.played_on))}</span>
        ${focusPlayer && cards.length > 1 ? '' : players}
        <span class="feed-sub">${esc(sub)}</span>
        ${focusPlayer && cards.length > 1 ? players : ''}
      </span>
      ${solo && main ? `<span class="feed-score"><span class="feed-topar">${DG.fmtToPar(main.toPar)}</span>
        <span class="feed-strokes">${main.strokes}</span>${main.ratingInfo && main.ratingInfo.rating !== null
          ? `<span class="feed-rating">Rated ${main.ratingInfo.rating}</span>` : ''}</span>` : ''}
    </a></li>`;
  };

  UI.feed = (ix, rounds, focus) =>
    rounds.length ? `<ol class="feed">${rounds.map((r) => UI.feedItem(ix, r, focus)).join('')}</ol>` : '';

  UI.yearChips = function (ix, year, action) {
    const ys = DG.years(ix);
    if (ys.length < 2) return '';
    return UI.chips([{ value: 'all', label: 'All time' }].concat(ys.map((y) => ({ value: y, label: String(y) }))), year, action, 'Year');
  };
  const inYear = (year) => (c) => year === 'all' || DG.yearOf(c.date) === Number(year);

  /** Profile rating: the number, a chart of round ratings, and which rounds count. */
  UI.ratingBlock = function (ix, p, pr, unratedCourses, ratedOldestFirst) {
    const unratedNote = unratedCourses.length
      ? `<p class="chart-note">Rounds at ${esc(unratedCourses.map((id) => DG.courseName(ix, id)).join(', '))} aren't rated yet, because
          ${unratedCourses.length === 1 ? 'that course doesn\'t' : 'those courses don\'t'} have a 1000-rated score set.${DG.isAdmin()
          ? ' You can add one on the course\'s Admin page.' : ''}</p>` : '';
    if (!pr) {
      return `<section class="rating-block"><h2>Rating</h2>
        <p class="muted">No rated rounds yet. A round gets a rating when its course has a 1000-rated score set for the tees played,
        and every hole was played.</p>${unratedNote}</section>`;
    }
    const counted = pr.rows.map((r) => ({ c: r.card, label: r.doubled ? 'Counts double (recent)' : r.card.holesCount !== 18 ? `Counts ${Math.round((r.card.holesCount / 18) * 100) / 100}x (${r.card.holesCount} holes)` : 'Counts' }))
      .concat(pr.excluded.map((c) => ({ c, label: 'Left out (unusually low)' })))
      .sort((a, b) => DG.compareRoundsDesc(a.c.round, b.c.round));
    return `<section class="rating-block">
      <div class="rating-head">
        <div><h2>Rating</h2><p class="rating-big">${pr.rating}</p></div>
        <p class="rating-sub">From ${DG.plural(pr.rows.length, 'rated round')} in the ${pr.windowMonths} months up to
          ${esc(DG.fmtDate(pr.latest))}, worked out the way the PDGA does it.</p>
      </div>
      ${ratedOldestFirst.length >= 2 ? '<div class="chart" id="rating-chart"></div><p class="chart-note">Each dot is one round\'s rating. Higher is better.</p>' : ''}
      ${unratedNote}
      <details class="rating-detail"><summary>How it's worked out, and which rounds count</summary>
        <ul class="rules">
          <li>Each round is compared with the score a 1000-rated player would shoot from the same tees. Each stroke is worth about 10 points on a typical course, more on short courses and fewer on long ones, following the PDGA's published examples.</li>
          <li>Your rating averages your rated rounds from the 12 months before your latest one. With fewer than 8, it looks back 24 months.</li>
          <li>Once you have 9 or more rounds counting, the newest quarter count double.</li>
          <li>With 7 or more rounds, any round more than 100 points (or 2.5 standard deviations) below your average is left out.</li>
          <li>Shorter rounds count less: 9 holes counts half. Rounds with a hole marked "not played" aren't rated.</li>
        </ul>
        <div class="table-scroll"><table class="data">
          <thead><tr><th scope="col">Date</th><th scope="col">Course</th><th scope="col" class="num">Strokes</th><th scope="col" class="num">Rating</th><th scope="col">In the average</th></tr></thead>
          <tbody>${counted.map((x) => `<tr><td><a href="#/round/${esc(x.c.roundId)}">${esc(DG.fmtDate(x.c.date))}</a></td>
            <td>${esc(DG.courseName(ix, x.c.courseId))}</td><td class="num">${x.c.strokes}</td>
            <td class="num">${x.c.ratingInfo.rating}</td><td>${esc(x.label)}</td></tr>`).join('')}</tbody>
        </table></div>
      </details>
    </section>`;
  };

  /* ============================================================ home */
  DG.pages.home = function (main) {
    const ix = DG.state.ix, me = DG.state.me;
    let view = DG.store.get('dg.homeView.' + me.id, 'all');
    let shown = 20;
    // Live rounds: start with what loaded, then check every 20 seconds while this page is open.
    let live = ix.liveRounds.map((r) => ({ round: r, rows: ix.liveRows.get(r.id) || [] }));
    let liveSig = JSON.stringify(live);
    async function refreshLive() {
      if (document.hidden) return;
      try {
        const rounds = await DG.api.selectWhere('rounds', 'status', 'live');
        const next = [];
        for (const r of rounds.sort(DG.compareRoundsDesc)) {
          next.push({ round: r, rows: await DG.api.selectWhere('round_players', 'round_id', r.id) });
        }
        const sig = JSON.stringify(next);
        if (sig !== liveSig && DG.state.route === 'home') { live = next; liveSig = sig; draw(); }
      } catch (e) { /* try again next time */ }
    }
    const liveTimer = setInterval(refreshLive, 20000);
    DG.onLeave(() => clearInterval(liveTimer));
    setTimeout(refreshLive, 0);

    const fresh = () => live.filter(({ round }) => !DG.isStaleLive(round));
    // Abandoned cards are only shown to the people on them, whoever started them, and the admin.
    const unfinished = () => live.filter(({ round, rows }) => DG.isStaleLive(round) &&
      (round.created_by === me.id || DG.isAdmin() || rows.some((rp) => rp.player_id === me.id)));

    function liveSection() {
      const list = fresh();
      if (!list.length) return '';
      return `<section class="section live-now"><h2>Live now</h2><ul class="live-list">${list.map(({ round, rows }) => {
        const mine = rows.some((rp) => rp.player_id === me.id);
        const prog = DG.liveProgress(round, rows);
        const names = rows.map((rp) => DG.playerName(ix, rp.player_id)).sort((a, b) => a.localeCompare(b));
        return `<li><a class="live-link" href="#/live/${esc(round.id)}">
          <span class="live-dot" aria-hidden="true"></span>
          <span class="live-body"><span class="live-course">${esc(DG.courseName(ix, round.course_id))}</span>
            <span class="live-meta">${esc(names.join(', '))}. ${prog.furthest ? `Through hole ${prog.furthest} of ${prog.holes}` : 'Just teed off'}.</span></span>
          <span class="live-cta">${mine ? 'Open card' : 'Watch'}</span></a></li>`;
      }).join('')}</ul></section>`;
    }

    function unfinishedSection() {
      const list = unfinished();
      if (!list.length) return '';
      return `<section class="section unfinished"><h2>Unfinished rounds</h2>
        <p class="muted">Nobody has scored on ${list.length === 1 ? 'this card' : 'these cards'} for over a day. Open one to finish it so it counts, or throw it away.</p>
        <ul class="live-list">${list.map(({ round, rows }) => {
          const prog = DG.liveProgress(round, rows);
          const names = rows.map((rp) => DG.playerName(ix, rp.player_id)).sort((a, b) => a.localeCompare(b));
          return `<li><a class="live-link is-stale" href="#/live/${esc(round.id)}">
            <span class="live-body"><span class="live-course">${esc(DG.courseName(ix, round.course_id))}, ${esc(DG.fmtDate(round.played_on))}</span>
              <span class="live-meta">${esc(names.join(', '))}. ${prog.furthest ? `Stopped after hole ${prog.furthest} of ${prog.holes}` : 'No scores yet'}.</span></span>
            <span class="live-cta">Open card</span></a></li>`;
        }).join('')}</ul></section>`;
    }

    function draw() {
      const draft = DG.play && DG.play.getDraft();
      const myLive = fresh().find(({ rows }) => rows.some((rp) => rp.player_id === me.id));
      const mine = (ix.cardsByPlayer.get(me.id) || []).map((c) => c.round);
      let feedHtml;
      if (view === 'mine') {
        const list = mine.slice(0, shown);
        const groups = [];
        list.forEach((r) => {
          const key = r.played_on.slice(0, 7);
          if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, rounds: [] });
          groups[groups.length - 1].rounds.push(r);
        });
        const fmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
        feedHtml = list.length
          ? groups.map((g) => `<h3 class="feed-month">${esc(fmt.format(DG.parseDate(g.key + '-01')))}</h3>${UI.feed(ix, g.rounds, me.id)}`).join('') +
            (mine.length > shown ? `<button class="btn btn-wide" data-action="more">Show more rounds</button>` : '')
          : `<div class="empty-inline"><p>You haven't logged a round yet.</p><a class="btn btn-primary" href="#/play">Start your first round</a></div>`;
      } else {
        const latest = ix.roundsSorted.slice(0, 10);
        feedHtml = latest.length
          ? UI.feed(ix, latest)
          : `<div class="empty-inline"><p>No rounds yet. The first one is yours.</p></div>`;
      }
      const myCards = ix.cardsByPlayer.get(me.id) || [];
      const s = DG.summarize(myCards);
      main.innerHTML = `
        <section class="home-hero">
          <div class="home-hello">
            <h1>${DG.api.kind === 'demo' && me.display_name === 'You' ? 'Welcome back' : 'Hi, ' + esc(me.display_name)}</h1>
            <p class="lede">${s.rounds ? `${DG.plural(s.rounds, 'round')} logged. Last one ${esc(DG.fmtDate(s.last.date))} at ${esc(DG.courseName(ix, s.last.courseId))}.` : 'Ready when you are.'}</p>
          </div>
          ${myLive ? `<a class="resume" href="#/live/${esc(myLive.round.id)}"><span class="resume-title">Your round at ${esc(DG.courseName(ix, myLive.round.course_id))} is live</span>
              <span class="resume-sub">Open the card to keep scoring.</span></a>`
            : draft ? `<a class="resume" href="#/play"><span class="resume-title">Finish your round at ${esc(DG.courseName(ix, draft.courseId))}</span>
              <span class="resume-sub">Saved on this phone only. Hole ${draft.current + 1} of ${draft.holes.length}.</span></a>`
            : `<a class="btn btn-primary btn-big" href="#/play">Start a round</a>`}
        </section>
        ${liveSection()}
        ${unfinishedSection()}
        <section class="section">
          <div class="section-head">
            <h2>${view === 'mine' ? 'Your rounds' : 'Latest rounds'}</h2>
            ${UI.chips([{ value: 'all', label: 'Everyone' }, { value: 'mine', label: 'Just mine' }], view, 'view', 'Show rounds from')}
          </div>
          ${feedHtml}
        </section>`;
    }
    DG.setActions({
      view: (el) => { view = el.dataset.value; DG.store.set('dg.homeView.' + me.id, view); shown = 20; draw(); },
      more: () => { shown += 20; draw(); },
    });
    draw();
  };

  /* ============================================================ round */
  DG.pages.round = function (main, params) {
    const ix = DG.state.ix, me = DG.state.me;
    const round = ix.rounds.get(params.id);
    if (!round) {
      // A round still being played lives on its live card.
      if (ix.liveRounds.some((r) => r.id === params.id) || /^[0-9a-f-]{36}$|^r-/.test(params.id)) return location.replace('#/live/' + params.id);
      return DG.pages.notFound(main);
    }
    const course = ix.courses.get(round.course_id);
    const cards = ix.cardsByRound.get(round.id) || [];
    let showDiscs = DG.store.get('dg.showDiscs', false);
    const canEdit = round.created_by === me.id || DG.isAdmin();
    const onCard = cards.some((c) => c.playerId === me.id);
    const hasDiscs = cards.some((c) => (c.rp.discs || []).some(Boolean));
    const hasFeet = cards.some((c) => (c.rp.distances || []).some(Boolean));
    const anyEst = cards.some((c) => c.estimated);

    function cell(c, i) {
      const s = c.rp.strokes[i];
      const e = c.rp.estimated && c.rp.estimated[i];
      const key = e ? 'est' : c.results[i];
      const discId = c.rp.discs && c.rp.discs[i];
      const feet = c.rp.distances && c.rp.distances[i];
      const extra = showDiscs ? [discId ? (ix.bag.get(discId) || { name: 'Removed disc' }).name : '', feet ? feet + ' ft' : '']
        .filter(Boolean).join(', ') : '';
      const label = e ? `${s}, not played, filled in from average` : `${s}, ${DG.resultLabel(key)}`;
      return `<td class="sc res res-${key}" aria-label="${esc(label)}"><span class="sc-n">${e ? '~' : ''}${s}</span>${
        extra ? `<span class="sc-disc">${esc(extra)}</span>` : ''}</td>`;
    }
    function subtotal(label, from, to) {
      const par = DG.sum(round.holes.slice(from, to).map((h) => h.par));
      return `<tr class="sc-sub"><th scope="row">${label}</th><td class="num">${par}</td>${round.layout_recorded ? '<td></td>' : ''}${cards
        .map((c) => `<td class="num">${DG.sum(c.rp.strokes.slice(from, to))}</td>`).join('')}</tr>`;
    }
    function draw() {
      const rows = [];
      round.holes.forEach((h, i) => {
        rows.push(`<tr><th scope="row">${h.number}</th><td class="num">${h.par}</td>${round.layout_recorded
          ? `<td class="sc-lay">${esc(h.tee || '')}${h.basket ? `<span class="basket-tag">${esc(h.basket)}</span>` : ''}</td>` : ''}${cards.map((c) => cell(c, i)).join('')}</tr>`);
        if (round.holes.length === 18 && i === 8) rows.push(subtotal('Out', 0, 9));
      });
      if (round.holes.length === 18) rows.push(subtotal('In', 9, 18));
      const parTotal = DG.sum(round.holes.map((h) => h.par));
      main.innerHTML = `
        <header class="page-head">
          <p class="crumb"><a href="#/course/${esc(round.course_id)}">${esc(course ? course.name : 'Course')}</a></p>
          <h1>${esc(DG.fmtDateLong(round.played_on))}</h1>
          <p class="muted">${esc(UI.layoutNote(round))}. Par ${parTotal}.${round.created_by && cards.length > 1 ? ` Scored by ${esc(DG.playerName(ix, round.created_by))}.` : ''}</p>
        </header>
        <ol class="podium">${cards.map((c, i) => `<li>
          <span class="podium-rank" aria-label="Place">${cards.length > 1 ? i + 1 : ''}</span>
          <span class="podium-name">${UI.playerLink(ix, c.playerId)}</span>
          <span class="podium-topar">${DG.fmtToPar(c.toPar)}</span>
          <span class="podium-strokes">${c.strokes} strokes${c.estimated ? `, ${DG.plural(c.estimated, 'hole')} not played, not rated` : ''}${
            c.ratingInfo.rating !== null ? `, rated <strong>${c.ratingInfo.rating}</strong>` : ''}</span>
        </li>`).join('')}</ol>
        ${round.notes ? `<p class="round-notes">${esc(round.notes)}</p>` : ''}
        <section class="section">
          <div class="section-head"><h2>Scorecard</h2>
            ${hasDiscs || hasFeet ? `<label class="toggle"><input type="checkbox" data-change="discs" ${showDiscs ? 'checked' : ''}> Show ${
              hasDiscs && hasFeet ? 'tee discs and distances' : hasDiscs ? 'tee discs' : 'throw distances'}</label>` : ''}
          </div>
          <div class="table-scroll"><table class="scorecard">
            <thead><tr><th scope="col">Hole</th><th scope="col">Par</th>${round.layout_recorded ? '<th scope="col">Tee</th>' : ''}${cards
              .map((c) => `<th scope="col">${esc(DG.playerName(ix, c.playerId))}</th>`).join('')}</tr></thead>
            <tbody>${rows.join('')}</tbody>
            <tfoot><tr><th scope="row">Total</th><td class="num">${parTotal}</td>${round.layout_recorded ? '<td></td>' : ''}${cards
              .map((c) => `<td class="num"><strong>${c.strokes}</strong><span class="sc-topar">${DG.fmtToPar(c.toPar)}</span></td>`).join('')}</tr></tfoot>
          </table></div>
          ${UI.resultKey(anyEst)}
        </section>
        <div class="actions">
          ${canEdit ? `<a class="btn" href="#/round/${esc(round.id)}/edit">Edit round</a>` : onCard ? `<a class="btn" href="#/round/${esc(round.id)}/mine">Fix my scores</a>` : ''}
          ${canEdit ? `<button class="btn btn-danger-quiet" data-action="delete">Delete round</button>` : ''}
        </div>`;
    }
    DG.setActions({
      discs: (el) => { showDiscs = el.checked; DG.store.set('dg.showDiscs', showDiscs); draw(); },
      delete: async (el) => {
        const ok = await DG.confirm('Delete this round?', 'It will be removed for every player on the card. This cannot be undone.', 'Delete round', true);
        if (!ok) return;
        await DG.busy(el, () => DG.api.rpc('delete_round', { p_id: round.id }));
        await DG.reload();
        DG.toast('Round deleted.');
        DG.go('#/');
      },
    });
    draw();
  };

  UI.resultKey = (anyEst) => `<ul class="res-key" aria-label="Color key">${DG.RESULTS.map((r) =>
    `<li><span class="swatch res-${r.key}"></span>${esc(r.label)}</li>`).join('')}${anyEst ? '<li><span class="swatch res-est">~</span>Not played (filled in from that player\'s average)</li>' : ''}</ul>`;

  /* ============================================================ player */
  DG.pages.player = function (main, params) {
    const ix = DG.state.ix, me = DG.state.me;
    const p = ix.profiles.get(params.id);
    if (!p) return DG.pages.notFound(main);
    const isMe = p.id === me.id;
    const allCards = ix.cardsByPlayer.get(p.id) || [];
    let year = 'all';
    const courseIds = Array.from(new Set(allCards.map((c) => c.courseId)));
    const mostPlayed = courseIds.slice().sort((a, b) =>
      allCards.filter((c) => c.courseId === b).length - allCards.filter((c) => c.courseId === a).length)[0];
    let courseSel = mostPlayed || null;
    let showAllRounds = false;
    let showRetired = false;
    // Discs you take out of the bag stay on screen (dimmed) until you leave the page, so a mis-tap is easy to undo.
    const keepVisible = new Set();
    let bagSaves = Promise.resolve();

    function bagSection() {
      const all = ix.bagByOwner.get(p.id) || [];
      const bag = all.filter((d) => showRetired || d.in_bag || keepVisible.has(d.id));
      const retiredCount = all.filter((d) => !d.in_bag).length;
      return `<section class="section" data-slot="bag">
          <div class="section-head"><h2>${isMe ? 'My bag' : 'Bag'}</h2>
            ${isMe ? '<button class="btn btn-small" data-action="addDisc">Add a disc</button>' : ''}</div>
          ${bag.length ? `<ul class="bag">${bag.map((d) => `<li class="disc ${d.in_bag ? '' : 'is-retired'} ${isMe ? 'is-mine' : ''}">
              ${isMe ? `<label class="in-bag"><input type="checkbox" data-change="toggleInBag" data-id="${esc(d.id)}" ${d.in_bag ? 'checked' : ''}
                aria-label="${esc(d.name)} is in my bag">In bag</label>` : ''}
              <span class="disc-name">${esc(d.name)}${!isMe && !d.in_bag ? ' <span class="tag">Not in bag</span>' : ''}</span>
              <span class="disc-meta">${esc([d.brand, d.category, d.plastic, d.weight_g ? d.weight_g + 'g' : '', d.color].filter(Boolean).join(', '))}</span>
              ${DG.flight(d) || isMe ? `<span class="disc-foot">
                ${DG.flight(d) ? `<span class="flight" aria-label="Flight numbers: speed, glide, turn, fade">${esc(DG.flight(d))}</span>` : ''}
                ${isMe ? `<button class="link-quiet disc-edit" data-action="editDisc" data-id="${esc(d.id)}">Edit</button>` : ''}</span>` : ''}
            </li>`).join('')}</ul>`
            : `<p class="muted">${isMe ? 'Add the discs you carry. Then you can pick your tee disc on each hole.' : 'No discs added yet.'}</p>`}
          ${retiredCount ? `<button class="link-quiet" data-action="retired">${showRetired ? 'Hide' : 'Show'} discs no longer in the bag (${retiredCount})</button>` : ''}
        </section>`;
    }

    /** Redraws just the bag (not the charts) and puts focus back on the box you used. */
    function redrawBag(focusId) {
      const sec = main.querySelector('[data-slot="bag"]');
      if (!sec) return;
      sec.outerHTML = bagSection();
      const box = focusId && main.querySelector(`[data-change="toggleInBag"][data-id="${CSS.escape(focusId)}"]`);
      if (box) box.focus();
    }

    function draw() {
      const cards = allCards.filter(inYear(year));
      const s = DG.summarize(cards);
      const pr = DG.playerRating(allCards);
      const unratedCourses = Array.from(new Set(allCards.filter((c) => c.ratingInfo.reason === 'no_baseline').map((c) => c.courseId)));
      const ratedOldestFirst = allCards.filter((c) => c.ratingInfo.rating !== null).slice().reverse();
      const byCourse = courseIds.map((id) => ({ id, s: DG.summarize(cards.filter((c) => c.courseId === id)) }))
        .filter((x) => x.s.rounds).sort((a, b) => b.s.rounds - a.s.rounds);
      const courseCards = cards.filter((c) => c.courseId === courseSel).slice().reverse();
      const hs = courseSel ? DG.holeStats(ix, courseSel, cards.filter((c) => c.courseId === courseSel)).filter((h) => h.n) : [];
      const tough = hs.slice().sort((a, b) => b.avgDiff - a.avgDiff).slice(0, 3);
      const easy = hs.slice().sort((a, b) => a.avgDiff - b.avgDiff).slice(0, 3);
      const discs = DG.discStats(ix, p.id);
      const anyFeet = discs.some((x) => x.feet.length);
      let longest = null;
      cards.forEach((c) => (c.rp.distances || []).forEach((f, i) => {
        if (f && !(c.rp.estimated && c.rp.estimated[i]) && (!longest || f > longest.feet)) longest = { feet: f, card: c, hole: c.round.holes[i].number };
      }));
      const first = allCards[allCards.length - 1];
      const rounds = cards.map((c) => c.round);

      main.innerHTML = `
        <header class="page-head player-head">
          <h1 data-name>${esc(p.display_name)}</h1>
          <p class="muted">${first ? `Playing since ${esc(DG.fmtDate(first.date))}.` : 'No rounds yet.'}${p.is_admin ? ' Site admin.' : ''}</p>
          ${isMe || DG.isAdmin() ? `<button class="link-quiet" data-action="rename">Change name</button>` : ''}
        </header>
        ${UI.ratingBlock(ix, p, pr, unratedCourses, ratedOldestFirst)}
        ${UI.yearChips(ix, year, 'year')}
        ${UI.stats([
          { label: 'Rounds', value: s.rounds },
          { label: 'Courses', value: byCourse.length },
          { label: 'Birdies or better', value: s.underPar },
          { label: 'Aces', value: s.aces },
          { label: 'Holes at par or better', value: DG.fmtPct(s.parOrBetter) },
        ].concat(longest ? [{ label: 'Longest tee throw', html: `<a href="#/round/${esc(longest.card.roundId)}">${longest.feet} ft</a><span class="stat-sub">${esc(DG.courseName(ix, longest.card.courseId))}, hole ${longest.hole}</span>` }] : []))}
        ${byCourse.length ? `<section class="section"><h2>By course</h2>
          <div class="table-scroll"><table class="data">
            <thead><tr><th scope="col">Course</th><th scope="col" class="num">Rounds</th><th scope="col" class="num">Average</th><th scope="col" class="num">Best</th><th scope="col" class="num">Last played</th></tr></thead>
            <tbody>${byCourse.map((x) => `<tr><th scope="row"><a href="#/course/${esc(x.id)}">${esc(DG.courseName(ix, x.id))}</a></th>
              <td class="num">${x.s.rounds}</td><td class="num">${DG.fmtToPar(x.s.avgToPar)}</td>
              <td class="num"><a href="#/round/${esc(x.s.best.roundId)}">${DG.fmtToPar(x.s.best.toPar)}</a></td>
              <td class="num">${esc(DG.fmtDate(x.s.last.date))}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
        ${byCourse.length ? `<section class="section">
          <div class="section-head"><h2>Score over time</h2></div>
          ${UI.chips(byCourse.map((x) => ({ value: x.id, label: DG.courseName(ix, x.id) })), courseSel, 'course', 'Course')}
          ${courseCards.length >= 2 ? `<div class="chart" id="trend"></div><p class="chart-note">Strokes over par each round at ${esc(DG.courseName(ix, courseSel))}. Lower is better.</p>`
            : `<p class="muted">Play ${esc(DG.courseName(ix, courseSel))} again to see a trend.</p>`}
          ${hs.length ? `<div class="two-col">
            <div><h3>Toughest holes here</h3><ol class="hole-list">${tough.map((h) => `<li><span class="hole-no">${h.hole.number}</span><span>${DG.fmtToPar(h.avgDiff)} average</span></li>`).join('')}</ol></div>
            <div><h3>Best holes here</h3><ol class="hole-list">${easy.map((h) => `<li><span class="hole-no">${h.hole.number}</span><span>${DG.fmtToPar(h.avgDiff)} average</span></li>`).join('')}</ol></div>
          </div>` : ''}
        </section>` : ''}
        ${s.realHoles ? `<section class="section"><h2>How holes go</h2><div class="chart" id="dist"></div></section>` : ''}
        ${bagSection()}
        ${discs.length ? `<section class="section"><h2>Tee discs</h2>
          <div class="table-scroll"><table class="data">
            <thead><tr><th scope="col">Disc</th><th scope="col" class="num">Holes</th><th scope="col" class="num">Average</th><th scope="col" class="num">Birdies or better</th>
              ${anyFeet ? '<th scope="col" class="num">Average throw</th><th scope="col" class="num">Longest</th>' : ''}</tr></thead>
            <tbody>${discs.map((d) => `<tr><th scope="row">${esc(DG.discLabel(d.disc))}</th><td class="num">${d.n}</td>
              <td class="num">${DG.fmtToPar(d.avgDiff)}</td><td class="num">${d.dist.eagle + d.dist.birdie}</td>
              ${anyFeet ? `<td class="num">${d.avgFeet ? Math.round(d.avgFeet) + ' ft' : '–'}</td><td class="num">${d.maxFeet ? d.maxFeet + ' ft' : '–'}</td>` : ''}</tr>`).join('')}</tbody>
          </table></div><p class="chart-note">Average is strokes over par on holes where this disc was thrown off the tee${anyFeet ? '. Throws are tee shots with a distance entered' : ''}. Holes marked "not played" are left out.</p></section>` : ''}
        <section class="section"><h2>Rounds</h2>
          ${UI.feed(ix, showAllRounds ? rounds : rounds.slice(0, 8), p.id) || '<p class="muted">No rounds in this period.</p>'}
          ${!showAllRounds && rounds.length > 8 ? `<button class="btn btn-wide" data-action="allRounds">Show all ${rounds.length} rounds</button>` : ''}
        </section>`;

      const rc = DG.$('#rating-chart', main);
      if (rc) {
        DG.lineChart(rc, {
          label: 'Round ratings over time', fmt: (v) => String(v), higherIsBetter: true, height: 200,
          points: ratedOldestFirst.map((c) => ({ date: c.date, y: c.ratingInfo.rating,
            tip: `${DG.fmtDate(c.date)}\n${DG.courseName(ix, c.courseId)}: rated ${c.ratingInfo.rating}\n${c.strokes} strokes (${DG.fmtToPar(c.toPar)})` })),
        });
      }
      const trend = DG.$('#trend', main);
      if (trend) {
        DG.lineChart(trend, {
          label: 'Score over time',
          points: courseCards.map((c) => ({ date: c.date, y: c.toPar,
            tip: `${DG.fmtDate(c.date)}\n${DG.fmtToPar(c.toPar)} (${c.strokes} strokes)${c.estimated ? `\n${DG.plural(c.estimated, 'hole')} not played` : ''}` })),
        });
      }
      const dist = DG.$('#dist', main);
      if (dist) DG.segBar(dist, { label: 'Scoring breakdown', parts: DG.RESULTS.map((r) => ({ key: r.key, label: r.label, value: s.dist[r.key] })) });
    }

    DG.setActions({
      year: (el) => { year = el.dataset.value; draw(); },
      course: (el) => { courseSel = el.dataset.value; draw(); },
      allRounds: () => { showAllRounds = true; draw(); },
      retired: () => { showRetired = !showRetired; keepVisible.clear(); draw(); },
      // Tick or untick "In bag" right on the card. Saves straight away, one change at a time, in order.
      toggleInBag: (el) => {
        const d = ix.bag.get(el.dataset.id);
        if (!d || !isMe) return;
        d.in_bag = el.checked;
        keepVisible.add(d.id);
        redrawBag(d.id);
        const payload = { id: d.id, catalog_id: d.catalog_id || null, name: d.name, brand: d.brand, category: d.category,
          speed: d.speed, glide: d.glide, turn: d.turn, fade: d.fade, plastic: d.plastic,
          weight_g: d.weight_g, color: d.color, in_bag: d.in_bag };
        bagSaves = bagSaves.then(() => DG.api.rpc('save_bag_disc', { p: payload })).catch(async (err) => {
          DG.toast("That change didn't save: " + DG.errorText(err), 'error');
          bagSaves = Promise.resolve();
          await DG.reload();
          if (DG.state.route === 'player') DG.render();
        });
      },
      rename: async () => {
        const name = await UI.prompt('Change name', 'Name shown on scorecards', p.display_name, 40);
        if (name === null || name.trim() === p.display_name) return;
        await DG.api.rpc('update_profile', { p_id: p.id, p_name: name });
        await DG.reload();
        DG.toast('Name saved.');
        DG.render();
      },
      addDisc: () => UI.discForm(null),
      editDisc: (el) => UI.discForm(ix.bag.get(el.dataset.id)),
    });
    draw();
  };

  /** Simple text prompt using <dialog>. Resolves to text or null. */
  UI.prompt = function (title, label, value, max) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'dialog';
      d.innerHTML = `<form method="dialog" class="stack">
        <h2>${esc(title)}</h2>
        <label>${esc(label)}<input name="v" value="${esc(value || '')}" maxlength="${max || 80}" required></label>
        <p class="form-error" role="alert" hidden></p>
        <div class="dialog-actions"><button value="cancel" class="btn" formnovalidate>Cancel</button>
        <button value="ok" class="btn btn-primary">Save</button></div></form>`;
      document.body.appendChild(d);
      d.addEventListener('close', () => {
        const v = d.querySelector('input').value;
        resolve(d.returnValue === 'ok' ? v : null);
        d.remove();
      });
      d.showModal();
      d.querySelector('input').select();
    });
  };

  /* ------------------------------------------------------------ bag disc form */
  UI.discForm = async function (disc) {
    const me = DG.state.me;
    const d = document.createElement('dialog');
    d.className = 'dialog dialog-wide';
    const v = disc || {};
    d.innerHTML = `<form class="stack" data-disc-form novalidate>
      <h2>${disc ? 'Edit disc' : 'Add a disc'}</h2>
      ${disc ? '' : `<label>Find your disc<input type="search" name="q" placeholder="Start typing, like Buzzz or Destroyer" autocomplete="off" data-search>
        <span class="hint" data-cat-status>Loading the disc list…</span></label>
        <ul class="cat-results" data-results role="listbox" aria-label="Matching discs"></ul>`}
      <fieldset class="disc-fields">
        <legend>${disc ? 'Details' : 'Details (filled in when you pick a disc, or type your own)'}</legend>
        <input type="hidden" name="catalog_id" value="${esc(v.catalog_id || '')}">
        <label>Disc name<input name="name" value="${esc(v.name || '')}" maxlength="60" required></label>
        <div class="grid-2">
          <label>Brand<input name="brand" value="${esc(v.brand || '')}" maxlength="60"></label>
          <label>Type<input name="category" value="${esc(v.category || '')}" maxlength="40" list="disc-types"></label>
        </div>
        <datalist id="disc-types"><option value="Distance Driver"><option value="Control Driver"><option value="Hybrid Driver"><option value="Midrange"><option value="Putter"><option value="Approach Discs"></datalist>
        <div class="grid-4">
          <label>Speed<input name="speed" inputmode="decimal" value="${esc(v.speed ?? '')}"></label>
          <label>Glide<input name="glide" inputmode="decimal" value="${esc(v.glide ?? '')}"></label>
          <label>Turn<input name="turn" inputmode="decimal" value="${esc(v.turn ?? '')}"></label>
          <label>Fade<input name="fade" inputmode="decimal" value="${esc(v.fade ?? '')}"></label>
        </div>
        <div class="grid-3">
          <label>Plastic<input name="plastic" value="${esc(v.plastic || '')}" maxlength="40" placeholder="Optional"></label>
          <label>Weight (g)<input name="weight_g" inputmode="numeric" value="${esc(v.weight_g || '')}" placeholder="Optional"></label>
          <label>Color<input name="color" value="${esc(v.color || '')}" maxlength="40" placeholder="Optional"></label>
        </div>
        ${disc ? `<label class="toggle"><input type="checkbox" name="in_bag" ${v.in_bag ? 'checked' : ''}> In my bag right now</label>` : ''}
      </fieldset>
      <p class="form-error" role="alert" hidden></p>
      <div class="dialog-actions"><button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">${disc ? 'Save disc' : 'Add to bag'}</button></div>
    </form>`;
    document.body.appendChild(d);
    d.showModal();
    const form = d.querySelector('form');
    d.querySelector('[data-close]').addEventListener('click', () => d.close());
    d.addEventListener('close', () => d.remove());

    if (!disc) {
      const status = d.querySelector('[data-cat-status]');
      const results = d.querySelector('[data-results]');
      const search = d.querySelector('[data-search]');
      let catalog = DG.state.catalog;
      try {
        if (!catalog) catalog = DG.state.catalog = await DG.api.loadCatalog();
        status.textContent = catalog.length
          ? `${catalog.length.toLocaleString()} discs in the list. Not finding it? Type the details below.`
          : 'The disc list is empty, so type the details below.';
      } catch (e) {
        catalog = [];
        status.textContent = "Couldn't load the disc list. Type the details below.";
      }
      const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      search.addEventListener('input', () => {
        const q = norm(search.value);
        if (q.length < 2) { results.innerHTML = ''; return; }
        const words = q.split(' ');
        const hits = catalog.filter((c) => {
          const hay = norm(c.name + ' ' + c.brand);
          return words.every((w) => hay.indexOf(w) !== -1);
        }).sort((a, b) => (norm(a.name).startsWith(q) ? 0 : 1) - (norm(b.name).startsWith(q) ? 0 : 1) || a.name.localeCompare(b.name)).slice(0, 8);
        results.innerHTML = hits.map((c) => `<li><button type="button" class="cat-hit" data-id="${esc(c.id)}">
            <span class="disc-name">${esc(c.name)}</span><span class="disc-meta">${esc([c.brand, c.category].filter(Boolean).join(', '))}</span>
            ${DG.flight(c) ? `<span class="flight">${esc(DG.flight(c))}</span>` : ''}</button></li>`).join('') ||
          '<li class="muted cat-none">No match. Type the details below.</li>';
      });
      results.addEventListener('click', (e) => {
        const b = e.target.closest('.cat-hit');
        if (!b) return;
        const c = catalog.find((x) => x.id === b.dataset.id);
        ['name', 'brand', 'category', 'speed', 'glide', 'turn', 'fade'].forEach((k) => {
          form.elements[k].value = c[k] === null || c[k] === undefined ? '' : c[k];
        });
        form.elements.catalog_id.value = c.id;
        results.innerHTML = '';
        search.value = c.name;
        form.elements.plastic.focus();
      });
      form.elements.name.addEventListener('input', () => { form.elements.catalog_id.value = ''; });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = form.querySelector('.form-error');
      errEl.hidden = true;
      const f = DG.formData(form);
      if (!String(f.name || '').trim()) {
        errEl.textContent = 'Enter the disc name.';
        errEl.hidden = false;
        return;
      }
      const payload = {
        id: disc ? disc.id : null, catalog_id: f.catalog_id || null, name: f.name, brand: f.brand, category: f.category,
        speed: f.speed, glide: f.glide, turn: f.turn, fade: f.fade, plastic: f.plastic,
        weight_g: f.weight_g, color: f.color, in_bag: disc ? !!form.elements.in_bag.checked : true,
      };
      try {
        await DG.busy(form.querySelector('[type=submit]'), () => DG.api.rpc('save_bag_disc', { p: payload }));
        d.close();
        await DG.reload();
        DG.toast(disc ? 'Disc saved.' : 'Disc added to your bag.');
        if (DG.state.route === 'player') DG.render();
      } catch (err) {
        errEl.textContent = DG.errorText(err);
        errEl.hidden = false;
      }
    });
    void me;
  };

  /* ============================================================ courses */
  DG.pages.courses = function (main) {
    const ix = DG.state.ix, me = DG.state.me;
    const courses = ix.raw.courses.slice().sort((a, b) => a.name.localeCompare(b.name));
    const row = (c) => {
      const cards = ix.cardsByCourse.get(c.id) || [];
      const mine = DG.summarize(cards.filter((x) => x.playerId === me.id));
      const holes = (ix.holesByCourse.get(c.id) || []).length;
      const pars = DG.coursePars(ix, c).filter((t) => t.par !== null);
      return `<li class="course-item"><a href="#/course/${esc(c.id)}" class="course-link">
        <span class="course-name">${esc(c.name)}</span>
        <span class="course-meta">${esc([c.location, DG.plural(holes, 'hole'), pars.map((t) => `${t.tee} par ${t.par}`).join(', ')].filter(Boolean).join('. '))}</span>
        <span class="course-nums"><span>${DG.plural(new Set(cards.map((x) => x.roundId)).size, 'round')}</span>
          ${mine.best ? `<span>Your best ${DG.fmtToPar(mine.best.toPar)}</span>` : ''}</span>
      </a></li>`;
    };
    const active = courses.filter((c) => c.active), hidden = courses.filter((c) => !c.active);
    main.innerHTML = `<header class="page-head"><h1>Courses</h1>
        ${DG.isAdmin() ? '<a class="btn btn-small" href="#/admin/course/new">Add a course</a>' : ''}</header>
      ${active.length ? `<ul class="course-list">${active.map(row).join('')}</ul>` : '<p class="muted">No courses yet.</p>'}
      ${hidden.length ? `<h2 class="section">Hidden courses</h2><p class="muted">Not offered when starting a round.</p><ul class="course-list">${hidden.map(row).join('')}</ul>` : ''}`;
  };

  /* ============================================================ course */
  DG.pages.course = function (main, params) {
    const ix = DG.state.ix, me = DG.state.me;
    const course = ix.courses.get(params.id);
    if (!course) return DG.pages.notFound(main);
    const holes = ix.holesByCourse.get(course.id) || [];
    const allCards = ix.cardsByCourse.get(course.id) || [];
    let year = 'all';
    let who = 'all';

    function draw() {
      const cards = allCards.filter(inYear(year));
      const roundIds = Array.from(new Set(cards.map((c) => c.roundId)));
      const record = cards.reduce((b, c) => (!b || c.toPar < b.toPar ? c : b), null);
      const players = Array.from(new Set(cards.map((c) => c.playerId))).map((id) => {
        const s = DG.summarize(cards.filter((c) => c.playerId === id));
        return { id, s };
      }).sort((a, b) => a.s.best.toPar - b.s.best.toPar || a.s.avgToPar - b.s.avgToPar);
      const most = players.slice().sort((a, b) => b.s.rounds - a.s.rounds)[0];
      const eligible = players.filter((x) => x.s.rounds >= 3);
      const bestAvg = eligible.sort((a, b) => a.s.avgToPar - b.s.avgToPar)[0];
      const hsCards = who === 'me' ? cards.filter((c) => c.playerId === me.id) : cards;
      const hs = DG.holeStats(ix, course.id, hsCards);
      const s = DG.summarize(hsCards);
      const pars = DG.coursePars(ix, course);
      const recent = roundIds.map((id) => ix.rounds.get(id)).sort(DG.compareRoundsDesc).slice(0, 5);

      main.innerHTML = `
        <header class="page-head">
          <p class="crumb"><a href="#/courses">Courses</a></p>
          <h1>${esc(course.name)}</h1>
          <p class="muted">${esc([course.location, DG.plural(holes.length, 'hole'),
            pars.map((t) => (t.par !== null ? `${t.tee} tees par ${t.par}` : `${t.tee} tees on ${t.holes} holes`) +
              (course.ssa && course.ssa[t.tee] ? ` (1000-rated score ${course.ssa[t.tee]})` : '')).join(', ')].filter(Boolean).join('. '))}.</p>
          ${course.notes ? `<p>${esc(course.notes)}</p>` : ''}
          ${DG.isAdmin() ? `<a class="btn btn-small" href="#/admin/course/${esc(course.id)}">Edit course</a>` : ''}
        </header>
        ${UI.yearChips(ix, year, 'year')}
        ${cards.length ? UI.stats([
          { label: 'Course record', html: `<a href="#/round/${esc(record.roundId)}">${DG.fmtToPar(record.toPar)}</a><span class="stat-sub">${esc(DG.playerName(ix, record.playerId))}, ${esc(DG.fmtDate(record.date))}</span>` },
          { label: 'Best average', html: bestAvg ? `${DG.fmtToPar(Math.round(bestAvg.s.avgToPar * 10) / 10)}<span class="stat-sub">${esc(DG.playerName(ix, bestAvg.id))}, 3+ rounds</span>` : '–' },
          { label: 'Most rounds', html: `${most.s.rounds}<span class="stat-sub">${esc(DG.playerName(ix, most.id))}</span>` },
          { label: 'Rounds played', value: roundIds.length },
        ]) : '<p class="muted">Nobody has played here yet.</p>'}
        ${players.length ? `<section class="section"><h2>Leaderboard</h2>
          <div class="table-scroll"><table class="data">
            <thead><tr><th scope="col">Player</th><th scope="col" class="num">Best</th><th scope="col" class="num">Average</th><th scope="col" class="num">Rounds</th></tr></thead>
            <tbody>${players.map((x) => `<tr class="${x.id === me.id ? 'is-me' : ''}"><th scope="row">${UI.playerLink(ix, x.id)}</th>
              <td class="num"><a href="#/round/${esc(x.s.best.roundId)}">${DG.fmtToPar(x.s.best.toPar)}</a></td>
              <td class="num">${DG.fmtToPar(Math.round(x.s.avgToPar * 10) / 10)}</td><td class="num">${x.s.rounds}</td></tr>`).join('')}</tbody>
          </table></div></section>` : ''}
        <section class="section">
          <div class="section-head"><h2>Hole by hole</h2>
            ${UI.chips([{ value: 'all', label: 'Everyone' }, { value: 'me', label: 'Just me' }], who, 'who', 'Whose scores')}</div>
          ${s.realHoles ? `<div class="chart" id="holes-chart"></div>
            <p class="chart-note">Average strokes over par on each hole${who === 'me' ? ' for you' : ''}. Taller bars are tougher holes.</p>` : '<p class="muted">No scores yet.</p>'}
          <div class="table-scroll"><table class="data holes-table">
            <thead><tr><th scope="col">Hole</th>${course.tees.map((t) => `<th scope="col" class="num">${esc(t)}</th>`).join('')}
              <th scope="col">Baskets</th><th scope="col" class="num">Average</th><th scope="col" class="num">Par or better</th></tr></thead>
            <tbody>${hs.map((h) => `<tr><th scope="row">${h.hole.number}</th>
              ${course.tees.map((t) => `<td class="num">${h.hole.pars[t] !== undefined ? 'Par ' + h.hole.pars[t] + UI.basketDetail(h.hole, t) : '–'}</td>`).join('')}
              <td>${h.hole.baskets.map((b) => `<span class="basket-tag">${esc(b)}</span>`).join('')}</td>
              <td class="num">${h.n ? DG.fmtToPar(Math.round(h.avgDiff * 10) / 10) : '–'}</td>
              <td class="num">${h.n ? DG.fmtPct(h.parOrBetter) : '–'}</td></tr>`).join('')}</tbody>
          </table></div>
        </section>
        ${s.realHoles ? `<section class="section"><h2>How holes go here</h2><div class="chart" id="dist"></div></section>` : ''}
        ${recent.length ? `<section class="section"><h2>Recent rounds here</h2>${UI.feed(ix, recent)}</section>` : ''}`;

      const hc = DG.$('#holes-chart', main);
      if (hc) {
        DG.barChart(hc, {
          label: 'Average strokes over par by hole',
          bars: hs.map((h) => ({ label: String(h.hole.number), value: h.n ? h.avgDiff : null,
            tip: h.n ? `Hole ${h.hole.number}\n${DG.fmtToPar(Math.round(h.avgDiff * 100) / 100)} average\n${DG.fmtPct(h.parOrBetter)} at par or better\n${DG.plural(h.n, 'score')}` : `Hole ${h.hole.number}\nNo scores` })),
        });
      }
      const dist = DG.$('#dist', main);
      if (dist) DG.segBar(dist, { label: 'Scoring breakdown', parts: DG.RESULTS.map((r) => ({ key: r.key, label: r.label, value: s.dist[r.key] })) });
    }
    DG.setActions({
      year: (el) => { year = el.dataset.value; draw(); },
      who: (el) => { who = el.dataset.value; draw(); },
    });
    draw();
  };

  /* ============================================================ leaderboard */
  DG.pages.leaders = function (main) {
    const ix = DG.state.ix, me = DG.state.me;
    let year = 'all';
    let board = DG.store.get('dg.board', 'overall');
    let sort = 'best';

    function draw() {
      const cards = ix.cards.filter(inYear(year));
      const playedCourses = ix.raw.courses.filter((c) => cards.some((x) => x.courseId === c.id)).sort((a, b) => a.name.localeCompare(b.name));
      if (board !== 'overall' && !playedCourses.some((c) => c.id === board)) board = 'overall';
      let table;
      if (board === 'overall') {
        const rows = Array.from(new Set(cards.map((c) => c.playerId))).map((id) => {
          const mine = cards.filter((c) => c.playerId === id);
          const pr = DG.playerRating(ix.cardsByPlayer.get(id) || []);
          return { id, s: DG.summarize(mine), courses: new Set(mine.map((c) => c.courseId)).size, rating: pr ? pr.rating : null };
        }).sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.s.rounds - a.s.rounds);
        table = rows.length ? `<div class="table-scroll"><table class="data">
          <thead><tr><th scope="col">Player</th><th scope="col" class="num">Rating</th><th scope="col" class="num">Rounds</th><th scope="col" class="num">Courses</th>
            <th scope="col" class="num">Birdies or better</th><th scope="col" class="num">Aces</th><th scope="col" class="num">Par or better</th></tr></thead>
          <tbody>${rows.map((r) => `<tr class="${r.id === me.id ? 'is-me' : ''}"><th scope="row">${UI.playerLink(ix, r.id)}</th>
            <td class="num"><strong>${r.rating ?? '–'}</strong></td>
            <td class="num">${r.s.rounds}</td><td class="num">${r.courses}</td><td class="num">${r.s.underPar}</td>
            <td class="num">${r.s.aces}</td><td class="num">${DG.fmtPct(r.s.parOrBetter)}</td></tr>`).join('')}</tbody></table></div>
          <p class="chart-note">Rating is each player's current rating, worked out the PDGA way, so it compares players across courses. The other columns follow the year you pick. Pick a course above for its own board.</p>`
          : '<p class="muted">No rounds in this period.</p>';
      } else {
        const cc = cards.filter((c) => c.courseId === board);
        const rows = Array.from(new Set(cc.map((c) => c.playerId))).map((id) => ({ id, s: DG.summarize(cc.filter((c) => c.playerId === id)) }))
          .sort(sort === 'best'
            ? (a, b) => a.s.best.toPar - b.s.best.toPar || a.s.avgToPar - b.s.avgToPar
            : (a, b) => a.s.avgToPar - b.s.avgToPar || a.s.best.toPar - b.s.best.toPar);
        let rank = 0, prev = null;
        table = `<div class="table-scroll"><table class="data">
          <thead><tr><th scope="col" class="num">#</th><th scope="col">Player</th>
            <th scope="col" class="num"><button class="th-sort ${sort === 'best' ? 'is-on' : ''}" data-action="sort" data-value="best" aria-pressed="${sort === 'best'}">Best round</button></th>
            <th scope="col" class="num"><button class="th-sort ${sort === 'avg' ? 'is-on' : ''}" data-action="sort" data-value="avg" aria-pressed="${sort === 'avg'}">Average</button></th>
            <th scope="col" class="num">Rounds</th><th scope="col" class="num">Par or better</th></tr></thead>
          <tbody>${rows.map((r, i) => {
            const key = sort === 'best' ? r.s.best.toPar : Math.round(r.s.avgToPar * 10);
            if (key !== prev) rank = i + 1;
            prev = key;
            return `<tr class="${r.id === me.id ? 'is-me' : ''}"><td class="num rank">${rank}</td><th scope="row">${UI.playerLink(ix, r.id)}</th>
              <td class="num"><a href="#/round/${esc(r.s.best.roundId)}">${DG.fmtToPar(r.s.best.toPar)}</a></td>
              <td class="num">${DG.fmtToPar(Math.round(r.s.avgToPar * 10) / 10)}</td>
              <td class="num">${r.s.rounds}</td><td class="num">${DG.fmtPct(r.s.parOrBetter)}</td></tr>`;
          }).join('')}</tbody></table></div>
          <p class="chart-note">Tap a column name to rank by it. Rounds with holes marked "not played" count, using the filled-in scores.</p>`;
      }
      main.innerHTML = `<header class="page-head"><h1>Leaderboard</h1></header>
        ${UI.yearChips(ix, year, 'year')}
        ${UI.chips([{ value: 'overall', label: 'Everyone overall' }].concat(playedCourses.map((c) => ({ value: c.id, label: c.name }))), board, 'board', 'Board')}
        <section class="section">${board !== 'overall' ? `<h2><a href="#/course/${esc(board)}">${esc(DG.courseName(ix, board))}</a></h2>` : ''}${table}</section>`;
    }
    DG.setActions({
      year: (el) => { year = el.dataset.value; draw(); },
      board: (el) => { board = el.dataset.value; DG.store.set('dg.board', board); draw(); },
      sort: (el) => { sort = el.dataset.value; draw(); },
    });
    draw();
  };
})();
