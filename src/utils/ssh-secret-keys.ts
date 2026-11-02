export const SSH_PASSWORD_PREFIX = 'vixl:ssh-password:'
export const SSH_PASSPHRASE_PREFIX = 'vixl:ssh-passphrase:'

export const isSshVaultKey = (key: string): boolean =>
  key.startsWith(SSH_PASSWORD_PREFIX) || key.startsWith(SSH_PASSPHRASE_PREFIX)

export const webviewMustNotCallGenericSecrets = (key: string): void => {
  if (isSshVaultKey(key)) {
    throw new Error(
      'SSH secrets cannot be read or written through the generic secret commands',
    )
  }
}
