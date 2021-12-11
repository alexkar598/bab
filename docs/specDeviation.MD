#OAuth2 RFC 6749
- BAB requires the presence of the redirect_uri in the /authorize endpoint no matter the amount of registered endpoints

#OAuth 2.0 Multiple Response Type Encoding Practices 1.0
- BAB does not support response_mode for error responses on the /authorize endpoint.
  - This is done to stay consistent across all errors. It is impossible to use the provided response_mode if the response_mode is invalid. BAB will always use the "query" response_mode when returning an error response

#OpenID Connect Core 1.0 incorporating errata set 1.0
- BAB does not support the `max_age` parameter as BYOND does not support it and BAB has no means of forcing the user to reauthenticate in any meaningful way
- BAB cannot verify the time that the user logged in via BYOND so the `auth_time` claim is always the same as the `iat` claim
- BAB cannot get any sort of immutable identifier from BYOND so the ckey is used. However, ckey changes are very uncommon if any has ever occured.

#Todo
- Implement `sub` claim validation: ~~Either~~ through id_token_hint ~~or claims~~
- Generate ID token with following parameters
  - `iss`: publicPath
  - `sub`: ckey
  - `aud`: client ID for IT, publicPath for AT
  - `exp`: defined by the client on registration
  - `iat`: time of issuance
  - `auth_time`: time of issuance (can't check byond login time)
  - `nonce`: nonce value passed during authorization (required if hibrid)
  - `azp`: client ID
  - `at_hash`: In ID token issued only from /token, hash access token via hash in `alg` of ID token, take left half of hash and base64url
  - `c_hash`: In ID token, hash code via hash in `alg` of ID token, take left half of hash and base64url if code in response_types
  - `gender`: take from byond
  - NO `x5u`, `x5c`, `jku` or `jwk`
- Return ID token in /token if openid scope
- (DONE) Return ID token in /authorize if id_token response_type and openid scope
- Implement Section 5.3 UserInfo Endpoint
- Token:

```json
{
  "alg": "RS256",
  "kid": "<activekeyid>",
  "type": "JOSE"
}
```