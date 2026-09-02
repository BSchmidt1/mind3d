import { parseProposal, type ProposalOpSet } from './core/proposal';

// Renderer-side glue for the generalized one-shot IPC (`claude-oneshot`):
// spawn `claude -p <prompt>` in `cwd` and parse its reply into a ProposalOpSet.
export async function askClaudeForOps(prompt: string, cwd: string): Promise<ProposalOpSet> {
  return parseProposal(await window.mind3d.askClaude(prompt, cwd));
}
