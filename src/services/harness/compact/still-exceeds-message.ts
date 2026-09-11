export default (focus: string): string =>
  focus === 'subagent'
    ? 'Subagent context still exceeds the model window after compaction'
    : 'Parent context still exceeds the model window after compaction'
