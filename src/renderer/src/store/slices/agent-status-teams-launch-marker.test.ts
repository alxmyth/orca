import { describe, expect, it } from 'vitest'
import type { AppState } from '../types'
import { createTestStore, makeTab } from './store-test-helpers'

const TEAMS_SESSION_ID = '11111111-2222-4333-8444-555555555555'
const SOLO_SESSION_ID = '66666666-7777-4888-8999-000000000000'

function seedClaudePane(launchAgent: 'claude' | 'claude-agent-teams', sessionId: string) {
  const store = createTestStore()
  store.setState({
    tabsByWorktree: {
      'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1', launchAgent })]
    }
  } as Partial<AppState>)

  store
    .getState()
    .setAgentStatus(
      'tab-1:leaf-1',
      { state: 'working', prompt: 'lead the team', agentType: 'claude' },
      'Claude',
      { updatedAt: 10, stateStartedAt: 10 },
      { tabId: 'tab-1', worktreeId: 'wt-1' },
      { providerSession: { key: 'session_id', id: sessionId } }
    )
  return store
}

describe('Agent Teams launch marker capture', () => {
  it('carries the teams launch mode onto a captured claude record', () => {
    // Why: the Claude hook reports a teams leader as plain 'claude', and its
    // registered launch config is rejected for that same identity mismatch, so the
    // tab's launch identity is the only surviving evidence of the teams mode.
    const store = seedClaudePane('claude-agent-teams', TEAMS_SESSION_ID)

    expect(store.getState().sleepingAgentSessionsByPaneKey['tab-1:leaf-1']).toMatchObject({
      agent: 'claude',
      launchKind: 'claude-agent-teams'
    })
  })

  it('leaves a solo claude record without a launch mode marker', () => {
    const store = seedClaudePane('claude', SOLO_SESSION_ID)

    expect(
      store.getState().sleepingAgentSessionsByPaneKey['tab-1:leaf-1']?.launchKind
    ).toBeUndefined()
  })
})
