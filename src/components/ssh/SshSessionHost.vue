<script setup lang="ts">
import { onMounted } from 'vue'
import SshConnectDialog from '@/components/ssh/SshConnectDialog.vue'
import SshDisconnectDialog from '@/components/ssh/SshDisconnectDialog.vue'
import SshHostKeyDialog from '@/components/ssh/SshHostKeyDialog.vue'
import SshPortForwardDialog from '@/components/ssh/SshPortForwardDialog.vue'
import SshRemoveHostKeyDialog from '@/components/ssh/SshRemoveHostKeyDialog.vue'
import SshSecretDialog from '@/components/ssh/SshSecretDialog.vue'
import SshTrustWorkspaceDialog from '@/components/ssh/SshTrustWorkspaceDialog.vue'
import useSshSession from '@/composables/use-ssh-session'

const ssh = useSshSession()

onMounted(() => {
  void ssh.bindListeners()
})
</script>

<template>
  <SshConnectDialog />
  <SshHostKeyDialog />
  <SshSecretDialog />
  <SshRemoveHostKeyDialog />
  <SshDisconnectDialog />
  <SshPortForwardDialog />
  <SshTrustWorkspaceDialog />
</template>
