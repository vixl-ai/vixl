import { InvalidToolInputError, type ToolCallRepairFunction, type ToolSet } from 'ai'
import { jsonrepair } from 'jsonrepair'

const repairToolCall: ToolCallRepairFunction<ToolSet> = async ({
  toolCall,
  error,
}) => {
  if (!InvalidToolInputError.isInstance(error)) {
    return null
  }

  try {
    const repaired = jsonrepair(toolCall.input)
    if (repaired === toolCall.input) {
      return null
    }
    JSON.parse(repaired)
    return { ...toolCall, input: repaired }
  } catch {
    return null
  }
}

export default repairToolCall
