import {
  getAgentResumeArgv,
  type AgentProviderSessionMetadata,
  type ResumableTuiAgent
} from './agent-session-resume'
import type { SessionOptionValue } from './native-chat-session-options'
import { buildSleepingAgentLaunchConfig } from './sleeping-agent-launch-config'
import {
  resolveAgentLaunchCommand,
  type ResolvedAgentLaunchCommand
} from './tui-agent-launch-command'
import type { AgentStartupPlan } from './tui-agent-startup'
import { resolveStartupShell, type AgentStartupShell } from './tui-agent-startup-shell'
import { TUI_AGENT_CONFIG, type TuiAgentDetectionRuntime } from './tui-agent-config'
import type { TuiAgent } from './tui-agent'
import { buildAgentResumeLaunchCommand } from './agent-resume-launch-command'

// Why: an Agent Teams leader is a real `claude` process, so the record's agent
// is 'claude' and a plain resume would drop the team. Resolving under the teams
// agent key also keeps a user's `claude` command override out of the wrapper.
function resolveTeamsResumeBaseCommand(args: {
  launchKind?: 'claude-agent-teams'
  agent: ResumableTuiAgent
  cmdOverrides: Partial<Record<TuiAgent, string>>
  platform: NodeJS.Platform
  shell: AgentStartupShell
  agentArgs?: string | null
  sessionOptions?: Record<string, SessionOptionValue>
  sessionOptionsOverrideAgentArgs?: boolean
  isRemote?: boolean
  isWsl?: boolean
}): ResolvedAgentLaunchCommand | null {
  if (args.launchKind !== 'claude-agent-teams' || args.agent !== 'claude') {
    return null
  }
  const runtime: TuiAgentDetectionRuntime = args.isWsl ? 'wsl' : args.platform
  // Why: Windows and WSL use Claude's in-process teams fallback rather than this
  // wrapper, so resuming through it there would launch an unsupported mode.
  if (TUI_AGENT_CONFIG['claude-agent-teams'].detectUnsupportedRuntimes?.includes(runtime)) {
    return null
  }
  const resolved = resolveAgentLaunchCommand({
    agent: 'claude-agent-teams',
    cmdOverrides: args.cmdOverrides,
    platform: args.platform,
    shell: args.shell,
    agentArgs: args.agentArgs,
    sessionOptions: args.sessionOptions,
    sessionOptionsOverrideAgentArgs: args.sessionOptionsOverrideAgentArgs,
    isRemote: args.isRemote
  })
  // Why: a wrapper that cannot be resolved degrades to a plain claude resume
  // rather than failing the restore outright.
  return resolved.ok ? resolved : null
}

export function buildAgentResumeStartupPlan(args: {
  agent: ResumableTuiAgent
  providerSession: AgentProviderSessionMetadata
  cmdOverrides: Partial<Record<TuiAgent, string>>
  platform: NodeJS.Platform
  shell?: AgentStartupShell
  agentArgs?: string | null
  agentEnv?: Record<string, string> | null
  agentCommand?: string | null
  ompResumeFilePath?: string | null
  sessionOptions?: Record<string, SessionOptionValue>
  sessionOptionsOverrideAgentArgs?: boolean
  isRemote?: boolean
  /** WSL collapses to `platform: 'linux'`, so teams support needs its own signal. */
  isWsl?: boolean
  launchKind?: 'claude-agent-teams'
}): AgentStartupPlan | null {
  const argv = getAgentResumeArgv(args.agent, args.providerSession, args.ompResumeFilePath)
  if (!argv) {
    return null
  }
  const shell = resolveStartupShell(args.platform, args.shell)
  const resolvedAgentCommand = args.agentCommand?.trim()
  // Why: the teams wrapper must outrank a captured command. After one cold
  // restore the pane re-registers a plain `claude` agentCommand under an
  // identity that now matches its status row, so a captured-command-first
  // order would silently drop the team from the second restart onward.
  const baseCommand =
    resolveTeamsResumeBaseCommand({ ...args, shell }) ??
    (resolvedAgentCommand
      ? ({
          ok: true,
          command: resolvedAgentCommand,
          commandWithoutSessionOptions: resolvedAgentCommand,
          appliedSessionOptions: {}
        } as const)
      : resolveAgentLaunchCommand({
          agent: args.agent,
          cmdOverrides: args.cmdOverrides,
          platform: args.platform,
          shell,
          agentArgs: args.agentArgs,
          sessionOptions: args.sessionOptions,
          sessionOptionsOverrideAgentArgs: args.sessionOptionsOverrideAgentArgs,
          isRemote: args.isRemote
        }))
  if (!baseCommand.ok) {
    return null
  }
  const launchConfig = buildSleepingAgentLaunchConfig({
    ...args,
    agentCommand: baseCommand.commandWithoutSessionOptions
  })
  const launchCommand = buildAgentResumeLaunchCommand(args.agent, baseCommand.command, argv, shell)
  const applied = baseCommand.appliedSessionOptions
  return {
    agent: args.agent,
    launchCommand,
    expectedProcess: TUI_AGENT_CONFIG[args.agent].expectedProcess,
    followupPrompt: null,
    launchConfig,
    ...(args.agent === 'codex' ? { startupCommandDelivery: 'shell-ready' as const } : {}),
    ...(Object.keys(applied).length > 0 ? { sessionOptions: { ...applied } } : {}),
    ...(args.agentEnv ? { env: { ...args.agentEnv } } : {})
  }
}
