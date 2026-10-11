# Icons first

Prefer an icon with a tooltip over verbose text, helper copy, or inline descriptions. Space is the scarce resource; the tooltip carries the explanation, the icon carries the meaning.

## Form fields

Do not add description text under a field (`<p class="text-sm text-muted-foreground">`, `FormDescription`, placeholder prose). Keep the label short and attach an info icon with the explanation in a tooltip.

```vue
<div class="flex items-center gap-1.5">
  <Label for="sandbox-terminal">Sandbox terminal</Label>
  <Tooltip>
    <TooltipTrigger as-child>
      <button
        type="button"
        class="inline-flex text-muted-foreground hover:text-foreground"
        aria-label="Sandbox terminal description"
      >
        <CircleHelpIcon class="size-3.5" />
      </button>
    </TooltipTrigger>
    <TooltipContent class="max-w-xs">
      Sandboxed commands can auto-run. Leaving the sandbox always asks.
    </TooltipContent>
  </Tooltip>
</div>
```

Import `Tooltip`, `TooltipTrigger as-child`, `TooltipContent` from `@/components/shadcn/ui/tooltip` and the icon from `@lucide/vue` (`CircleHelpIcon`, `Info`, `TriangleAlertIcon`). Wrap dense screens once in `TooltipProvider`. Add `class="max-w-xs"` when the text is longer than a few words.

## Modals and sheets

When the user clicked a labeled control or icon to open something, they already know what it is. Do not spend vertical space on a `DialogHeader` with `DialogTitle` and `DialogDescription` restating it.

- Remove visible titles and descriptions from form dialogs, create sheets, and editor dialogs.
- Keep the accessible name with `class="sr-only"` (reka-ui needs a title for `aria-labelledby`): `<SheetTitle class="sr-only">Create</SheetTitle>`.
- Start the content at the first field or control.

Keep visible text when the dialog is itself the message: destructive confirmations (`AlertDialogTitle` plus a sentence naming the consequence), error states, and pickers where the heading is a section label.

## Icon buttons

Every icon-only control gets a `Tooltip` and an `aria-label`, usually `variant="ghost"` with `size="icon"` or smaller. Never ship an unlabeled icon button, and never replace the tooltip with a visible text label beside it.

## Where text is still correct

Toasts and inline validation messages, empty states, long-form or docs-like content, chat and code output, and anything the tooltip itself would have to say at length. When unsure which primitive fits, check the shadcn Vue MCP before inventing markup.
