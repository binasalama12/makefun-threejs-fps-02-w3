// Frostline Depot — every DOM readout lives here: health, cash, round,
// timer, ammunition, team score, kill feed, the buy menu and the
// end-of-round scoreboard. The simulation in main.js only calls these
// setters; it never touches the document itself.

import { WEAPONS, GRENADE } from './config.js';

const $ = (id) => document.getElementById(id);

export function createHud({ onBuy, onBuyGrenade, onDeploy }) {
  const els = {
    hp: $('hp'), hpfill: $('hpfill'), money: $('money-value'), roundLabel: $('round-label'),
    timer: $('timer'), scoreA: $('score-a'), scoreB: $('score-b'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weaponname'),
    grenades: $('grenades'), objective: $('objective'), alive: $('alive-label'),
    message: $('message'), sub: $('submessage'), feed: $('killfeed'),
    channelWrap: $('channelwrap'), channelFill: $('channelfill'), channelLabel: $('channellabel'),
    vignette: $('vignette'), hitmarker: $('hitmarker'),
    buy: $('buy'), buylist: $('buylist'), roundend: $('roundend'),
  };
  let hitTimer = null;
  let hurtTimer = null;

  $('start-round').addEventListener('click', () => onDeploy());

  function renderBuy(state) {
    els.buylist.innerHTML = '';
    WEAPONS.forEach((w, i) => {
      const owned = state.owned.includes(w.id);
      const afford = state.money >= w.price;
      const row = document.createElement('div');
      row.className = 'buyrow' + (owned ? ' owned' : '');
      const left = document.createElement('div');
      left.innerHTML = `<b>${i + 1}. ${w.name}</b> — $${w.price}<br><span class="stats">DMG ${w.damage}${w.pellets > 1 ? ' ×' + w.pellets : ''} · MAG ${w.mag} · ${w.auto ? 'auto' : 'semi'} · spread ${(w.spread * 1000).toFixed(0)}</span>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = owned ? 'Owned' : afford ? 'Buy' : 'Too dear';
      btn.disabled = owned || !afford;
      btn.addEventListener('click', () => onBuy(w.id));
      row.append(left, btn);
      els.buylist.appendChild(row);
    });
    const row = document.createElement('div');
    row.className = 'buyrow';
    const left = document.createElement('div');
    left.innerHTML = `<b>6. ${GRENADE.name}</b> — $${GRENADE.price}<br><span class="stats">Slows and half-blinds every foe within ${GRENADE.radius} m for ${GRENADE.slowSeconds} s</span>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = state.money >= GRENADE.price ? `Buy (×${state.grenades})` : 'Too dear';
    btn.disabled = state.money < GRENADE.price;
    btn.addEventListener('click', () => onBuyGrenade());
    row.append(left, btn);
    els.buylist.appendChild(row);
  }

  return {
    els,
    renderBuy,
    showBuy() { els.buy.hidden = false; },
    hideBuy() { els.buy.hidden = true; },
    showEnd({ title, reason, scoreA, scoreB, kills, money }) {
      $('end-title').textContent = title;
      $('end-reason').textContent = reason;
      $('end-a').textContent = scoreA;
      $('end-b').textContent = scoreB;
      $('end-kills').textContent = kills;
      $('end-money').textContent = '$' + money;
      els.roundend.hidden = false;
    },
    hideEnd() { els.roundend.hidden = true; },
    setHp(v) {
      els.hp.textContent = Math.max(0, Math.ceil(v));
      els.hpfill.style.width = Math.max(0, v) + '%';
      els.hpfill.style.background = v > 55 ? 'var(--good)' : v > 25 ? 'var(--warn)' : 'var(--bad)';
    },
    setMoney(v) { els.money.textContent = v; },
    setRound(n, phase) { els.roundLabel.textContent = `ROUND ${n} · ${phase}`; },
    setTimer(text, urgent = false) { els.timer.textContent = text; els.timer.style.color = urgent ? 'var(--bad)' : ''; },
    setScore(a, b) { els.scoreA.textContent = a; els.scoreB.textContent = b; },
    setAmmo(mag, reserve, weaponName) {
      els.ammoMag.textContent = mag;
      els.ammoReserve.textContent = reserve;
      els.weaponName.textContent = weaponName;
    },
    setGrenades(n) { els.grenades.textContent = `Frostpulse × ${n} · [G] throw`; },
    setObjective(text) { els.objective.textContent = text; },
    setAlive(a, e) { els.alive.textContent = `Allies ${a} · Foes ${e}`; },
    message(text, sub = '') { els.message.textContent = text; els.sub.textContent = sub; },
    feed(text) {
      const div = document.createElement('div');
      div.textContent = text;
      els.feed.prepend(div);
      while (els.feed.children.length > 5) els.feed.lastChild.remove();
      setTimeout(() => div.remove(), 6000);
    },
    channel(label, frac) {
      if (frac === null) { els.channelWrap.hidden = true; return; }
      els.channelWrap.hidden = false;
      els.channelLabel.textContent = label;
      els.channelFill.style.width = Math.round(frac * 100) + '%';
    },
    hitmark(killed) {
      els.hitmarker.classList.add('on');
      els.hitmarker.style.filter = killed ? 'brightness(1.6)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on'), killed ? 260 : 110);
    },
    hurt() {
      els.vignette.classList.add('hurt');
      clearTimeout(hurtTimer);
      hurtTimer = setTimeout(() => els.vignette.classList.remove('hurt'), 160);
    },
  };
}
