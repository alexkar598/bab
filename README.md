# BAB
Byond Authentication Bridge

# Description
OIDC Provider that integrates with BYOND's DMCGI feature to allow authentication with BYOND credentials
For client registration for the instance run at https://bab.alexkar598.dev, see https://forms.gle/TY5AyaiuMYFZ272r8

How to self host(for testing), more or less
1. npm install
2. patch callback.ts to not require the private dependency
3. enable test mode in the config
4. npm run generateDbClient
5. npm run devUpdateDb
6. npm run start
