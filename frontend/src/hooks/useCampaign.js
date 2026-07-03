import { useState, useEffect, useCallback } from 'react'
import {
  getCampaigns,
  createCampaign,
  pickCampaignEvent,
  setCampaignForage,
  postCampaignBattle,
  endCampaignDay,
} from '../services/api'

// Server-side campaign state, exposed as the view object plus the actions
// that advance it. Every action swaps in the refreshed view the server
// returns — the server is the only authority on campaign state.
export default function useCampaign(user) {
  const [campaign, setCampaign] = useState(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await getCampaigns()
      setCampaign(list.find((c) => c.status === 'active') ?? list[0] ?? null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) {
      setCampaign(null)
      return
    }
    reload().catch(() => setCampaign(null))
  }, [user, reload])

  const create = async () => {
    const created = await createCampaign()
    setCampaign(created)
    return created
  }

  const pickEvent = async (eventId) => {
    setCampaign(await pickCampaignEvent(campaign.id, eventId))
  }

  const assignForagers = async (assignment) => {
    setCampaign(await setCampaignForage(campaign.id, assignment))
  }

  const fight = async (playerPlacement) => {
    const res = await postCampaignBattle(campaign.id, { player_placement: playerPlacement })
    setCampaign(res.campaign)
    return res
  }

  const endDay = async () => {
    const res = await endCampaignDay(campaign.id)
    setCampaign(res.campaign)
    return res.report
  }

  return { campaign, loading, create, pickEvent, assignForagers, fight, endDay, reload }
}
