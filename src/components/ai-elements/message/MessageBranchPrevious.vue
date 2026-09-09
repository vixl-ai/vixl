<script setup lang="ts">
import { AppIcon } from '@/icons'
import { Button } from '@/components/ui/button'
import { useMessageBranchContext } from './context'

const { goToPrevious, totalBranches } = useMessageBranchContext()
</script>

<template>
  <Button
    aria-label="Previous branch"
    :disabled="totalBranches <= 1"
    size="icon-sm"
    type="button"
    variant="ghost"
    v-bind="$attrs"
    @click="goToPrevious"
  >
    <slot>
      <AppIcon name="chevron-left" :size="14" />
    </slot>
  </Button>
</template>
