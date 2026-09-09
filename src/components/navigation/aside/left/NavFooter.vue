<script setup lang="ts">
import { AppIcon } from '@/icons'
import { RouterLink } from 'vue-router'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/shadcn/ui/sidebar'
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <SidebarMenuButton tooltip="Settings" as-child>
        <RouterLink to="/settings">
          <AppIcon name="settings" />
          <span>Settings</span>
        </RouterLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
