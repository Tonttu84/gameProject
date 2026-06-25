# Architecture

Diagrams use [Mermaid](https://mermaid.js.org/) syntax, rendered automatically by GitHub.

---

## System overview

The battle engine is the only completed subsystem. The strategic map and turn-by-turn UI are shown as future connection points so it's clear where the APIs need to extend.

```mermaid
flowchart TD
    SM["🗺️ Strategic Map\n(future)\nmanages armies between battles"]
    BS["BattleSetup\nappendArmy&lt;T&gt;(army, count, team)\nrandomPlaceArmy(army, field, zone)"]
    BF["Battlefield\nloadArmies(red, blue)\ntick() → bool\nextractResult() → BattleResult"]
    BR["BattleResult\n─────────────\nwinner: int\nredSurvivors: Army\nblueSurvivors: Army\ncorpses: size_t"]
    UI["🖥️ Turn-by-Turn UI\n(future)\ncalls tick() once per frame\nreads grid state between ticks"]

    SM -->|"build Army vectors"| BS
    BS -->|"loadArmies(red, blue)"| BF
    UI <-->|"tick() / read _battlefield"| BF
    BF -->|"extractResult()"| BR
    BR -->|"survivors re-enter army pool"| SM
```

> `Army = std::vector<std::unique_ptr<AUnit>>` is the transfer type across all boundaries.
> Units marked `battleSummon = true` (e.g. Necromancer zombies) are filtered out of survivors.

---

## What happens each tick

```mermaid
flowchart LR
    T["tick()"] --> SP["triggerSpecialPhase()\ncall special() on every living unit\n(archers shoot, mages cast, priests heal,\n necromancers raise dead)"]
    SP --> MU["moveUnits()\nbroken units flee toward map edge\nothers step toward nearest enemy"]
    MU --> MB["makeBattle()\ninterleaved: random unit from each team\nattacks adjacent enemies in turn"]
    MB --> CL["cleanup()\nremove dead units from team vectors\nundead don't add to corpse count"]
    CL --> R{"both teams\nstill alive?"}
    R -->|yes| yes["return true\n→ caller ticks again"]
    R -->|no| no["return false\n→ caller calls extractResult()"]
```

---

## Unit class hierarchy

```mermaid
classDiagram
    AUnit <|-- Human
    AUnit <|-- Zombie
    Human <|-- Soldier
    Human <|-- Archer
    Human <|-- Mage
    Human <|-- Priest
    Human <|-- Necromancer

    class AUnit {
        +battle(Battlefield)
        +find_target(Battlefield) AUnit*
        +defend(attack, damage) int
        +testMorale(damage) bool
        +rally() bool
        +special()
        +battleSummon bool
        +unitValue int
    }

    class Soldier {
        heavy armour, SwordAndShield
        special() — no-op
    }

    class Archer {
        +fireBow() int
        +findArcherTarget() Cell*
        +calcShot(target, team) int
        ammunition: int
    }

    class Mage {
        +castFireball()
        +findMageTarget() Cell*
        mana: int
    }

    class Priest {
        +castBless()
        mana: int
    }

    class Necromancer {
        +raiseDead()
        +placeZombie(Cell*) bool
        mana: int
    }

    class Zombie {
        undead = true
        fatigueCost = 0
        unitValue = 5
    }
```

---

## Utility services

`Utility` is accessed as a static/global throughout the engine. Everything that needs randomness, targeting math, or the battlefield singleton goes through here.

```mermaid
flowchart LR
    U["Utility"]
    U --> BF["getBattlefield() → Battlefield&\nsingleton accessor"]
    U --> RNG["getRandom(min, max) → int\nthrowDice() → int\nexploding d6: re-rolls and adds on a 6"]
    U --> TGT["findTarget(team, filter, scorer, myTeam)\nFinds best unit passing filter,\nranked by scorer function\nUsed by Archer and Priest"]
    U --> PTGT["FindPriorityTarget(team, scorer, myTeam)\nHighest-score unit in team\nUsed by Mage"]
    U --> MATH["calcDistance(a, b) → ssize_t\nChebyshev distance between two cells\nDeviate(origin, h, w, accuracy)\nRandomly shifts aim based on accuracy stat"]
```

---

## Data flow: Archer firing (example)

A concrete walk-through of how a ranged attack crosses subsystem boundaries.

```mermaid
sequenceDiagram
    participant BF as Battlefield::tick
    participant A as Archer::special
    participant U as Utility
    participant C as Cell / AUnit

    BF->>A: special() via triggerSpecialPhase
    A->>A: fireBow()
    A->>U: findTarget(enemyTeam, accurateShot, calcShot, myTeam)
    U-->>A: Cell* targetCell
    A->>U: Deviate(myCell, targetH, targetW, accuracy)
    U->>U: getRandom() to compute spread
    U-->>A: Cell* deviatedCell (may differ from target)
    A->>C: targetCell->fire = true
    A->>C: targetUnit->defend(hitRoll, damage)
    C->>C: testMorale(resultDamage)
```
