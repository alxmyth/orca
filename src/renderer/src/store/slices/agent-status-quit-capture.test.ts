import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { AppState } from '../types'
import { createTestStore, makeTab } from './store-test-helpers'

function makeAgentEntry(overrides: {
  paneKey: string
  worktreeId: string
  sessionId?: string
}): AgentStatusEntry {
  return {
    state: 'working',
    prompt: 'finish the task',
    updatedAt: 1,
    stateStartedAt: 1,
    stateHistory: [],
    agentType: 'claude',
    paneKey: overrides.paneKey,
    worktreeId: overrides.worktreeId,
    ...(overrides.sessionId
      ? { providerSession: { key: 'session_id' as const, id: overrides.sessionId } }
      : {})
  }
}

describe('captureAllSleepingAgentSessions', () => {
  it('checkpoints a live resumable provider session before quit-time capture', () => {
    const store = createTestStore()
    store.setState({
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })]
      }
    } as Partial<AppState>)

    store.getState().setAgentStatus(
      'tab-1:leaf-1',
      {
        state: 'working',
        prompt: 'finish the task',
        agentType: 'codex'
      },
      'Codex',
      { updatedAt: 10, stateStartedAt: 10 },
      { tabId: 'tab-1', worktreeId: 'wt-1' },
      { providerSession: { key: 'session_id', id: 'codex-session-1' } }
    )

    // Why: Windows update/reboot exits can miss beforeunload; the provider
    // session handle must already be durable for pane-level cold restore.
    expect(store.getState().sleepingAgentSessionsByPaneKey['tab-1:leaf-1']).toMatchObject({
      agent: 'codex',
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      providerSession: { key: 'session_id', id: 'codex-session-1' },
      origin: 'live'
    })
  })

  it('does not rewrite the live checkpoint for same-session status ticks', () => {
    const store = createTestStore()
    store.setState({
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })]
      }
    } as Partial<AppState>)

    store.getState().setAgentStatus(
      'tab-1:leaf-1',
      {
        state: 'working',
        prompt: 'first prompt',
        agentType: 'codex'
      },
      'Codex',
      { updatedAt: 10, stateStartedAt: 10 },
      { tabId: 'tab-1', worktreeId: 'wt-1' },
      { providerSession: { key: 'session_id', id: 'codex-session-1' } }
    )
    const firstRecord = store.getState().sleepingAgentSessionsByPaneKey['tab-1:leaf-1']

    store.getState().setAgentStatus(
      'tab-1:leaf-1',
      {
        state: 'working',
        prompt: 'second prompt',
        agentType: 'codex'
      },
      'Codex',
      { updatedAt: 20, stateStartedAt: 10 },
      { tabId: 'tab-1', worktreeId: 'wt-1' },
      { providerSession: { key: 'session_id', id: 'codex-session-1' } }
    )

    expect(store.getState().sleepingAgentSessionsByPaneKey['tab-1:leaf-1']).toBe(firstRecord)
  })

  it('retains the live checkpoint when a resumable agent finishes (idle is resumable)', () => {
    const store = createTestStore()
    store.setState({
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })]
      }
    } as Partial<AppState>)

    store.getState().setAgentStatus(
      'tab-1:leaf-1',
      {
        state: 'working',
        prompt: 'finish the task',
        agentType: 'codex'
      },
      'Codex',
      { updatedAt: 10, stateStartedAt: 10 },
      { tabId: 'tab-1', worktreeId: 'wt-1' },
      { providerSession: { key: 'session_id', id: 'codex-session-1' } }
    )
    store.getState().setAgentStatus(
      'tab-1:leaf-1',
      {
        state: 'done',
        prompt: 'finish the task',
        agentType: 'codex'
      },
      'Codex',
      { updatedAt: 20, stateStartedAt: 10 },
      { tabId: 'tab-1', worktreeId: 'wt-1' },
      { providerSession: { key: 'session_id', id: 'codex-session-1' } }
    )

    // Why: a finished agent's provider session is still resumable, so the
    // record must survive going idle (otherwise a cold restart bare-shells it).
    expect(store.getState().sleepingAgentSessionsByPaneKey['tab-1:leaf-1']).toMatchObject({
      agent: 'codex',
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      providerSession: { key: 'session_id', id: 'codex-session-1' }
    })
  })

  it('does not churn the retained record reference on a working->done transition', () => {
    const store = createTestStore()
    store.setState({
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })]
      }
    } as Partial<AppState>)

    const tick = (state: 'working' | 'done', updatedAt: number): void => {
      store
        .getState()
        .setAgentStatus(
          'tab-1:leaf-1',
          { state, prompt: 'do the task', agentType: 'codex' },
          'Codex',
          { updatedAt, stateStartedAt: 10 },
          { tabId: 'tab-1', worktreeId: 'wt-1' },
          { providerSession: { key: 'session_id', id: 'codex-session-1' } }
        )
    }

    tick('working', 10)
    const before = store.getState().sleepingAgentSessionsByPaneKey['tab-1:leaf-1']
    tick('done', 20)
    const after = store.getState().sleepingAgentSessionsByPaneKey['tab-1:leaf-1']

    // recoveryRecordMatches ignores `state`, so going idle keeps the same record
    // reference rather than re-writing (and re-persisting) it every status ping.
    expect(after).toBe(before)
  })

  it('captures resumable agents across every worktree, not just one', () => {
    const store = createTestStore()
    store.setState({
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })],
        'wt-2': [makeTab({ id: 'tab-2', worktreeId: 'wt-2' })]
      },
      agentStatusByPaneKey: {
        'tab-1:leaf-1': makeAgentEntry({
          paneKey: 'tab-1:leaf-1',
          worktreeId: 'wt-1',
          sessionId: 'sess-1'
        }),
        'tab-2:leaf-2': makeAgentEntry({
          paneKey: 'tab-2:leaf-2',
          worktreeId: 'wt-2',
          sessionId: 'sess-2'
        })
      }
    } as Partial<AppState>)

    store.getState().captureAllSleepingAgentSessions()

    const records = store.getState().sleepingAgentSessionsByPaneKey
    expect(records['tab-1:leaf-1']).toMatchObject({
      agent: 'claude',
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      providerSession: { key: 'session_id', id: 'sess-1' },
      origin: 'quit'
    })
    expect(records['tab-2:leaf-2']).toMatchObject({
      agent: 'claude',
      worktreeId: 'wt-2',
      tabId: 'tab-2',
      providerSession: { key: 'session_id', id: 'sess-2' },
      origin: 'quit'
    })
  })

  it('captures a done resumable agent at quit (a finished session is still resumable)', () => {
    const store = createTestStore()
    const entry = makeAgentEntry({
      paneKey: 'tab-1:leaf-1',
      worktreeId: 'wt-1',
      sessionId: 'sess-1'
    })
    entry.state = 'done'
    store.setState({
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })]
      },
      agentStatusByPaneKey: { 'tab-1:leaf-1': entry }
    } as Partial<AppState>)

    store.getState().captureAllSleepingAgentSessions()

    expect(store.getState().sleepingAgentSessionsByPaneKey['tab-1:leaf-1']).toMatchObject({
      worktreeId: 'wt-1',
      providerSession: { key: 'session_id', id: 'sess-1' },
      origin: 'quit'
    })
  })

  it('does not capture a done pane without a providerSession', () => {
    const store = createTestStore()
    const entry = makeAgentEntry({ paneKey: 'tab-1:leaf-1', worktreeId: 'wt-1' })
    entry.state = 'done'
    store.setState({
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })]
      },
      agentStatusByPaneKey: { 'tab-1:leaf-1': entry }
    } as Partial<AppState>)

    store.getState().captureAllSleepingAgentSessions()

    // Safety basis for capturing done agents: no provider session => nothing to
    // resume => no record, so the pane is never resurrected as a bare shell.
    expect(store.getState().sleepingAgentSessionsByPaneKey).toEqual({})
  })

  it('does not capture a done pane whose agentType is not resumable', () => {
    const store = createTestStore()
    const entry = makeAgentEntry({
      paneKey: 'tab-1:leaf-1',
      worktreeId: 'wt-1',
      sessionId: 'sess-1'
    })
    entry.state = 'done'
    entry.agentType = 'amp'
    store.setState({
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })]
      },
      agentStatusByPaneKey: { 'tab-1:leaf-1': entry }
    } as Partial<AppState>)

    store.getState().captureAllSleepingAgentSessions()

    expect(store.getState().sleepingAgentSessionsByPaneKey).toEqual({})
  })

  it('captures every idle (done) resumable pane across worktrees', () => {
    const store = createTestStore()
    const e1 = makeAgentEntry({ paneKey: 'tab-1:leaf-1', worktreeId: 'wt-1', sessionId: 'sess-1' })
    const e2 = makeAgentEntry({ paneKey: 'tab-2:leaf-2', worktreeId: 'wt-2', sessionId: 'sess-2' })
    e1.state = 'done'
    e2.state = 'done'
    store.setState({
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })],
        'wt-2': [makeTab({ id: 'tab-2', worktreeId: 'wt-2' })]
      },
      agentStatusByPaneKey: { 'tab-1:leaf-1': e1, 'tab-2:leaf-2': e2 }
    } as Partial<AppState>)

    store.getState().captureAllSleepingAgentSessions()

    const records = store.getState().sleepingAgentSessionsByPaneKey
    expect(records['tab-1:leaf-1']).toMatchObject({
      origin: 'quit',
      providerSession: { key: 'session_id', id: 'sess-1' }
    })
    expect(records['tab-2:leaf-2']).toMatchObject({
      origin: 'quit',
      providerSession: { key: 'session_id', id: 'sess-2' }
    })
  })

  it('skips agents without a resumable provider session', () => {
    const store = createTestStore()
    store.setState({
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })]
      },
      agentStatusByPaneKey: {
        'tab-1:leaf-1': makeAgentEntry({ paneKey: 'tab-1:leaf-1', worktreeId: 'wt-1' })
      }
    } as Partial<AppState>)

    store.getState().captureAllSleepingAgentSessions()

    expect(store.getState().sleepingAgentSessionsByPaneKey).toEqual({})
  })

  it('captures entries attributed only via tab prefix when the entry has no worktreeId', () => {
    const store = createTestStore()
    const entry = makeAgentEntry({
      paneKey: 'tab-1:leaf-1',
      worktreeId: 'wt-1',
      sessionId: 'sess-1'
    })
    delete entry.worktreeId
    store.setState({
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })]
      },
      agentStatusByPaneKey: { 'tab-1:leaf-1': entry }
    } as Partial<AppState>)

    store.getState().captureAllSleepingAgentSessions()

    expect(store.getState().sleepingAgentSessionsByPaneKey['tab-1:leaf-1']).toMatchObject({
      worktreeId: 'wt-1',
      providerSession: { key: 'session_id', id: 'sess-1' }
    })
  })
})
