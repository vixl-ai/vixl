import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
import noEmptyCatch from '../../eslint-rules/no-empty-catch'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
})

ruleTester.run('no-empty-catch', noEmptyCatch, {
  valid: [
    'function run() { try { foo() } catch { return } }',
    'for (;;) { try { foo() } catch { continue } }',
    'try { foo() } catch (e) { throw e }',
    'try { foo() } catch { x = 1 }',
    "try { foo() } catch { toast.error('failed') }",
    'p.catch(() => null)',
    'p.catch(() => [])',
    "p.catch(() => '')",
    'p.catch(() => { return })',
    'p.catch(() => { return null })',
    'p.catch((error) => { toast.error(error.message) })',
    'p.catch(function (error) { throw error })',
  ],
  invalid: [
    {
      code: 'try { foo() } catch {}',
      errors: [{ messageId: 'emptyCatch' }],
    },
    {
      code: 'try { foo() } catch { /* swallow */ }',
      errors: [{ messageId: 'emptyCatch' }],
    },
    {
      code: 'try { foo() } catch (e) {}',
      errors: [{ messageId: 'emptyCatch' }],
    },
    {
      code: 'p.catch(() => {})',
      errors: [{ messageId: 'emptyPromiseCatch' }],
    },
    {
      code: 'p.catch(() => { /* ignore */ })',
      errors: [{ messageId: 'emptyPromiseCatch' }],
    },
    {
      code: 'p.catch(() => undefined)',
      errors: [{ messageId: 'emptyPromiseCatch' }],
    },
    {
      code: 'p.catch(function () {})',
      errors: [{ messageId: 'emptyPromiseCatch' }],
    },
  ],
})
