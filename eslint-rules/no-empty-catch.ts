import type { Rule } from 'eslint'
import type {
  ArrowFunctionExpression,
  Expression,
  FunctionExpression,
  Node,
  Statement,
} from 'estree'

const isUndefinedIdentifier = (node: Expression): boolean =>
  node.type === 'Identifier' && node.name === 'undefined'

const isNoOpStatement = (statement: Statement): boolean => {
  if (statement.type === 'EmptyStatement') {
    return true
  }
  if (statement.type !== 'ExpressionStatement') {
    return false
  }
  return isUndefinedIdentifier(statement.expression)
}

const isEmptyBlockBody = (statements: Statement[]): boolean =>
  statements.every(isNoOpStatement)

const isCatchHandler = (
  node: Node,
): node is ArrowFunctionExpression | FunctionExpression =>
  node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression'

const isEmptyCatchHandler = (node: Node): boolean => {
  if (!isCatchHandler(node)) {
    return false
  }
  const { body } = node
  if (body.type !== 'BlockStatement') {
    return isUndefinedIdentifier(body)
  }
  return isEmptyBlockBody(body.body)
}

const isPromiseCatchCall = (node: Rule.Node): boolean => {
  if (node.type !== 'CallExpression') {
    return false
  }
  const { callee } = node
  if (callee.type !== 'MemberExpression' || callee.computed) {
    return false
  }
  return callee.property.type === 'Identifier' && callee.property.name === 'catch'
}

const noEmptyCatch: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow empty catch clauses and empty promise catch handlers',
    },
    schema: [],
    messages: {
      emptyCatch:
        'Empty catch blocks are not allowed. Handle the error, rethrow it, or return an explicit fallback.',
      emptyPromiseCatch:
        'Empty promise catch handlers are not allowed. Handle the error, rethrow it, or return an explicit fallback.',
    },
  },
  create(context) {
    return {
      CatchClause(node) {
        if (isEmptyBlockBody(node.body.body)) {
          context.report({ node, messageId: 'emptyCatch' })
        }
      },
      CallExpression(node) {
        if (!isPromiseCatchCall(node) || node.arguments.length === 0) {
          return
        }
        const handler = node.arguments[0]
        if (handler === undefined || handler.type === 'SpreadElement') {
          return
        }
        if (isEmptyCatchHandler(handler)) {
          context.report({ node: handler, messageId: 'emptyPromiseCatch' })
        }
      },
    }
  },
}

export default noEmptyCatch
