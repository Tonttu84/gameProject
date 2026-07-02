// Shaped exactly like `./game battle` stdout (see backend ReplayRecorder.cpp
// and resultToJson in BattleServer.cpp).
export const battleResultFixture = {
  winner: 'blue',
  blue_survivors: { Soldier: 2 },
  red_survivors: {},
  replay: {
    map: 'sample_battle',
    cols: 16,
    rows: 30,
    ticks: [
      {
        tick: 0,
        units: [
          { id: 0, type: 'Zombie', team: 'red', q: 3, r: 25, hp: 20 },
          { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10 },
          { id: 2, type: 'Soldier', team: 'blue', q: 5, r: 4, hp: 10 },
        ],
        log: [],
      },
      {
        tick: 1,
        units: [
          { id: 0, type: 'Zombie', team: 'red', q: 3, r: 24, hp: 20 },
          { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 5, hp: 10 },
          { id: 2, type: 'Soldier', team: 'blue', q: 5, r: 5, hp: 8 },
        ],
        log: [],
      },
      {
        tick: 2,
        units: [
          { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 6, hp: 10 },
          { id: 2, type: 'Soldier', team: 'blue', q: 5, r: 6, hp: 8 },
        ],
        log: ['Zombie (red) fell'],
      },
    ],
  },
}
