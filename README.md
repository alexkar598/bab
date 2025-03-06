# BAB
Byond Authentication Bridge

# Description
OIDC Provider that integrates with BYOND's DMCGI feature to allow authentication with BYOND credentials
~~For client registration for the instance run at https://bab.alexkar598.dev, see https://forms.gle/TY5AyaiuMYFZ272r8~~

How to self host, more or less
1. Setup a password in .env (see .env.example)
2. Modify the docker-compose.yaml as required to edit port mappings & config (see config/default.json)
3. Setup a reverse proxy to direct traffic to bab's listening port
4. `docker compose up --build --detach`
5. Connect as postgres to the database (default address is 127.0.0.1:15432) and create a row in the Authorization table.
