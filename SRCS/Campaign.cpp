#include "../HDRS/Campaign.hpp"
#include "../HDRS/BattleSetup.hpp"
#include "../HDRS/SampleBattle.hpp"
#include "../HDRS/Soldier.hpp"
#include "../HDRS/Archer.hpp"
#include "../HDRS/Mage.hpp"
#include "../HDRS/Priest.hpp"
#include "../HDRS/Necromancer.hpp"

#include <sys/ioctl.h>
#include <sys/select.h>
#include <unistd.h>
#include <iostream>
#include <thread>
#include <chrono>

// ── Battle display timing ──────────────────────────────────────────────────────
static constexpr int PAUSED_SLEEP_MS = 50;  // poll interval while paused
static constexpr int TICK_SLEEP_MS   = 200; // delay between simulation ticks — lower = faster

// ── Campaign economy ───────────────────────────────────────────────────────────
static constexpr int STARTING_GOLD    = 1000;
static constexpr int BATTLE_REWARD[3] = { 600, 800, 1000 }; // gold for winning each battle
static constexpr int NUM_BATTLES      = 3;

// ── Buy screen — unit costs and squad sizes ────────────────────────────────────
// Soldiers/archers are purchased as squads; mages and priests are individuals.
static constexpr int SOLDIER_SQUAD = 100;
static constexpr int SOLDIER_COST  = 200;
static constexpr int ARCHER_SQUAD  = 30;
static constexpr int ARCHER_COST   = 150;
static constexpr int MAGE_COST     = 100;
static constexpr int PRIEST_COST   = 75;

// ── Strategic roster — what the player has between battles ────────────────────
// Each value is a head count; fresh unit instances are created at battle start.
struct PlayerRoster {
    int soldiers = 0;
    int archers  = 0;
    int mages    = 0;
    int priests  = 0;

    int totalTroops() const { return soldiers + archers + mages + priests; }
};

// Count survivors by type after extractResult().
static PlayerRoster countSurvivors(const Army& survivors)
{
    PlayerRoster r;
    for (const auto& u : survivors) {
        if (!u) continue;
        switch (u->getPrintSymbol()) {
            case 'X': r.soldiers++; break;
            case 'A': r.archers++;  break;
            case 'M': r.mages++;    break;
            case 'P': r.priests++;  break;
            default: break;
        }
    }
    return r;
}

// Build a fresh Army from roster counts.
static Army buildPlayerArmy(const PlayerRoster& r)
{
    Army army;
    appendArmy<Soldier>(army, static_cast<size_t>(r.soldiers), BLUETEAM);
    appendArmy<Archer> (army, static_cast<size_t>(r.archers),  BLUETEAM);
    appendArmy<Mage>   (army, static_cast<size_t>(r.mages),    BLUETEAM);
    appendArmy<Priest> (army, static_cast<size_t>(r.priests),  BLUETEAM);
    return army;
}

// ── Enemy presets ──────────────────────────────────────────────────────────────
static Army buildEnemyArmy(int battleNum)
{
    Army enemy;
    if (battleNum == 1) {
        appendArmy<Soldier>    (enemy, 300, REDTEAM);
        appendArmy<Archer>     (enemy,  50, REDTEAM);
        appendArmy<Necromancer>(enemy,   5, REDTEAM);
    } else if (battleNum == 2) {
        appendArmy<Soldier>    (enemy, 500, REDTEAM);
        appendArmy<Archer>     (enemy, 150, REDTEAM);
        appendArmy<Necromancer>(enemy,  15, REDTEAM);
    } else {
        appendArmy<Soldier>    (enemy, 700, REDTEAM);
        appendArmy<Archer>     (enemy, 200, REDTEAM);
        appendArmy<Necromancer>(enemy,  25, REDTEAM);
    }
    return enemy;
}

// Read one integer from stdin while continuing to pump SFML events every 100ms.
// Prevents the window from being marked "not responding" during the buy screen.
static int readChoicePolling(sf::RenderWindow& window)
{
    std::cout << std::flush;
    int fd = fileno(stdin);
    while (window.isOpen()) {
        sf::Event event;
        while (window.pollEvent(event))
            if (event.type == sf::Event::Closed) { window.close(); return -1; }

        fd_set fds;
        FD_ZERO(&fds);
        FD_SET(fd, &fds);
        struct timeval tv = {0, 100000}; // 100ms
        if (select(fd + 1, &fds, nullptr, nullptr, &tv) > 0) {
            int choice;
            if (std::cin >> choice) return choice;
            std::cin.clear();
            std::cin.ignore(1000, '\n');
            return -1;
        }
    }
    return -1;
}

// ── Buy screen ─────────────────────────────────────────────────────────────────
static void runBuyScreen(PlayerRoster& roster, int& gold, int battleNum,
                         sf::RenderWindow& window)
{
    std::cout << "\n";
    std::cout << "============================================================\n";
    std::cout << "  HOLY ORDER — BEFORE BATTLE " << battleNum << " of " << NUM_BATTLES << "\n";
    std::cout << "============================================================\n";

    bool done = false;
    while (!done && window.isOpen()) {
        std::cout << "\nGold: " << gold << "g    Army: "
                  << roster.soldiers << " soldiers, "
                  << roster.archers  << " archers, "
                  << roster.mages    << " mages, "
                  << roster.priests  << " priests\n";

        std::cout << "  [1] Soldier squad (" << SOLDIER_SQUAD << " troops)  " << SOLDIER_COST << "g\n";
        std::cout << "  [2] Archer squad  (" << ARCHER_SQUAD  << " archers)  " << ARCHER_COST  << "g\n";
        std::cout << "  [3] Mage                              " << MAGE_COST   << "g\n";
        std::cout << "  [4] Priest                             " << PRIEST_COST << "g\n";
        std::cout << "  [0] Begin battle\n> ";

        int choice = readChoicePolling(window);
        if (choice == -1) return; // window closed

        switch (choice) {
            case 0:
                if (roster.totalTroops() == 0)
                    std::cout << "  Buy at least one unit before entering battle.\n";
                else
                    done = true;
                break;
            case 1:
                if (gold < SOLDIER_COST) { std::cout << "  Not enough gold.\n"; break; }
                roster.soldiers += SOLDIER_SQUAD;
                gold -= SOLDIER_COST;
                std::cout << "  Recruited " << SOLDIER_SQUAD << " soldiers.\n";
                break;
            case 2:
                if (gold < ARCHER_COST) { std::cout << "  Not enough gold.\n"; break; }
                roster.archers += ARCHER_SQUAD;
                gold -= ARCHER_COST;
                std::cout << "  Recruited " << ARCHER_SQUAD << " archers.\n";
                break;
            case 3:
                if (gold < MAGE_COST) { std::cout << "  Not enough gold.\n"; break; }
                roster.mages++;
                gold -= MAGE_COST;
                std::cout << "  Mage joined the order.\n";
                break;
            case 4:
                if (gold < PRIEST_COST) { std::cout << "  Not enough gold.\n"; break; }
                roster.priests++;
                gold -= PRIEST_COST;
                std::cout << "  Priest joined the order.\n";
                break;
            default:
                std::cout << "  Unknown option.\n";
                break;
        }
    }
}

// ── Terminal display helpers ───────────────────────────────────────────────────
static int getTerminalHeight() {
    struct winsize w;
    ioctl(STDOUT_FILENO, TIOCGWINSZ, &w);
    return w.ws_row;
}

static void clearBattlefieldArea(int startRow, int height) {
    for (int i = 0; i < height; ++i)
        std::cout << "\033[" << (startRow + i) << ";1H\033[2K";
}

// ── Battle loop — shared by campaign and sample battle ────────────────────────
static BattleResult runBattleLoop(Battlefield& field, sf::RenderWindow& window,
                                  const std::string& title)
{
    int  termHeight       = getTerminalHeight();
    int  battlefieldStart = termHeight - Battlefield::height;
    int  counter          = 0;
    bool paused           = false;
    bool ongoing          = true;

    std::cout << "\n=== " << title << " — SPACE to pause ===\n";

    while (ongoing && window.isOpen()) {
        sf::Event event;
        while (window.pollEvent(event)) {
            if (event.type == sf::Event::Closed) {
                window.close();
                return field.extractResult();
            }
            if (event.type == sf::Event::KeyPressed
                    && event.key.code == sf::Keyboard::Space) {
                paused = !paused;
                std::cout << (paused ? "  [PAUSED]\n" : "  [RESUMED]\n");
            }
            field.hexGrid.handleEvent(event);
        }

        if (paused) {
            field.print();
            std::this_thread::sleep_for(std::chrono::milliseconds(PAUSED_SLEEP_MS));
            continue;
        }

        clearBattlefieldArea(battlefieldStart, Battlefield::height);
        std::cout << "\033[" << battlefieldStart << ";1H";

        ongoing = field.tick();
        counter++;
        std::cout << "Turn " << counter << "\n";
        field.print();
        std::this_thread::sleep_for(std::chrono::milliseconds(TICK_SLEEP_MS));
    }

    return field.extractResult();
}

static BattleResult runBattle(Battlefield& field, Army playerArmy, Army enemy,
                              sf::RenderWindow& window, int battleNum)
{
    field.reset();
    randomPlaceArmy(enemy,      field, {field.width * 3/4, field.width - 1, 0, field.height - 1});
    randomPlaceArmy(playerArmy, field, {0, field.width / 4,                 0, field.height - 1});
    field.loadArmies(std::move(enemy), std::move(playerArmy));
    return runBattleLoop(field, window, "BATTLE " + std::to_string(battleNum));
}

// ── Campaign entry point ───────────────────────────────────────────────────────
void runCampaign(Battlefield& field, sf::RenderWindow& window)
{
    int          gold = STARTING_GOLD;
    PlayerRoster roster;

    for (int battleNum = 1; battleNum <= NUM_BATTLES; ++battleNum) {
        runBuyScreen(roster, gold, battleNum, window);

        BattleResult result = runBattle(field,
                                        buildPlayerArmy(roster),
                                        buildEnemyArmy(battleNum),
                                        window, battleNum);

        if (result.winner == BLUETEAM) {
            roster = countSurvivors(result.blueSurvivors);
            std::cout << "\nVictory! Survivors: "
                      << roster.soldiers << " soldiers, "
                      << roster.archers  << " archers, "
                      << roster.mages    << " mages, "
                      << roster.priests  << " priests\n";

            if (battleNum < NUM_BATTLES) {
                int reward = BATTLE_REWARD[battleNum - 1];
                gold += reward;
                std::cout << "Reward: +" << reward << "g  (treasury: " << gold << "g)\n";
            }
        } else if (result.winner == REDTEAM) {
            std::cout << "\nDefeat. The holy order has fallen.\n";
            std::cout << "=== CAMPAIGN OVER ===\n";
            return;
        } else {
            std::cout << "\nBoth sides annihilated.\n";
            std::cout << "=== CAMPAIGN OVER ===\n";
            return;
        }
    }

    std::cout << "\n============================================================\n";
    std::cout << "  THE HOLY ORDER TRIUMPHS — THREE BATTLES, NONE LOST\n";
    std::cout << "  Survivors: "
              << roster.soldiers << " soldiers, "
              << roster.archers  << " archers, "
              << roster.mages    << " mages, "
              << roster.priests  << " priests\n";
    std::cout << "============================================================\n";
}

// ── Sample battle — dev shortcut, no buy screen ────────────────────────────────
void runSampleBattle(Battlefield& field, sf::RenderWindow& window)
{
    field.reset();
    setupSampleBattle(field);
    BattleResult result = runBattleLoop(field, window, "SAMPLE BATTLE");

    std::cout << "\nBattle ended. ";
    if      (result.winner == REDTEAM)  std::cout << "Red wins.\n";
    else if (result.winner == BLUETEAM) std::cout << "Blue wins.\n";
    else                                std::cout << "Draw.\n";
    std::cout << "Red survivors: "  << result.redSurvivors.size()
              << "  Blue survivors: " << result.blueSurvivors.size() << "\n";
}
