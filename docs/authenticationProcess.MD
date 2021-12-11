Definitions:
- End user: person in front of the PC, presumably has a BYOND account
- Client/RP: **R**elying **P**arty, application that needs to verify the identity of the end user
- Application Owner: person who owns/maintains the client
- BAB: My server
- Registration: The process of DMing me and asking me to create credentials for a new client
- ID Token: Token meant to assert the identity of the end user
- Access Token: Token meant for the client to act on the end user's behalf (basically worthless as I haven't implemented any API secured by this token) 

Process:
- The client is configured either manually or using the automatic discovery process (its really neat, you shove an url and it knows almost everything it should do) and is provided with a `client_id` and sometimes a `client_secret` (spec allows support for unauthenticated clients, assuming they've been registered as so)
- When the client needs the end user to authenticate, it redirects to BAB's /authorize endpoint with the following information (some of it is optional, some is not):
response_type
  - `response_type`: Specifies how credentials should be returned (il cover the `code` one in this example)
  - `client_id`: Specifies which client the end user is authenticating for
  - `scope`: Used to request specific permissions to an account, but I don't implement any permissions, so must always be `openid`
  - `redirect_uri`: URI to return the end user to when they have authenticated, must match an uri specified during registration
  - `state`: Optional, is returned alongside the response when the authentication is complete.
  - `response_mode`: Optional, specifies if response should be encoded via query or hash ie `?code=abc&state=veryrandom` or `#code=abc&state=veryrandom`, defaults depends on `response_type`
  - `nonce`: Optional, arbitary value that will be encoded in the token in the nonce field
  - `id_token_hint`: ID token previously issued to the end user, if the user the token represents is not the same user who logs in, the login is rejected
- BAB will redirect the end user to login.cgi with a redirect uri containing a state to identify the authorization
- The user authenticates with byond.com if logged out
- BYOND redirects the end user to BAB
- BAB removes the byondcert from the url to ensure it is not accidentally leaked then validates that the user went through /authorize first
- BAB verifies the `byondcert` to be valid
- Dependening on the `response_type` and `response_mode`, BAB will redirect the user to the `redirect_uri` with the following parameters(several can be returned):
  - `id_token`: If `response_type` contains `id_token`. This will contain an ID token
  - `code`: If `response_type` contains `code`. This will contain a code the client server can exchange for an access token and an id token
  - `state`: State parameter passed in the /authorize request
- If the client requested an `id_token` directly via `response_type`, it must validate it and it's signature
- If the client requested a `code` via `response_type`, it must call /token with the following parameters:
  - `grant_type`: Authentication flow used (ie response_type), must always be `authorization_code`
  - `code`: Code provided to the client
  - `redirect_uri`: same `redirect_uri` used in the /authorize request
  - `client_id`: ID of the client, can also be provided via HTTP basic auth as the username
  - `client_secret`: If the client is not registered as a public client, this must be provided, can also be provided via HTTP basic auth as the password
- The client can either verify the identity of the user via the id_token or via the /userinfo endpoint using the access token for http bearer auth. Note that the latter is not recommended as it is vulnerable to attacks where the attacker uses a valid access token issued to an "Evil Client" to authenticate as the end user to the "Victim Client"

Contents of the ID token (signed according to the JWT spec): 
```json
{
  "iss": "Issuer, is the url of BAB",
  "sub": "Subject, follows the format user:{ckey} without the brackets",
  "ckey": "ckey of the user",
  "gender": "male, female or neuter",
  "aud": "Audience, client this token was issued to. Clients should verify this value to ensure the token is destined to them",
  "exp": "Expiration, clients specify how long they want token issued to them last at registration",
  "iat": "Time the token was issued at",
  "auth_time": "Time the user was authenticated, same as iat (in other implementations, this tracks the time the user actively logged on vs cached credentials)",
  "nonce": "Valud provided in /authorize",
  "azp": "Authorized party, ie who's allowed to use this token, will be the same as aud",
  "c_hash": "If issued directly to the client via the id_token response_type alongside a code, this will contain the left most 16 bytes of the sha256 hash of the code",
  "at_hash": "If issued from /token, this will contain the left 16 bytes of the sha256 hash of the access token"
}
```
All of this is signed via an assymetric key that is published at the /keys endpoint. The active key used to sign tokens is rotated every 3 days. Old private keys are immediatly deleted. Old public keys are available for 15 days.

Security vulnerabilities:
  - `byondcert` is constant across all authorizations for a user, if leaked through one way or the other, the attacker can generate as many tokens as he wants for that user. Attempts to mitigate this by using http basic auth to make login.cgi always issue a different token have failed due to a shady warning firefox displays when using http basic auth in the uri (this would of worked because BYOND doesn't treat user1@domain.com as the same domain as user2@domain.com but browsers will direct both to the same place)