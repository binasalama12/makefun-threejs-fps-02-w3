// Frostline Depot — shared tuning data.
// Every name here is invented for this game: the two crews, the five guns
// and the frostpulse grenade have no counterpart in any commercial title.

export const TEAM_PLAYER = 'Frostwardens';
export const TEAM_ENEMY = 'Soot Syndicate';

export const ALLY_NAMES = ['Warden Pip', 'Warden Sable'];
export const ENEMY_NAMES = ['Soot Bram', 'Soot Ysolde', 'Soot Fenwick', 'Soot Marl'];

// Weapons differ in price, damage, cadence, magazine and how much their
// spread blooms while the holder moves. Stopping and crouching always
// tightens a gun back down — accuracy is a decision, not a dice roll.
export const WEAPONS = [
  {
    id: 'nixie', name: 'Nixie P2 Sidearm', price: 0, damage: 24, headMult: 4.0,
    interval: 0.27, mag: 12, reserve: 60, reloadMs: 1100, spread: 0.013,
    pellets: 1, auto: false, kick: 0.010, range: 60,
  },
  {
    id: 'squall', name: 'Squall-9 Gust SMG', price: 900, damage: 19, headMult: 3.4,
    interval: 0.075, mag: 32, reserve: 128, reloadMs: 1600, spread: 0.030,
    pellets: 1, auto: true, kick: 0.006, range: 55,
  },
  {
    id: 'vela', name: 'Vela AR-7 Carbine', price: 2400, damage: 34, headMult: 4.0,
    interval: 0.115, mag: 30, reserve: 120, reloadMs: 2000, spread: 0.019,
    pellets: 1, auto: true, kick: 0.011, range: 90,
  },
  {
    id: 'breakice', name: 'Breakice Scattergun', price: 1500, damage: 11, headMult: 2.0,
    interval: 0.85, mag: 6, reserve: 30, reloadMs: 2600, spread: 0.055,
    pellets: 8, auto: false, kick: 0.030, range: 26,
  },
  {
    id: 'longnight', name: 'Longnight Marksman', price: 3200, damage: 68, headMult: 3.5,
    interval: 0.55, mag: 10, reserve: 40, reloadMs: 2400, spread: 0.006,
    pellets: 1, auto: false, kick: 0.022, range: 130,
  },
];

export const GRENADE = { name: 'Frostpulse Grenade', price: 300, radius: 7, slowSeconds: 4 };

// The second throwable: a chalk charge that blooms into a whiteout
// cloud. It deals no damage — it deletes a sight line for a few
// seconds, for the player's eyes and the bots' alike.
export const SMOKE = { name: 'Whiteout Smokescreen', price: 250, radius: 4.2, duration: 9, bloomSeconds: 0.9 };

export const ECONOMY = {
  startMoney: 2600,
  winReward: 2400,
  lossReward: 1400,
  killReward: 300,
  plantReward: 300,
  maxMoney: 12000,
};

export const ROUND = {
  buySeconds: 60, // buy overlay waits for the player to lock in (Enter / click)
  liveSeconds: 100,
  plantChannelSeconds: 3,
  fuseSeconds: 10,
  defuseChannelSeconds: 4,
  endSeconds: 6,
};
