const OAUTH_AUTHORIZATION_RESPONSE_MIXED_UP =
  'OAuth authorization response mixed up'

type AssertAuthorizationResponseInput = {
  callbackIss?: string | null
  expectedIssuer: string
  authorizationResponseIssParameterSupported?: boolean
}

const presentIss = (value: string | null | undefined): string | undefined => {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined
  }
  return value
}

const assertAuthorizationResponse = (
  input: AssertAuthorizationResponseInput,
): void => {
  const iss = presentIss(input.callbackIss)
  const advertised = input.authorizationResponseIssParameterSupported === true

  if (advertised && iss === undefined) {
    throw new Error(OAUTH_AUTHORIZATION_RESPONSE_MIXED_UP)
  }

  if (iss !== undefined && iss !== input.expectedIssuer) {
    throw new Error(OAUTH_AUTHORIZATION_RESPONSE_MIXED_UP)
  }
}

export default assertAuthorizationResponse
