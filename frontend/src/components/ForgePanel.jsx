import React, { useState } from 'react'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'
import TutorialIntro from './TutorialIntro'

// THE FORGE — Construction slice C1 (docs/CAMPAIGN_PLAN.md "THE CONSTRUCTION
// INTERVIEW", C-1..C-8).
//
// TWO DOORS INTO ONE ACTION (the user's shape, 2026-08-25), one component with
// two modes rather than two screens — the ItemStorePanel precedent (17-4), and
// for the same reason: the wording and the empty state must not drift apart.
//   - ITEM-FIRST (forgeRequest = {}): every craftable row, locked ones shown
//     locked so the ladder reads as a ladder; pick the item, then the smith.
//   - SMITH-FIRST (forgeRequest = {smithId}): a mage's own door — only the
//     rows HIS paths qualify him for, and he is already selected. This door
//     exists so an unposted mage can be found at all.
//
// WHAT THIS FILE DOES NOT KNOW, and must not learn (17-5): what a path or an
// item's power is called — `pathsText`, `effect`, `where` and `binding` arrive
// phrased; and no rule of its own — `levelMet`/`mithrilMet`/`smiths` arrive
// pre-answered, and the server refuses anything stale. There is NO location or
// squad line here on purpose: forging is location-blind (C-1), and a squad
// display was deliberately deleted with the away rule.

// One craftable row. Collapsed it is a name and its three gates (C-6); open,
// the item's own sentences and the smith picker — the SpellRow shape.
const ForgeRow = ({ row, mithril, smith, locked, onForge }) => {
  const [open, setOpen] = useState(false)
  const smiths = smith ? row.smiths.filter((s) => s.id === smith.id) : row.smiths
  const forgeable = row.levelMet && row.mithrilMet && !row.held

  return (
    <li
      className={`forge-row ${forgeable ? 'unlocked' : 'locked'}`}
      data-testid={`forge-row-${row.id}`}
    >
      <button
        className="forge-row-head"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        data-testid={`forge-row-toggle-${row.id}`}
      >
        <span className="forge-row-name">{row.name}</span>
        <span className="forge-row-req" data-testid={`forge-row-req-${row.id}`}>
          {row.pathsText} · {row.mithril} mithril
        </span>
        {/* The school gate is stated only where it is what blocks the work —
            the Study's rule for a spell's row. */}
        {!row.levelMet && (
          <span className="forge-row-gate" data-testid={`forge-row-gate-${row.id}`}>
            Construction {row.level}
          </span>
        )}
      </button>
      {open && (
        <div className="forge-row-detail" data-testid={`forge-row-detail-${row.id}`}>
          <p className="forge-row-blurb">{row.blurb}</p>
          <p className="forge-row-effect">{row.effect}</p>
          <p className="forge-row-where">{row.where}</p>
          {/* The binding line ALWAYS shows here (C-2): an artificial heart
              says "it stays" before anyone spends a fortnight making it, not
              only at the moment of equipping it. */}
          <p className="forge-row-binding" data-testid={`forge-binding-${row.id}`}>{row.binding}</p>
          {row.held && <p data-testid={`forge-held-${row.id}`}>The army already holds this.</p>}
          {!row.mithrilMet && (
            <p className="forge-row-poor" data-testid={`forge-poor-${row.id}`}>
              Not enough mithril — {row.mithril} is needed, {mithril} is on hand.
            </p>
          )}
          {smiths.length === 0 ? (
            <p className="forge-no-smith" data-testid={`forge-no-smith-${row.id}`}>
              No living mage commands the paths this work asks for.
            </p>
          ) : (
            <ul className="forge-smiths">
              {smiths.map((s) => (
                <li key={s.id}>
                  <button
                    className="btn-primary forge-go"
                    disabled={locked || !forgeable || s.forgedToday}
                    onClick={() => onForge(s.id, row.id)}
                    data-testid={`forge-go-${row.id}-${s.id}`}
                  >
                    {s.forgedToday
                      ? `${s.name} has already forged this turn`
                      : `Set ${s.name} to the work`}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

// `onForge` is a guarded action like The Study's onFocus; `locked` means the
// turn has marched past Prepare — the buttons reflect the server's refusal
// rather than duplicating it.
const ForgePanel = ({ onForge, locked }) => {
  const forge = useCampaignStore((s) => s.campaign.forge)
  const mithril = useCampaignStore((s) => s.campaign.resources?.mithril ?? 0)
  const characters = useCampaignStore((s) => s.campaign.characters)
  const forgeRequest = useUiStore((s) => s.forgeRequest)
  const closeForge = useUiStore((s) => s.closeForge)
  const tutorial = useUiStore((s) => s.tutorial)

  // The smith-first door: resolve the carried id against the live roster
  // (the id is carried, never a copy — the useUiStore convention), and fall
  // back to the item-first view if he has died since the door was opened.
  const smith = forgeRequest?.smithId != null
    ? (characters ?? []).find((c) => c.id === forgeRequest.smithId && c.alive) ?? null
    : null

  const rows = smith
    ? (forge?.rows ?? []).filter((row) => row.smiths.some((s) => s.id === smith.id))
    : (forge?.rows ?? [])

  return (
    <div className="forge-page" data-testid="forge-page">
      <div className="forge-head">
        <h2>{smith ? `The Forge — ${smith.name}` : 'The Forge'}</h2>
        <button className="login-toggle" data-testid="forge-back" onClick={closeForge}>
          Back
        </button>
      </div>

      <TutorialIntro
        id="forge"
        enabled={tutorial}
        title="The forge"
        lines={[
          'A mage may spend his fortnight at the forge instead of at his studies — the work costs his research, and the metal.',
          'Each working names its paths: the mage doing it must command them himself. Learning is shared; the craft is not.',
          'The work takes the fortnight and the item is ready at once, in the stores with everything else the army holds.',
          'Some things, once given, are part of the bearer. The work says so before you begin it.',
        ]}
      />

      <p className="forge-stock" data-testid="forge-stock">
        Construction <strong>{forge?.level ?? 0}</strong> · Mithril{' '}
        <strong>{mithril}</strong> on hand
      </p>

      {locked && (
        <p className="forge-locked" data-testid="forge-locked">
          The camp is behind you — the forge is cold until next turn.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="forge-empty" data-testid="forge-empty">
          {smith
            ? `${smith.name} commands no paths the known workings ask for.`
            : 'No workings are known to the forge.'}
        </p>
      ) : (
        <ul className="forge-rows">
          {rows.map((row) => (
            <ForgeRow
              key={row.id}
              row={row}
              mithril={mithril}
              smith={smith}
              locked={locked}
              onForge={onForge}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

export default ForgePanel
