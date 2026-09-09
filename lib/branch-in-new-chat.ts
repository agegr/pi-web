type ForkBranchCommand = {
  type: "fork_branch";
  entryId: string;
};

type SendBranchCommand = <T>(sourceSessionId: string, command: ForkBranchCommand) => Promise<T>;

export async function createForkedBranchSession(
  sendCommand: SendBranchCommand,
  sourceSessionId: string,
  sourceEntryId: string,
  failureMessage: string,
): Promise<string> {
  const result = await sendCommand<{ newSessionId?: string }>(sourceSessionId, {
    type: "fork_branch",
    entryId: sourceEntryId,
  });
  if (!result?.newSessionId) throw new Error(failureMessage);
  return result.newSessionId;
}

export async function branchInNewChat({
  sendCommand,
  sourceSessionId,
  sourceEntryId,
  failureMessage,
  initialPrompt,
  setPendingPrompt,
  onSessionForked,
}: {
  sendCommand: SendBranchCommand;
  sourceSessionId: string;
  sourceEntryId: string;
  failureMessage: string;
  initialPrompt?: string;
  setPendingPrompt?: (prompt: { sessionId: string; text: string }) => void;
  onSessionForked: (newSessionId: string) => void;
}): Promise<void> {
  const newSessionId = await createForkedBranchSession(
    sendCommand,
    sourceSessionId,
    sourceEntryId,
    failureMessage,
  );
  if (initialPrompt) setPendingPrompt?.({ sessionId: newSessionId, text: initialPrompt });
  onSessionForked(newSessionId);
}
