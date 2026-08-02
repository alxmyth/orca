import type { ResumableTuiAgent } from './agent-session-resume'
import { TUI_AGENT_CONFIG } from './tui-agent-config'
import { resolveAgentLaunchCommand } from './tui-agent-launch-command'
import type { AgentStartupShell } from './tui-agent-startup-shell'
import type { TuiAgent } from './types'

/** Why: a resume replays only the command; session-option metadata is not re-derived. */
export type AgentResumeBaseCommand = { ok: true; command: string } | { ok: false; error: string }

export type AgentResumeLaunchTarget = {
  baseCommand: AgentResumeBaseCommand
  expectedProcess: string
}

/**
 * Picks the binary a resume actually relaunches, plus the process name to expect.
 *
 * A Claude Agent Teams leader is a real `claude` process, so the record's `agent` alone
 * would resume it as plain `claude --resume` and lose the team. A record carrying the
 * teams marker is instead rebuilt through the `orca claude-teams` wrapper.
 */
export function resolveAgentResumeLaunchTarget(args: {
  agent: ResumableTuiAgent
  launchKind?: 'claude-agent-teams'
  agentCommand?: string | null
  cmdOverrides: Partial<Record<TuiAgent, string>>
  platform: NodeJS.Platform
  shell: AgentStartupShell
  agentArgs?: string | null
  isRemote?: boolean
}): AgentResumeLaunchTarget {
  // Why: win32 ships no `orca claude-teams` wrapper, so it falls back to plain claude.
  const useTeamsWrapper =
    args.launchKind === 'claude-agent-teams' && args.agent === 'claude' && args.platform !== 'win32'
  if (useTeamsWrapper) {
    return {
      // Why: resolved under the teams key so a `claude` override can't leak into the wrapper.
      baseCommand: resolveAgentLaunchCommand({
        agent: 'claude-agent-teams',
        cmdOverrides: args.cmdOverrides,
        platform: args.platform,
        shell: args.shell,
        agentArgs: args.agentArgs,
        isRemote: args.isRemote
      }),
      expectedProcess: TUI_AGENT_CONFIG['claude-agent-teams'].expectedProcess
    }
  }
  const capturedCommand = args.agentCommand?.trim()
  return {
    baseCommand: capturedCommand
      ? ({ ok: true, command: capturedCommand } as const)
      : resolveAgentLaunchCommand({
          agent: args.agent,
          cmdOverrides: args.cmdOverrides,
          platform: args.platform,
          shell: args.shell,
          agentArgs: args.agentArgs,
          isRemote: args.isRemote
        }),
    expectedProcess: TUI_AGENT_CONFIG[args.agent].expectedProcess
  }
}
