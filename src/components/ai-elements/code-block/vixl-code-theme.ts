import type { RawThemeSetting, ThemeRegistration } from 'shiki'

export const VIXL_CODE_THEME_LIGHT = 'vixl-light' as const
export const VIXL_CODE_THEME_DARK = 'vixl-dark' as const

export type VixlCodeTheme = typeof VIXL_CODE_THEME_LIGHT | typeof VIXL_CODE_THEME_DARK

interface VixlSyntaxPalette {
  background: string
  foreground: string
  comment: string
  keyword: string
  keywordAccent: string
  string: string
  number: string
  function: string
  type: string
  variable: string
  constant: string
  operator: string
  invalid: string
  regexp: string
  attribute: string
  tag: string
  escape: string
}

// oklch(0.145 0 0) background, oklch(0.985 0 0) foreground — muted vs-dark-style tokens
const vixlDarkPalette: VixlSyntaxPalette = {
  background: '#252525',
  foreground: '#d4d4d4',
  comment: '#707070',
  keyword: '#7a8abf',
  keywordAccent: '#9a85b0',
  string: '#6b9a8a',
  number: '#8aaa8a',
  function: '#b8b8a0',
  type: '#6a9e95',
  variable: '#a8b4c0',
  constant: '#8a9ec4',
  operator: '#c8c8c8',
  invalid: '#c4756a',
  regexp: '#8a7a9e',
  attribute: '#a8b4c0',
  tag: '#7a8abf',
  escape: '#a8a090',
}

// oklch(1 0 0) background, oklch(0.145 0 0) foreground — muted light-plus-style tokens
const vixlLightPalette: VixlSyntaxPalette = {
  background: '#ffffff',
  foreground: '#252525',
  comment: '#737373',
  keyword: '#5a6a9e',
  keywordAccent: '#7a5a8a',
  string: '#3d7358',
  number: '#4a704a',
  function: '#6b6b4a',
  type: '#3d6b62',
  variable: '#4a5568',
  constant: '#5a6a8a',
  operator: '#404040',
  invalid: '#b04a3a',
  regexp: '#6a5a7a',
  attribute: '#4a5568',
  tag: '#5a6a9e',
  escape: '#6b5a4a',
}

const buildTokenColors = (palette: VixlSyntaxPalette): RawThemeSetting[] => [
  {
    scope: [
      'meta.embedded',
      'source.groovy.embedded',
      'string meta.image.inline.markdown',
      'variable.legacy.builtin.python',
    ],
    settings: { foreground: palette.foreground },
  },
  { scope: 'emphasis', settings: { fontStyle: 'italic' } },
  { scope: 'strong', settings: { fontStyle: 'bold' } },
  { scope: 'comment', settings: { foreground: palette.comment } },
  { scope: 'constant.language', settings: { foreground: palette.keyword } },
  {
    scope: [
      'constant.numeric',
      'variable.other.enummember',
      'keyword.operator.plus.exponent',
      'keyword.operator.minus.exponent',
    ],
    settings: { foreground: palette.number },
  },
  { scope: 'constant.regexp', settings: { foreground: palette.regexp } },
  { scope: 'entity.name.tag', settings: { foreground: palette.tag } },
  {
    scope: ['entity.name.tag.css', 'entity.name.tag.less'],
    settings: { foreground: palette.escape },
  },
  { scope: 'entity.other.attribute-name', settings: { foreground: palette.attribute } },
  {
    scope: [
      'entity.other.attribute-name.class.css',
      'source.css entity.other.attribute-name.class',
      'entity.other.attribute-name.id.css',
      'entity.other.attribute-name.parent-selector.css',
      'entity.other.attribute-name.parent.less',
      'source.css entity.other.attribute-name.pseudo-class',
      'entity.other.attribute-name.pseudo-element.css',
      'source.css.less entity.other.attribute-name.id',
      'entity.other.attribute-name.scss',
    ],
    settings: { foreground: palette.escape },
  },
  { scope: 'invalid', settings: { foreground: palette.invalid } },
  { scope: 'markup.underline', settings: { fontStyle: 'underline' } },
  { scope: 'markup.bold', settings: { fontStyle: 'bold', foreground: palette.keyword } },
  { scope: 'markup.heading', settings: { fontStyle: 'bold', foreground: palette.keyword } },
  { scope: 'markup.italic', settings: { fontStyle: 'italic' } },
  { scope: 'markup.strikethrough', settings: { fontStyle: 'strikethrough' } },
  { scope: 'markup.inserted', settings: { foreground: palette.number } },
  { scope: 'markup.deleted', settings: { foreground: palette.string } },
  { scope: 'markup.changed', settings: { foreground: palette.keyword } },
  {
    scope: ['punctuation.definition.quote.begin.markdown', 'punctuation.definition.list.begin.markdown'],
    settings: { foreground: palette.comment },
  },
  { scope: 'markup.inline.raw', settings: { foreground: palette.string } },
  { scope: 'punctuation.definition.tag', settings: { foreground: palette.comment } },
  {
    scope: ['meta.preprocessor', 'entity.name.function.preprocessor'],
    settings: { foreground: palette.keyword },
  },
  { scope: 'meta.preprocessor.string', settings: { foreground: palette.string } },
  { scope: 'meta.preprocessor.numeric', settings: { foreground: palette.number } },
  { scope: 'meta.structure.dictionary.key.python', settings: { foreground: palette.variable } },
  { scope: 'meta.diff.header', settings: { foreground: palette.keyword } },
  { scope: 'storage', settings: { foreground: palette.keyword } },
  { scope: 'storage.type', settings: { foreground: palette.keyword } },
  {
    scope: ['storage.modifier', 'keyword.operator.noexcept'],
    settings: { foreground: palette.keyword },
  },
  { scope: ['string', 'meta.embedded.assembly'], settings: { foreground: palette.string } },
  { scope: 'string.tag', settings: { foreground: palette.string } },
  { scope: 'string.value', settings: { foreground: palette.string } },
  { scope: 'string.regexp', settings: { foreground: palette.invalid } },
  {
    scope: [
      'punctuation.definition.template-expression.begin',
      'punctuation.definition.template-expression.end',
      'punctuation.section.embedded',
    ],
    settings: { foreground: palette.keyword },
  },
  { scope: ['meta.template.expression'], settings: { foreground: palette.foreground } },
  {
    scope: [
      'support.type.vendored.property-name',
      'support.type.property-name',
      'source.css variable',
      'source.coffee.embedded',
    ],
    settings: { foreground: palette.variable },
  },
  { scope: 'keyword', settings: { foreground: palette.keyword } },
  { scope: 'keyword.control', settings: { foreground: palette.keyword } },
  { scope: 'keyword.operator', settings: { foreground: palette.operator } },
  {
    scope: [
      'keyword.operator.new',
      'keyword.operator.expression',
      'keyword.operator.cast',
      'keyword.operator.sizeof',
      'keyword.operator.alignof',
      'keyword.operator.typeid',
      'keyword.operator.alignas',
      'keyword.operator.instanceof',
      'keyword.operator.logical.python',
      'keyword.operator.wordlike',
    ],
    settings: { foreground: palette.keyword },
  },
  { scope: 'keyword.other.unit', settings: { foreground: palette.number } },
  {
    scope: ['punctuation.section.embedded.begin.php', 'punctuation.section.embedded.end.php'],
    settings: { foreground: palette.keyword },
  },
  { scope: 'support.function.git-rebase', settings: { foreground: palette.variable } },
  { scope: 'constant.sha.git-rebase', settings: { foreground: palette.number } },
  {
    scope: [
      'storage.modifier.import.java',
      'variable.language.wildcard.java',
      'storage.modifier.package.java',
    ],
    settings: { foreground: palette.foreground },
  },
  { scope: 'variable.language', settings: { foreground: palette.keyword } },
  {
    scope: [
      'entity.name.function',
      'support.function',
      'support.constant.handlebars',
      'source.powershell variable.other.member',
      'entity.name.operator.custom-literal',
    ],
    settings: { foreground: palette.function },
  },
  {
    scope: [
      'support.class',
      'support.type',
      'entity.name.type',
      'entity.name.namespace',
      'entity.other.attribute',
      'entity.name.scope-resolution',
      'entity.name.class',
      'storage.type.numeric.go',
      'storage.type.byte.go',
      'storage.type.boolean.go',
      'storage.type.string.go',
      'storage.type.uintptr.go',
      'storage.type.error.go',
      'storage.type.rune.go',
      'storage.type.cs',
      'storage.type.generic.cs',
      'storage.type.modifier.cs',
      'storage.type.variable.cs',
      'storage.type.annotation.java',
      'storage.type.generic.java',
      'storage.type.java',
      'storage.type.object.array.java',
      'storage.type.primitive.array.java',
      'storage.type.primitive.java',
      'storage.type.token.java',
      'storage.type.groovy',
      'storage.type.annotation.groovy',
      'storage.type.parameters.groovy',
      'storage.type.generic.groovy',
      'storage.type.object.array.groovy',
      'storage.type.primitive.array.groovy',
      'storage.type.primitive.groovy',
    ],
    settings: { foreground: palette.type },
  },
  {
    scope: [
      'meta.type.cast.expr',
      'meta.type.new.expr',
      'support.constant.math',
      'support.constant.dom',
      'support.constant.json',
      'entity.other.inherited-class',
      'punctuation.separator.namespace.ruby',
    ],
    settings: { foreground: palette.type },
  },
  {
    scope: [
      'keyword.control',
      'source.cpp keyword.operator.new',
      'keyword.operator.delete',
      'keyword.other.using',
      'keyword.other.directive.using',
      'keyword.other.operator',
      'entity.name.operator',
    ],
    settings: { foreground: palette.keywordAccent },
  },
  {
    scope: [
      'variable',
      'meta.definition.variable.name',
      'support.variable',
      'entity.name.variable',
      'constant.other.placeholder',
    ],
    settings: { foreground: palette.variable },
  },
  {
    scope: ['variable.other.constant', 'variable.other.enummember'],
    settings: { foreground: palette.constant },
  },
  { scope: ['meta.object-literal.key'], settings: { foreground: palette.variable } },
  {
    scope: [
      'support.constant.property-value',
      'support.constant.font-name',
      'support.constant.media-type',
      'support.constant.media',
      'constant.other.color.rgb-value',
      'constant.other.rgb-value',
      'support.constant.color',
    ],
    settings: { foreground: palette.string },
  },
  {
    scope: [
      'punctuation.definition.group.regexp',
      'punctuation.definition.group.assertion.regexp',
      'punctuation.definition.character-class.regexp',
      'punctuation.character.set.begin.regexp',
      'punctuation.character.set.end.regexp',
      'keyword.operator.negation.regexp',
      'support.other.parenthesis.regexp',
    ],
    settings: { foreground: palette.string },
  },
  {
    scope: [
      'constant.character.character-class.regexp',
      'constant.other.character-class.set.regexp',
      'constant.other.character-class.regexp',
      'constant.character.set.regexp',
    ],
    settings: { foreground: palette.invalid },
  },
  {
    scope: ['keyword.operator.or.regexp', 'keyword.control.anchor.regexp'],
    settings: { foreground: palette.function },
  },
  { scope: 'keyword.operator.quantifier.regexp', settings: { foreground: palette.escape } },
  { scope: ['constant.character', 'constant.other.option'], settings: { foreground: palette.keyword } },
  { scope: 'constant.character.escape', settings: { foreground: palette.escape } },
  { scope: 'entity.name.label', settings: { foreground: palette.operator } },
]

const createVixlTheme = (
  name: VixlCodeTheme,
  type: 'light' | 'dark',
  palette: VixlSyntaxPalette,
): ThemeRegistration => ({
  name,
  type,
  fg: palette.foreground,
  bg: palette.background,
  colors: {
    'editor.background': palette.background,
    'editor.foreground': palette.foreground,
  },
  settings: buildTokenColors(palette),
})

export const vixlCodeThemeDark = createVixlTheme(
  VIXL_CODE_THEME_DARK,
  'dark',
  vixlDarkPalette,
)

export const vixlCodeThemeLight = createVixlTheme(
  VIXL_CODE_THEME_LIGHT,
  'light',
  vixlLightPalette,
)

export const vixlCodeThemes = [vixlCodeThemeLight, vixlCodeThemeDark] as const
