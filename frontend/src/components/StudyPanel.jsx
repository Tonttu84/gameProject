import React, { useState } from 'react'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'
import TutorialIntro from './TutorialIntro'

// THE STUDY — the research screen (docs/CAMPAIGN_PLAN.md, "SLICE 3").
//
// The four schools, what each has bought, and what each holds. Two things
// happen here and nothing else: the player reads the roster, and aims the
// army's study at one school.
//
// WHAT THIS FILE DOES NOT KNOW, and must not learn:
//   - what a school or a path is CALLED. Every label — the school's, the
//     path's — arrives phrased from the server (17-5), off SPELL_SCHOOL_TEXT
//     and SPELL_PATH_TEXT. This file joins atoms; it holds no vocabulary.
//   - what a spell DOES. `description` is authored in the engine beside the
//     constants it quotes, so a retuned number moves the sentence with it.
//   - the cost curve. `nextCost` is computed server-side by magic.js
//     nextLevelCost(), the one place 30 × n lives.
//
// UNLOCKED IS THE SCHOOL GATE ALONE (S3-6). M-6 splits the two gates: the ARMY
// researches the school, the individual CASTER meets the path level. So a row
// states its requirement and stops — it does not go looking for somebody who
// could cast it. Whether you have a Fire 3 mage is the character sheet's
// business, which is the screen that owns people.
//
// The granted paths are not here at all (S3-2): Holy and Unholy are had, not
// earned (M-14), and the server drops them before this file sees them. They
// belong to slice 4's scripting, where a Priest's repertoire is the point.

// One spell. Collapsed it is a NAME and its gates; the description opens on
// click (S3-4) — "a name is enough for the menu" (user).
//
// `requires` is ORDERED, primary first (M-20), and each entry arrives as a
// phrased {label, level} pair. Joining them with · is the same thing the
// character sheet does with a caster's paths.
const SpellRow = ({ spell, schoolLabel }) => {
  const [open, setOpen] = useState(false)
  const requirement = spell.requires.map((r) => `${r.label} ${r.level}`).join(' · ')

  return (
    <li
      className={`study-spell ${spell.unlocked ? 'unlocked' : 'locked'}`}
      data-testid={`study-spell-${spell.spell}-${spell.form}`}
    >
      <button
        className="study-spell-head"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        data-testid={`study-spell-toggle-${spell.spell}-${spell.form}`}
      >
        <span className="study-spell-mark" aria-hidden="true">
          {spell.unlocked ? '✓' : '✗'}
        </span>
        <span className="study-spell-name">{spell.label}</span>
        <span className="study-spell-req">{requirement}</span>
        {/* The school gate is worth stating only where it is what BLOCKS the
            spell — on an unlocked row it is a number the player has already
            paid and would just be noise beside the path requirement. */}
        {!spell.unlocked && (
          <span className="study-spell-gate" data-testid={`study-spell-gate-${spell.spell}-${spell.form}`}>
            {schoolLabel} {spell.schoolLevel}
          </span>
        )}
      </button>
      {open && (
        <div className="study-spell-detail" data-testid={`study-spell-detail-${spell.spell}-${spell.form}`}>
          <p className="study-spell-desc">{spell.description}</p>
          {/* TG-1 (T-1/T-2) added two facts about DELIVERY to this line, both
              the server's and neither re-derived here: how far the form reaches,
              and whether it just lands. A precise row says so; an imprecise one
              names its modifier only when it HAS one, because "Accuracy +0" is
              a number that tells the player nothing. TG-2 (T-6) adds the AREA on
              the same terms — named only where there is one, since "Area 0" says
              nothing either. */}
          <p className="study-spell-numbers">
            Fatigue {spell.fatigue} · {spell.castingTime} tick
            {spell.castingTime === 1 ? '' : 's'} to cast · Range {spell.range}
            {spell.precise
              ? ' · Precise'
              : spell.accuracy
                ? ` · Accuracy ${spell.accuracy > 0 ? '+' : '−'}${Math.abs(spell.accuracy)}`
                : ''}
            {spell.area > 0 ? ` · Area ${spell.area} (${spell.areaMode})` : ''}
          </p>
          {/* A BATTLEFIELD ENCHANTMENT (slice A, E-2/E-3) is priced in the
              ARMY's pool as well as in the caster's fatigue, and never fires
              off the default walk. That is one sentence, written server-side
              off the row's own poolCost (17-5) and printed here verbatim —
              this file knows no prices, as it knows no path names. */}
          {spell.poolCost > 0 && (
            <p className="study-spell-numbers" data-testid={`study-spell-pool-${spell.spell}-${spell.form}`}>
              {spell.poolLine}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

// One school: what it has reached, what this turn's study would buy, and its
// spells. Construction is rendered by this same body holding nothing (S3-5) —
// an empty school is the honest shape of the system, not a special case.
const SchoolBlock = ({ school, data, focused, onFocus, locked, door }) => {
  const { label, level, points, nextCost, spells } = data
  // At the ceiling there is no next level to price, so the server sends null
  // rather than a cost for something that cannot be bought.
  const pct = nextCost ? Math.min(100, Math.round((points / nextCost) * 100)) : 100

  return (
    <section
      className={`study-school ${focused ? 'focused' : ''}`}
      data-testid={`study-school-${school}`}
    >
      <header className="study-school-head">
        <h3>{label}</h3>
        <span className="study-school-level" data-testid={`study-level-${school}`}>
          Level {level}
        </span>
      </header>

      <div className="study-progress" data-testid={`study-progress-${school}`}>
        <div className="study-bar"><div className="study-bar-fill" style={{ width: `${pct}%` }} /></div>
        <span className="study-progress-text">
          {nextCost === null ? 'Mastered' : `${points} / ${nextCost}`}
        </span>
      </div>

      {focused ? (
        <p className="study-focused-note" data-testid={`study-focused-${school}`}>
          Your mages are studying here.
        </p>
      ) : (
        <button
          className="btn-primary study-focus"
          disabled={locked}
          onClick={() => onFocus(school)}
          data-testid={`study-focus-${school}`}
        >
          Direct study here
        </button>
      )}

      {door}

      {spells.length === 0 ? (
        <p className="study-empty" data-testid={`study-empty-${school}`}>
          No workings are known in this school.
        </p>
      ) : (
        <ul className="study-spells">
          {spells.map((spell) => (
            <SpellRow
              key={`${spell.spell}-${spell.form}`}
              spell={spell}
              schoolLabel={label}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

// `onFocus` is a guarded action, like every other mutation reached from a
// takeover screen. `locked` means the turn has marched past Prepare: the focus
// is a CAMP decision (S2-12), so past the phase this is a record of where study
// is aimed rather than a control — and the server refuses it either way
// (routes' rejectIfPhasePassed), which is what the disabled button reflects
// rather than duplicates.
const StudyPanel = ({ onFocus, locked }) => {
  const research = useCampaignStore((s) => s.campaign.research)
  const closeStudy = useUiStore((s) => s.closeStudy)
  const openForge = useUiStore((s) => s.openForge)
  const tutorial = useUiStore((s) => s.tutorial)

  const schools = research?.schools ?? {}

  return (
    <div className="study-page" data-testid="study-page">
      <div className="study-head">
        <h2>The Study</h2>
        <button className="login-toggle" data-testid="study-back" onClick={closeStudy}>
          Back
        </button>
      </div>

      <TutorialIntro
        id="study"
        enabled={tutorial}
        title="The study"
        lines={[
          'Your mages study together, and what they learn belongs to the whole army — not to the man who learned it.',
          'Direct them at one school. The choice is which school, not how much: every mage contributes the same whether he is in camp or away on a mission.',
          'Progress banks per school, so changing your mind costs nothing — what is part-learned waits where you left it.',
          'A school opens a working to the army; a caster still needs the paths it asks of him.',
        ]}
      />

      <p className="study-rate" data-testid="study-rate">
        Your mages add <strong>{research?.rate ?? 0}</strong> to their study each turn
        {research?.allies > 0 && ` (${research.allies} lent to you)`}.
      </p>

      {locked && (
        <p className="study-locked" data-testid="study-locked">
          The camp is behind you — where study is aimed is settled until next turn.
        </p>
      )}

      <div className="study-schools">
        {Object.entries(schools).map(([school, data]) => (
          <SchoolBlock
            key={school}
            school={school}
            data={data}
            focused={research?.focus === school}
            onFocus={onFocus}
            locked={locked}
            // Construction's content is not spells (C-6): its school block is
            // the ITEM-FIRST door into the forge, which is a takeover of its
            // own like this one. Rendered as part of the block so the fourth
            // school stops being the empty one (S3-5) the day it has works.
            door={school === 'construction' ? (
              <button
                className="btn-primary study-forge-door"
                data-testid="study-forge-door"
                onClick={() => openForge({})}
              >
                The Forge
              </button>
            ) : null}
          />
        ))}
      </div>
    </div>
  )
}

export default StudyPanel
