import { parseProposal, planProposal, type ProposalNodeOp, type ProposalEdgeOp, type ProposalOp, type ProposalOpSet } from './proposal';
import type { Command } from './commands';

// Thin delegating wrappers over core/proposal.ts (the generalized engine
// shared by Ask/Import/Voice — see docs/superpowers/plans, Task F3a). Kept so
// every prior export name/signature (and tests/voiceOps.test.ts) stays green.
export type VoiceNodeOp = ProposalNodeOp;
export type VoiceEdgeOp = ProposalEdgeOp;
export type VoiceOp = ProposalOp;
export type VoiceResult = ProposalOpSet;

export interface VoicePlan {
  command: Command;
  newNodeIds: string[];
  rootId: string | null;
}

export function parseVoiceResult(text: string): VoiceResult {
  return parseProposal(text);
}

export function planFromVoiceResult(
  result: VoiceResult,
  existingNodeIds: Set<string>
): VoicePlan {
  const p = planProposal(result, existingNodeIds, () => '');
  return { command: p.command, newNodeIds: p.newNodeIds, rootId: p.rootId };
}
